import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enterGuestSession,
  exitGuestSession,
  GUEST_SESSION_STORAGE_KEY,
  isGuestSessionActive,
  loadGuestSession,
} from '../src/lib/guestSession';
import {
  applyTypographyToDocument,
  DEFAULT_TYPOGRAPHY_CONFIG,
} from '../src/lib/typographyConfig';
import {
  buildAdminAppearanceCssVars,
  DEFAULT_ADMIN_APPEARANCE,
  normalizeAdminAppearance,
  resetAdminAppearance,
  saveAdminAppearance,
} from '../src/lib/adminAppearance';
import {
  buildDefaultAdminNavLayout,
  createCustomNavGroup,
  deleteCustomNavGroup,
  getOrderedSubOptions,
  moveGroupInLayout,
  moveItemInLayout,
  normalizeAdminNavLayout,
  renameNavGroup,
  reorderSubOptionInLayout,
  resolveSidebarGroupsForRender,
  toggleItemHiddenInLayout,
} from '../src/lib/adminNavLayout';
import { isTabAccessible } from '../src/components/admin/adminNavigation';
import { DEFAULT_MODERATOR_SUB_PERMS } from '../src/lib/adminPreferences';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

test('Guest Session: enters cleanly, persists in storage without Firebase, and exits cleanly', () => {
  const storage = createMemoryStorage();
  const prevWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { localStorage: storage };

  try {
    exitGuestSession();
    assert.equal(loadGuestSession(), null);

    const session = enterGuestSession();
    assert.equal(session.active, true);
    assert.equal(session.displayName, 'ضيف');
    assert.equal(isGuestSessionActive(session), true);

    const persistedRaw = storage.getItem(GUEST_SESSION_STORAGE_KEY);
    assert.ok(persistedRaw, 'Guest session should persist in localStorage');

    const reloaded = loadGuestSession();
    assert.ok(reloaded);
    assert.equal(reloaded?.displayName, 'ضيف');
    assert.equal(reloaded?.active, true);

    exitGuestSession();
    assert.equal(storage.getItem(GUEST_SESSION_STORAGE_KEY), null);
    assert.equal(loadGuestSession(), null);
    assert.equal(isGuestSessionActive(null), false);
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  }
});

test('Font & CSS Isolation: Site typography only mutates --rtv-site-* and Admin uses --rtv-admin-*', () => {
  const rootVars = new Map<string, string>();
  const rootStyleObj = {
    fontSize: '',
    setProperty(k: string, v: string) {
      rootVars.set(k, v);
    },
  };
  const prevDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    documentElement: { style: rootStyleObj },
    head: { appendChild() {} },
    getElementById() {
      return null;
    },
    createElement() {
      return { id: '', rel: '', href: '', textContent: '', remove() {} };
    },
  };

  try {
    applyTypographyToDocument(
      {
        ...DEFAULT_TYPOGRAPHY_CONFIG,
        arabicFont: 'Almarai',
        baseFontSizePx: 19,
        heroTitleSizePx: 30,
      },
      {}
    );

    assert.equal(rootStyleObj.fontSize, '', 'Site typography must NOT mutate root <html> fontSize');
    assert.equal(rootVars.get('--font-sans'), undefined, 'Site typography must NOT overwrite global --font-sans');
    assert.equal(rootVars.get('--rtv-site-base-size'), '19px');
    assert.ok(rootVars.get('--rtv-site-font-sans')?.includes('Almarai'));

    // Verify Admin CSS variable namespace has zero overlap with site variables
    const adminVars = buildAdminAppearanceCssVars({
      fontFamily: 'IBM Plex Sans Arabic',
      bodyTextPx: 15,
      colorMode: 'light',
    });
    for (const key of Object.keys(adminVars)) {
      assert.ok(key.startsWith('--rtv-admin-'), `Unexpected CSS variable key ${key}`);
    }
    assert.ok(adminVars['--rtv-admin-font-family'].includes('IBM Plex Sans Arabic'));
    assert.equal(adminVars['--rtv-admin-body-size'], '15px');
  } finally {
    if (prevDoc === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  }
});

test('Admin Appearance: clamps granular font sizes, validates weights, layout sliders, and resets defaults', () => {
  const storage = createMemoryStorage();
  const prevWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { localStorage: storage };

  try {
    const normalized = normalizeAdminAppearance({
      fontFamily: 'Readex Pro',
      fontWeight: 700,
      headingMainPx: 99,
      headingSectionPx: 4,
      bodyTextPx: 16,
      secondaryTextPx: 14,
      buttonTextPx: 15,
      sidebarItemPx: 14,
      tableTextPx: 15,
      inputTextPx: 14,
      sidebarWidthPx: 450,
      iconSizePx: 22,
      navItemSpacingPx: 10,
      buttonHeightPx: 44,
      tableDensity: 'comfortable',
      borderRadiusPx: 24,
      cardPaddingPx: 28,
      cardTitlePx: 20,
      colorMode: 'light',
    });

    assert.equal(normalized.fontFamily, 'Readex Pro');
    assert.equal(normalized.fontWeight, 700);
    assert.equal(normalized.headingMainPx, 32); // clamped max
    assert.equal(normalized.headingSectionPx, 14); // clamped min
    assert.equal(normalized.sidebarWidthPx, 360); // clamped max
    assert.equal(normalized.colorMode, 'light');
    assert.equal(normalized.tableDensity, 'comfortable');

    // Invalid weight falls back to default 500
    const badWeight = normalizeAdminAppearance({ fontWeight: 999 as never });
    assert.equal(badWeight.fontWeight, DEFAULT_ADMIN_APPEARANCE.fontWeight);

    saveAdminAppearance(normalized);
    const reset = resetAdminAppearance();
    assert.deepEqual(reset, DEFAULT_ADMIN_APPEARANCE);
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  }
});

test('Admin Nav Layout: supports group/item reorder, custom groups, rename, hide/show without altering RBAC, and sub-option ordering', () => {
  let layout = buildDefaultAdminNavLayout();
  const initialCount = layout.groups.reduce((acc, g) => acc + g.items.length, 0);

  // Reconciles missing tabs automatically
  const partial = normalizeAdminNavLayout({
    version: 1,
    groups: [{ id: 'dashboard', label: 'لوحة القيادة المعدّلة', items: [{ id: 'overview' }] }],
  });
  assert.equal(
    partial.groups.reduce((acc, g) => acc + g.items.length, 0),
    initialCount,
    'Normalization must preserve all canonical tabs without dropping any route'
  );
  assert.equal(partial.groups[0].label, 'لوحة القيادة المعدّلة');

  // Move first group down
  const firstGroupId = layout.groups[0].id;
  layout = moveGroupInLayout(layout, 0, 1);
  assert.equal(layout.groups[1].id, firstGroupId);

  // Create custom group, rename it, move a tab into it, then delete custom group cleanly
  layout = createCustomNavGroup(layout, 'مجموعتي السريعة');
  const customGroup = layout.groups.find((g) => g.isCustom);
  assert.ok(customGroup);
  layout = renameNavGroup(layout, customGroup!.id, 'أدوات اليوم');
  assert.equal(layout.groups.find((g) => g.id === customGroup!.id)?.label, 'أدوات اليوم');

  layout = moveItemInLayout(layout, 'catalog', customGroup!.id, 0);
  assert.equal(
    layout.groups.find((g) => g.id === customGroup!.id)?.items[0]?.id,
    'catalog'
  );

  // Deleting custom group returns 'catalog' cleanly to its canonical group
  layout = deleteCustomNavGroup(layout, customGroup!.id);
  assert.equal(layout.groups.find((g) => g.id === customGroup!.id), undefined);
  assert.ok(
    layout.groups.some((g) => g.items.some((i) => i.id === 'catalog')),
    'Deleting custom group must restore moved items'
  );

  // Hiding an item hides it from sidebar while keeping RBAC permission untouched
  layout = toggleItemHiddenInLayout(layout, 'catalog');
  const rendered = resolveSidebarGroupsForRender(layout, true, DEFAULT_MODERATOR_SUB_PERMS);
  assert.equal(
    rendered.some((g) => g.items.some((i) => i.id === 'catalog')),
    false
  );
  assert.equal(isTabAccessible('catalog', false, DEFAULT_MODERATOR_SUB_PERMS), true);
  assert.equal(isTabAccessible('admin_appearance', false, DEFAULT_MODERATOR_SUB_PERMS), false);

  // Sub-option reordering inside a section
  const beforeSubs = getOrderedSubOptions('admin_appearance', layout).map((s) => s.id);
  layout = reorderSubOptionInLayout(layout, 'admin_appearance', 0, 2);
  const afterSubs = getOrderedSubOptions('admin_appearance', layout).map((s) => s.id);
  assert.equal(afterSubs[2], beforeSubs[0]);
});
