import assert from 'node:assert/strict';
import test from 'node:test';
import { formatShortServerName } from '../src/lib/playerTheme';

test('formatShortServerName simplifies verbose server names cleanly for mobile grids', () => {
  assert.equal(formatShortServerName('سيرفر RahaL TV الرئيسي', 0), 'RahaL TV');
  assert.equal(formatShortServerName('VidStream Pro', 1), 'VidStream');
  assert.equal(formatShortServerName('MegaCloud 4K', 2), 'MegaCloud');
  assert.equal(formatShortServerName('FastCDN Mirror', 3), 'FastCDN');
  assert.equal(formatShortServerName('1vid', 0), '1vid');
  assert.equal(formatShortServerName('سيرفر 2 بدون تقطيع', 1), 'سيرفر 2');
});

test('formatShortServerName extracts clean host name when name is generic numbered server with URL', () => {
  assert.equal(
    formatShortServerName('سيرفر 1', 0, 'https://vidmoly.to/embed-abc123.html'),
    'Vidmoly'
  );
  assert.equal(formatShortServerName('سيرفر 3', 2), 'سيرفر 3');
  assert.equal(formatShortServerName('', 4), 'سيرفر 5');
});
