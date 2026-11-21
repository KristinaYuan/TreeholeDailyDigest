const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

function fixture() {
  let clock = Date.parse('2026-11-21T10:00:00+08:00');
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const window = C.timeWindow('2026-11-21', false, clock);
  const result = { pages: 2, reason: 'boundary', posts: [C.normalizePost({
    pid: 8768944, text: 'AI 实习，引用 8768000', timestamp: clock / 1000, likenum: 144, reply: 224,
    token: 'mock-secret-never-persist', cookie: 'mock-cookie'
  })] };
  return { storage, values, window, result, now: () => clock, advance: ms => { clock += ms; } };
}

test('fresh cache restores full results across reload and keeps the original time cutoff', () => {
  const f = fixture();
  const cache = C.createCache({ storage: f.storage, now: f.now });
  assert(cache.write(f.result, f.window, f.now()));
  f.advance(60000);
  const reloaded = C.createCache({ storage: f.storage, now: f.now });
  const entry = reloaded.read(C.timeWindow('2026-11-21', false, f.now()));
  assert.equal(entry.posts[0].favorites, 144);
  assert.equal(entry.window.end, f.window.end);
  assert.deepEqual(entry.posts[0].references, ['8768000']);
  assert(![...f.values.values()].join('').includes('mock-secret'));
  assert(![...f.values.values()].join('').includes('mock-cookie'));
});
test('five minute TTL expires exactly and does not cross calendar dates or mix rolling windows', () => {
  const f = fixture(); const cache = C.createCache({ storage: f.storage, now: f.now });
  cache.write(f.result, f.window, f.now());
  assert.equal(cache.read(C.timeWindow('2026-11-20', false, f.now())), null);
  assert.equal(cache.read(C.timeWindow('', true, f.now())), null);
  f.advance(C.CACHE_TTL_MS - 1); assert(cache.read(f.window));
  f.advance(1); assert.equal(cache.read(f.window), null);
});
test('cache retains only the three most recent requested time ranges', () => {
  const f = fixture(); const cache = C.createCache({ storage: f.storage, now: f.now });
  for (const date of ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']) {
    f.advance(1); cache.write(f.result, C.timeWindow(date, false, f.now()), f.now());
  }
  assert.equal(cache.read(C.timeWindow('2026-11-18', false, f.now())), null);
  assert(cache.read(C.timeWindow('2026-11-19', false, f.now())));
  assert.equal(JSON.parse([...f.values.values()][0]).items.length, 3);
});
test('corrupt and incompatible caches fail closed', () => {
  const f = fixture(); const key = 'test';
  for (const bad of ['{', JSON.stringify({ schema: 1, items: [] }), JSON.stringify({ schema: 2, items: [{ scope: C.cacheKey(f.window), savedAt: f.now(), posts: [null] }] })]) {
    f.storage.setItem(key, bad);
    assert.equal(C.createCache({ storage: f.storage, key, now: f.now }).read(f.window), null);
  }
});
test('storage quota failure keeps the new in-memory result rather than returning an older persisted one', () => {
  const f = fixture(); const cache = C.createCache({ storage: f.storage, now: f.now });
  cache.write(f.result, f.window, f.now()); f.advance(1000);
  f.storage.setItem = () => { throw new Error('quota exceeded'); };
  const updated = { ...f.result, posts: [{ ...f.result.posts[0], favorites: 150 }] };
  assert.equal(cache.write(updated, f.window, f.now()), false);
  assert.equal(cache.read(f.window).posts[0].favorites, 150);
  cache.clear(); assert.equal(cache.read(f.window), null);
});
test('account namespaces do not share cached content', () => {
  const f = fixture();
  C.createCache({ storage: f.storage, key: 'account-a', now: f.now }).write(f.result, f.window, f.now());
  assert.equal(C.createCache({ storage: f.storage, key: 'account-b', now: f.now }).read(f.window), null);
});
