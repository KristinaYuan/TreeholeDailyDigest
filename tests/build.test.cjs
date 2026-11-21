const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('standalone demo preserves executable JavaScript through template substitution', () => {
  const html = readFileSync(path.join(__dirname, '../demo/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert(scripts.length >= 4);
  assert(!html.includes('src="'));
  scripts.forEach((match, index) => assert.doesNotThrow(() => new vm.Script(match[1]), `inline script ${index}`));
});
test('installable userscript updates only from the latest release without remote runtime dependencies', () => {
  const source = readFileSync(path.join(__dirname, '../dist/treehole-digest.user.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(source));
  assert(!/@(?:require|connect)\s/.test(source));
  const releaseURL = 'https://github.com/KristinaYuan/TreeholeDailyDigest/releases/latest/download/treehole-digest.user.js';
  for (const field of ['updateURL', 'downloadURL']) {
    assert.equal(source.match(new RegExp(`@${field}\\s+(\\S+)`))?.[1], releaseURL);
  }
  assert.match(source, /@grant\s+none/);
});
