const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

const now = Date.parse('2026-11-21T10:00:00+08:00');
const window = C.timeWindow('2026-11-21', false, now);
const raw = (pid, changes = {}) => ({ pid, text: '一条虚构帖子 #课程心得', timestamp: (window.start + 1000) / 1000, likenum: 3, reply: 4, ...changes });
const payload = rows => ({ code: 20000, data: { list: rows } });

test('Beijing dates handle UTC day boundaries regardless of host timezone', () => {
  assert.equal(C.dayKey(Date.parse('2026-11-20T16:01:00Z')), '2026-11-21');
  assert.equal(C.dayKey(Date.parse('2026-11-20T15:59:00Z')), '2026-11-20');
  assert.equal(window.start, Date.parse('2026-11-20T16:00:00Z'));
});
test('date validation and rolling windows', () => {
  assert.throws(() => C.timeWindow('2026-02-30'), /有效日期/);
  assert.throws(() => C.timeWindow('bad'), /有效日期/);
  assert.equal(C.timeWindow('2026-11-20', false, now).end - C.timeWindow('2026-11-20', false, now).start, 86400000);
  assert.deepEqual(C.timeWindow('', true, now), { start: now - 86400000, end: now, date: '过去 24 小时' });
});
test('timestamps support seconds, milliseconds and Beijing-local datetimes', () => {
  assert.equal(C.timestamp(now / 1000), now);
  assert.equal(C.timestamp(String(now)), now);
  assert.equal(C.timestamp('2026-11-21 10:00:00'), now);
  assert.equal(C.timestamp('2026-11-21T02:00:00Z'), now);
  assert.equal(C.timestamp('bad'), null);
  assert.equal(C.timestamp(null), null);
});
test('map favorites and comments without substituting likes or missing counts with zero', () => {
  const post = C.normalizePost(raw(100, { likenum: '12', comment_total: 19, reply: 4, likes: 999 }));
  assert.equal(post.favorites, 12); assert.equal(post.comments, 19);
  assert.equal(C.normalizePost(raw(101, { likenum: undefined })).favorites, null);
});
test('unknown schema and failed business responses stop collection', () => {
  for (const bad of [{}, { code: 403, data: { list: [] } }, { success: false, data: [] }, payload([{ pid: 3 }]), payload([raw(1, { timestamp: 'bad' })])]) {
    assert.throws(() => C.parsePage(bad));
  }
  assert.equal(C.parsePage({ success: true, data: { data: [raw(1)], last_page: 2 } }).lastPage, 2);
});
test('subscriptions uniformly match official labels and body text with or without hashtags', () => {
  const post = C.normalizePost(raw(1, { text: '需要实习建议 #GY #123456', label_info: [{ label_name: '课程心得' }] }));
  assert(C.matches(post, { type: 'tag', value: '课程心得' }));
  assert(C.matches(post, { type: 'tag', value: '#gy' }));
  assert(C.matches(post, { type: 'tag', value: '实习' }));
  assert(C.matches(post, { type: 'keyword', value: '实习' }));
  assert(!post.tags.includes('123456'));
});
test('English keywords match complete words, case insensitively, including beside Chinese text', () => {
  for (const text of ['AI', '#ai', '聊聊AI发展', 'AI相关', 'ai-powered', '（Ai）', 'ＡＩ 实习']) {
    assert(C.matches(C.normalizePost(raw(1, { text })), { value: 'AI' }), text);
  }
  for (const text of ['daily', 'DAILY digest', 'OpenAI', 'AIGC', 'ai2', 'my_ai', 'train']) {
    assert(!C.matches(C.normalizePost(raw(1, { text })), { value: 'ai' }), text);
  }
  assert(!C.matches(C.normalizePost(raw(1, { text: '', label_info: { name: 'daily' } })), { value: 'ai' }));
});
test('keyword punctuation is literal, Chinese still supports substring matching', () => {
  assert(C.matches(C.normalizePost(raw(1, { text: '想学 C++ 和实习准备' })), { value: 'c++' }));
  assert(!C.matches(C.normalizePost(raw(1, { text: 'abc' })), { value: 'a.c' }));
  assert(C.matches(C.normalizePost(raw(1, { text: '一篇 a.c 教程' })), { value: 'a.c' }));
  assert(C.matches(C.normalizePost(raw(1, { text: '想找暑期实习' })), { value: '实习' }));
});
test('old tags and keywords migrate into one deduplicated subscription list', () => {
  assert.deepEqual(C.normalizeSubscriptions([
    { type: 'tag', value: '#AI' }, { type: 'keyword', value: 'ai' }, ' 实习 ', null,
    { value: 'ＡＩ' }, { value: '' }, { value: 'x'.repeat(61) }
  ]), [{ value: 'AI' }, { value: '实习' }]);
  assert.equal(C.subscriptionKey({ type: 'tag', value: '#AI' }), C.subscriptionKey({ value: 'ai' }));
});
test('references accept all full numeric runs of six or more digits with or without #', () => {
  const post = C.normalizePost(raw(123456, { text: '8768944 和 #8768944，#12345、1234、１２３４５６、abc654321xyz、123456789012' }));
  assert.deepEqual(post.references, ['8768944', '123456', '654321', '123456789012']);
});
test('reference counts exclude duplicate mentions, self references and repeated source posts', () => {
  const a = C.normalizePost(raw(123456, { text: '#654321 654321 #123456' }));
  const b = C.normalizePost(raw(123457, { text: '654321' }));
  const refs = C.referenceCounts([a, a, b]);
  assert.equal(refs.get('654321'), 2);
  assert.equal(refs.get('123456'), undefined);
});
test('time filter is half open and unions subscriptions', () => {
  const posts = [
    C.normalizePost(raw(1, { timestamp: window.start / 1000, text: '#课程心得' })),
    C.normalizePost(raw(2, { timestamp: (window.end - 1) / 1000, text: '#实习' })),
    C.normalizePost(raw(3, { timestamp: window.end / 1000 })),
    C.normalizePost(raw(4, { timestamp: (window.start - 1) / 1000 }))
  ];
  const subscriptions = [{ type: 'tag', value: '课程心得' }, { type: 'keyword', value: '实习' }];
  assert.deepEqual(C.selectPosts(posts, window, subscriptions).map(p => p.id), ['1', '2']);
});
test('rank cumulative metrics, unknown fields last and stable tie breaks without mutating input', () => {
  const posts = [C.normalizePost(raw(1, { likenum: null })), C.normalizePost(raw(2, { likenum: 20 })), C.normalizePost(raw(3, { likenum: 20 }))];
  assert.deepEqual(C.rank(posts, 'favorites').map(p => p.id), ['3', '2', '1']);
  assert.deepEqual(posts.map(p => p.id), ['1', '2', '3']);
});
test('pagination ignores stale pinned posts and one old page, deduplicates overlapping pages', async () => {
  const old = window.start / 1000 - 86400;
  const pages = [
    [raw(1, { timestamp: old, is_top: 1 }), raw(2)],
    [raw(2, { likenum: 55 }), raw(3)],
    [raw(4, { timestamp: old })],
    [raw(5, { timestamp: old })]
  ];
  const result = await C.collect({ fetchPage: async page => payload(pages[page - 1]), window, sleep: async () => {} });
  assert.equal(result.reason, 'boundary'); assert.equal(result.pages, 4);
  assert.equal(result.posts.length, 5); assert.equal(result.posts.find(p => p.id === '2').favorites, 55);
});
test('a short page and a capped total do not incorrectly imply exhaustion', async () => {
  let requested = 0;
  const result = await C.collect({ fetchPage: async page => { requested++; return { code: 20000, data: { list: page < 3 ? [raw(page)] : [], total: 1 } }; }, window, sleep: async () => {} });
  assert.equal(requested, 3); assert.equal(result.reason, 'end');
});
test('repeated pages and page budget explicitly report incomplete coverage', async () => {
  const repeated = await C.collect({ fetchPage: async () => payload([raw(1)]), window, sleep: async () => {} });
  assert.equal(repeated.reason, 'repeated');
  const limited = await C.collect({ fetchPage: async page => payload([raw(page)]), window, maxPages: 2, sleep: async () => {} });
  assert.equal(limited.reason, 'limit'); assert.equal(limited.pages, 2);
});
test('cancellation stops further requests', async () => {
  const controller = new AbortController(); let requests = 0;
  await assert.rejects(C.collect({ window, signal: controller.signal,
    fetchPage: async () => { requests++; return payload([raw(1)]); },
    onProgress: () => controller.abort(), delayMs: 10
  }), { name: 'AbortError' });
  assert.equal(requests, 1);
});
test('only fixed same-origin read-only endpoint receives credentials; redirects rejected', async () => {
  let captured;
  const fetcher = C.makeFetcher({ fetchImpl: async (url, options) => { captured = { url, options }; return { ok: true, json: async () => payload([]) }; }, getHeaders: () => ({ Authorization: 'Bearer mock' }) });
  await fetcher(2);
  assert.equal(new URL(captured.url).origin, 'https://treehole.pku.edu.cn');
  assert.equal(new URL(captured.url).pathname, C.API_PATH);
  assert.equal(new URL(captured.url).searchParams.get('page'), '2');
  assert.equal(captured.options.method, 'GET'); assert.equal(captured.options.credentials, 'include');
  assert.equal(captured.options.redirect, 'error');
  assert.throws(() => C.makeFetcher({ origin: 'https://example.com' }), /原站/);
});
test('auth expiry and rate limiting stop immediately with useful errors', async () => {
  for (const [status, message] of [[401, /登录/], [403, /登录/], [429, /频率/], [503, /HTTP 503/]]) {
    const fetcher = C.makeFetcher({ fetchImpl: async () => ({ ok: false, status }), getHeaders: () => ({}) });
    await assert.rejects(fetcher(1), message);
  }
});
test('request timeouts and parent cancellation are distinguished', async () => {
  const fakeFetch = async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  const fetcher = C.makeFetcher({ fetchImpl: fakeFetch, getHeaders: () => ({}), timeoutMs: 15 });
  await assert.rejects(fetcher(1), /超时/);
  const controller = new AbortController(); const pending = fetcher(1, controller.signal); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
test('network exceptions do not leak URLs or headers into error messages', async () => {
  const fetcher = C.makeFetcher({ fetchImpl: async () => { throw new TypeError('request mock-secret'); }, getHeaders: () => ({}) });
  await assert.rejects(fetcher(1), error => !error.message.includes('mock-secret') && /连接/.test(error.message));
});
