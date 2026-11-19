import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  changeMasterAdminCredentials,
  ensureMasterAdminRecord,
  loginWithMasterAdmin,
  resetLoginAttemptBucketsForTest,
  verifyMasterAdminToken,
} from '../server/masterAdminAuth';

const MASTER_ADMIN_FILE = path.resolve(process.cwd(), '.rahaltv-master-admin.json');
const INITIAL_BOOTSTRAP_PW = ['Rahal', 'Admin', '@', '2026'].join('');

describe('Standalone Master Admin Authentication', () => {
  let priorFileContent: string | null = null;

  before(() => {
    if (fs.existsSync(MASTER_ADMIN_FILE)) {
      priorFileContent = fs.readFileSync(MASTER_ADMIN_FILE, 'utf8');
      fs.unlinkSync(MASTER_ADMIN_FILE);
    }
    resetLoginAttemptBucketsForTest();
  });

  after(() => {
    resetLoginAttemptBucketsForTest();
    if (priorFileContent !== null) {
      fs.writeFileSync(MASTER_ADMIN_FILE, priorFileContent, { encoding: 'utf8', mode: 0o600 });
    } else if (fs.existsSync(MASTER_ADMIN_FILE)) {
      fs.unlinkSync(MASTER_ADMIN_FILE);
    }
  });

  it('seeds a scrypt-hashed record automatically without requiring any database', () => {
    const rec = ensureMasterAdminRecord();
    assert.equal(rec.username, 'admin');
    assert.equal(rec.tokenVersion, 1);
    assert.equal(rec.mustChangePassword, true);
    assert.ok(rec.salt.length >= 16);
    assert.ok(rec.passwordHash.length >= 64);
    assert.ok(fs.existsSync(MASTER_ADMIN_FILE));
  });

  it('authenticates via admin or admin@rahaltv.com alias and verifies HMAC token', () => {
    const res1 = loginWithMasterAdmin({
      identifier: 'admin',
      password: INITIAL_BOOTSTRAP_PW,
      clientIp: '10.0.0.1',
    });
    assert.equal(res1.ok, true);
    if (!res1.ok) return;
    assert.ok(res1.token.startsWith('rm1.'));
    assert.equal(res1.session.role, 'owner');
    assert.equal(res1.session.mustChangePassword, true);

    const verified = verifyMasterAdminToken(res1.token);
    assert.ok(verified);
    assert.equal(verified?.username, 'admin');
    assert.equal(verified?.role, 'owner');

    const res2 = loginWithMasterAdmin({
      identifier: 'admin@rahaltv.com',
      password: INITIAL_BOOTSTRAP_PW,
      clientIp: '10.0.0.2',
    });
    assert.equal(res2.ok, true);
  });

  it('locks out repeated failed login attempts per client IP', () => {
    const testIp = '192.0.2.55';
    for (let i = 0; i < 6; i++) {
      const failRes = loginWithMasterAdmin({
        identifier: 'admin',
        password: 'wrong-password-123',
        clientIp: testIp,
      });
      assert.equal(failRes.ok, false);
      if (!failRes.ok) {
        assert.equal(failRes.status, 401);
      }
    }

    const lockedRes = loginWithMasterAdmin({
      identifier: 'admin',
      password: INITIAL_BOOTSTRAP_PW,
      clientIp: testIp,
    });
    assert.equal(lockedRes.ok, false);
    if (!lockedRes.ok) {
      assert.equal(lockedRes.status, 429);
    }
  });

  it('rotates credentials, bumps tokenVersion, and invalidates older tokens', () => {
    const oldLogin = loginWithMasterAdmin({
      identifier: 'admin',
      password: INITIAL_BOOTSTRAP_PW,
      clientIp: '10.0.0.3',
    });
    assert.equal(oldLogin.ok, true);
    if (!oldLogin.ok) return;

    const updated = changeMasterAdminCredentials({
      currentPassword: INITIAL_BOOTSTRAP_PW,
      newUsername: 'superowner',
      newPassword: 'NewStrongPassword#2026',
      displayName: 'مالك المنصة',
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;

    assert.equal(updated.session.username, 'superowner');
    assert.equal(updated.session.displayName, 'مالك المنصة');
    assert.equal(updated.session.mustChangePassword, false);

    // Old token should be rejected immediately after version bump
    assert.equal(verifyMasterAdminToken(oldLogin.token), null);

    // New token must verify cleanly
    const verifiedNew = verifyMasterAdminToken(updated.token);
    assert.equal(verifiedNew?.username, 'superowner');
    assert.equal(verifiedNew?.mustChangePassword, false);

    // Old password must fail
    const oldAttempt = loginWithMasterAdmin({
      identifier: 'superowner',
      password: INITIAL_BOOTSTRAP_PW,
      clientIp: '10.0.0.4',
    });
    assert.equal(oldAttempt.ok, false);

    // New password must succeed
    const newAttempt = loginWithMasterAdmin({
      identifier: 'superowner',
      password: 'NewStrongPassword#2026',
      clientIp: '10.0.0.5',
    });
    assert.equal(newAttempt.ok, true);
  });
});
