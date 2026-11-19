import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildConnectionBackupBundle,
  buildDefaultBuiltInProfile,
  BUILTIN_DEFAULT_CONNECTION_ID,
  classifyConnectionFailure,
  createOrUpdateConnectionProfile,
  deleteConnectionProfile,
  getActiveConnectionProfile,
  importConnectionBackupBundle,
  loadDatabaseConnectionLogs,
  loadDatabaseRegistry,
  parseAndValidateConnectionBackup,
  rollbackDatabaseConnection,
  setDefaultConnectionProfile,
  stripSecretFields,
  switchActiveDatabaseConnection,
  validateConnectionProfile,
} from '../src/lib/dbConnectionManager';
import {
  deleteSecretRecord,
  getMaskedSecretStatuses,
  upsertSecretRecord,
} from '../server/dbSecretVault';
import type { DatabaseConnectionTestResult } from '../src/types/database';

test('built-in default profile loads cleanly without leaking secrets', () => {
  const builtIn = buildDefaultBuiltInProfile();
  assert.equal(builtIn.id, BUILTIN_DEFAULT_CONNECTION_ID);
  assert.equal(builtIn.providerType, 'firebase_firestore');
  assert.equal(builtIn.isBuiltIn, true);
  assert.ok(builtIn.firebaseConfig.projectId.length > 0);

  const reg = loadDatabaseRegistry();
  assert.equal(reg.activeConnectionId, BUILTIN_DEFAULT_CONNECTION_ID);
  assert.equal(reg.defaultConnectionId, BUILTIN_DEFAULT_CONNECTION_ID);
  assert.ok(reg.profiles.some((p) => p.id === BUILTIN_DEFAULT_CONNECTION_ID));
});

test('stripSecretFields removes nested private keys, service accounts, and tokens', () => {
  const dirty = {
    name: 'Test DB',
    serviceAccountJson: '{"client_email":"a@b.iam.gserviceaccount.com"}',
    privateKey: '-----BEGIN PRIVATE KEY-----',
    cloudflareToken: 'cf-secret-token',
    nested: {
      projectId: 'my-project-123',
      apiSecret: 'super-secret',
      adminToken: 'tok',
    },
  };

  const cleaned = stripSecretFields(dirty) as Record<string, unknown>;
  assert.equal(cleaned.name, 'Test DB');
  assert.equal('serviceAccountJson' in cleaned, false);
  assert.equal('privateKey' in cleaned, false);
  assert.equal('cloudflareToken' in cleaned, false);
  const nested = cleaned.nested as Record<string, unknown>;
  assert.equal(nested.projectId, 'my-project-123');
  assert.equal('apiSecret' in nested, false);
  assert.equal('adminToken' in nested, false);
});

test('validateConnectionProfile enforces dynamic fields per provider type', () => {
  const validFirestore = buildDefaultBuiltInProfile();
  assert.equal(validateConnectionProfile(validFirestore).valid, true);

  const rtdbMissingUrl = {
    ...validFirestore,
    id: 'rtdb-test',
    providerType: 'firebase_realtime' as const,
    firebaseConfig: { ...validFirestore.firebaseConfig, databaseURL: '' },
  };
  const rtdbCheck = validateConnectionProfile(rtdbMissingUrl);
  assert.equal(rtdbCheck.valid, false);
  assert.ok(rtdbCheck.errors.some((e) => e.includes('Database URL')));

  const invalidApi = {
    ...validFirestore,
    id: 'custom-test',
    providerType: 'custom_api' as const,
    customApiConfig: {
      endpointUrl: 'ftp://invalid-endpoint',
      healthPath: '/health',
      authHeaderName: 'Authorization',
      useWorkerProxy: false,
    },
  };
  assert.equal(validateConnectionProfile(invalidApi).valid, false);
});

test('classifyConnectionFailure classifies real error reasons accurately', () => {
  assert.equal(classifyConnectionFailure(new Error('Request timeout exceeded')).status, 'timeout');
  assert.equal(
    classifyConnectionFailure({ code: 'permission-denied', message: 'Missing permissions' }).status,
    'permission_denied'
  );
  assert.equal(
    classifyConnectionFailure({ code: 'resource-exhausted', message: 'Quota exceeded' }).status,
    'quota_exceeded'
  );
  assert.equal(
    classifyConnectionFailure(new Error('API key not valid. Please pass a valid API key.')).status,
    'invalid_config'
  );
  assert.equal(
    classifyConnectionFailure({ code: 'unavailable', message: 'Failed to get document because the client is offline' }).status,
    'offline'
  );
});

test('CRUD guards, test-gated switching, rollback, and checksummed config backup', async () => {
  const created = createOrUpdateConnectionProfile(
    {
      id: 'staging-firestore-1',
      name: 'قاعدة البيانات التجريبية',
      providerType: 'firebase_firestore',
      firebaseConfig: {
        projectId: 'staging-rahaltv-123',
        apiKey: 'AIzaSyFakeTestKeyForUnitTestsOnly123456',
        authDomain: 'staging-rahaltv-123.firebaseapp.com',
        firestoreDatabaseId: '(default)',
        databaseURL: '',
        storageBucket: '',
        messagingSenderId: '1234567890',
        appId: '1:1234567890:web:abcdef123456',
      },
    },
    { uid: 'owner-1', name: 'Owner' }
  );

  assert.equal(created.isNew, true);
  assert.ok(created.registry.profiles.some((p) => p.id === 'staging-firestore-1'));

  // Safety gate: switching with a failed test must refuse and preserve active DB
  const failedTest: DatabaseConnectionTestResult = {
    ok: false,
    status: 'permission_denied',
    statusLabelAr: 'مشكلة في الصلاحيات',
    message: 'قواعد الأمان ترفض القراءة',
    testedAt: new Date().toISOString(),
    latencyMs: 42,
    canSwitchSafely: false,
    steps: [],
  };
  const blockedSwitch = await switchActiveDatabaseConnection(
    'staging-firestore-1',
    { uid: 'owner-1', name: 'Owner' },
    { verifiedTest: failedTest }
  );
  assert.equal(blockedSwitch.ok, false);
  assert.equal(getActiveConnectionProfile().id, BUILTIN_DEFAULT_CONNECTION_ID);

  // Passing verified test permits switching
  const passingTest: DatabaseConnectionTestResult = {
    ok: true,
    status: 'connected',
    statusLabelAr: 'متصل',
    message: 'تم الاتصال بنجاح',
    testedAt: new Date().toISOString(),
    latencyMs: 35,
    canSwitchSafely: true,
    steps: [],
  };
  const allowedSwitch = await switchActiveDatabaseConnection(
    'staging-firestore-1',
    { uid: 'owner-1', name: 'Owner' },
    { verifiedTest: passingTest }
  );
  assert.equal(allowedSwitch.ok, true);
  assert.equal(getActiveConnectionProfile().id, 'staging-firestore-1');

  // Cannot delete active profile
  const delActive = deleteConnectionProfile('staging-firestore-1');
  assert.equal(delActive.ok, false);

  // Set default & verify default cannot be deleted even after rollback
  const defRes = setDefaultConnectionProfile('staging-firestore-1');
  assert.equal(defRes.ok, true);

  // Rollback returns to previous built-in profile
  const rbRes = await rollbackDatabaseConnection({ uid: 'owner-1', name: 'Owner' });
  assert.equal(rbRes.ok, true);
  assert.equal(getActiveConnectionProfile().id, BUILTIN_DEFAULT_CONNECTION_ID);

  // Cannot delete while set as default
  assert.equal(deleteConnectionProfile('staging-firestore-1').ok, false);

  // Reset default to built-in, then unused profile deletes cleanly
  setDefaultConnectionProfile(BUILTIN_DEFAULT_CONNECTION_ID);

  // Export & verify backup bundle checksum
  const bundle = buildConnectionBackupBundle('Owner');
  const parsed = parseAndValidateConnectionBackup(JSON.stringify(bundle));
  assert.equal(parsed.valid, true);
  assert.equal(parsed.checksumMatched, true);

  // Tampered checksum is flagged
  const tampered = { ...bundle, profiles: [] };
  const parsedTampered = parseAndValidateConnectionBackup(JSON.stringify(tampered));
  assert.equal(parsedTampered.valid, true);
  assert.equal(parsedTampered.checksumMatched, false);

  // Delete unused staging profile, then restore via merge
  const delUnused = deleteConnectionProfile('staging-firestore-1');
  assert.equal(delUnused.ok, true);
  const imported = importConnectionBackupBundle(bundle, 'merge', { uid: 'owner-1', name: 'Owner' });
  assert.ok(imported.profiles.some((p) => p.id === 'staging-firestore-1'));
  deleteConnectionProfile('staging-firestore-1');

  assert.ok(loadDatabaseConnectionLogs().length > 0);
});

test('server dbSecretVault encrypts secrets on disk and returns masked status only', () => {
  const testConnId = 'unit-test-vault-conn';
  const vaultPath = path.resolve(process.cwd(), '.rahaltv-secrets.json');
  const existedBefore = fs.existsSync(vaultPath);
  const prevRaw = existedBefore ? fs.readFileSync(vaultPath, 'utf8') : null;

  try {
    const status = upsertSecretRecord({
      connectionId: testConnId,
      serviceAccountJson: JSON.stringify({
        type: 'service_account',
        project_id: 'unit-test-proj',
        client_email: 'bot@unit-test-proj.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nSECRET_KEY_VALUE\n-----END PRIVATE KEY-----\n',
      }),
      apiSecret: 'secret-token-xyz',
      updatedBy: 'owner@example.com',
    });

    assert.equal(status.connectionId, testConnId);
    assert.equal(status.hasServiceAccount, true);
    assert.equal(status.hasApiSecret, true);
    assert.equal(status.serviceAccountClientEmail, 'bot@unit-test-proj.iam.gserviceaccount.com');
    assert.equal('private_key' in status, false);
    assert.equal('apiSecret' in status, false);

    // Ensure disk file does not store plaintext private key or apiSecret
    const onDisk = fs.readFileSync(vaultPath, 'utf8');
    assert.equal(onDisk.includes('SECRET_KEY_VALUE'), false);
    assert.equal(onDisk.includes('secret-token-xyz'), false);

    const allStatuses = getMaskedSecretStatuses();
    assert.equal(allStatuses[testConnId]?.hasServiceAccount, true);

    assert.equal(deleteSecretRecord(testConnId), true);
  } finally {
    if (prevRaw !== null) {
      fs.writeFileSync(vaultPath, prevRaw, { encoding: 'utf8', mode: 0o600 });
    } else if (fs.existsSync(vaultPath)) {
      fs.unlinkSync(vaultPath);
    }
  }
});
