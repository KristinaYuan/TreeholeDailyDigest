/* Shared by the userscript, demo and Node tests. No browser credentials here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TreeholeDigestCore = api;
})(globalThis, function () {
  'use strict';

  const ZONE = 'Asia/Shanghai';
  const API_PATH = '/chapi/api/v3/hole/list_comments';
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const fold = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('zh-CN');

  function dayKey(now = Date.now()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(now));
    const get = type => parts.find(part => part.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function timeWindow(date, rolling = false, now = Date.now()) {
    if (rolling) return { start: now - 86400000, end: now, date: '过去 24 小时' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择有效日期');
    const start = Date.parse(`${date}T00:00:00+08:00`);
    if (!Number.isFinite(start) || dayKey(start) !== date) throw new Error('请选择有效日期');
    return { start, end: Math.min(start + 86400000, now + 1), date };
  }

  function timestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (Number.isFinite(number)) return number < 1e11 ? number * 1000 : number;
    const text = String(value).trim().replace(' ', 'T');
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
    const parsed = Date.parse(hasZone ? text : `${text}+08:00`);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function count(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
  }

  function labelNames(value) {
    if (!value) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(labelNames);
    if (typeof value === 'object') return labelNames(value.name ?? value.label_name ?? value.label ?? value.text);
    return [];
  }

  function normalizePost(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.pid ?? raw.id ?? '');
    const createdAt = timestamp(raw.timestamp ?? raw.created_at ?? raw.create_time);
    if (!/^[1-9]\d*$/.test(id) || createdAt === null || typeof raw.text !== 'string') return null;
    const tags = [...new Set([
      ...labelNames(raw.label_info), ...labelNames(raw.labels), ...labelNames(raw.tags),
      ...Array.from(raw.text.matchAll(/(?:^|[\s，。；,;！!？?（(])#([^\s#，。；,;！!？?（）()]+)/gu), match => match[1])
        .filter(tag => !/^\d+$/.test(tag))
    ].map(fold).filter(Boolean))];
    return {
      id, text: raw.text, createdAt, tags,
      favorites: count(raw.likenum),
      comments: count(raw.comment_total ?? raw.reply),
      pinned: Boolean(Number(raw.is_top ?? 0)),
      references: [...new Set(raw.text.normalize('NFKC').match(/\d{6,}/g) ?? [])]
    };
  }

  function parsePage(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('接口响应格式变化，已停止读取');
    if (payload.code !== undefined && Number(payload.code) !== 20000 && Number(payload.code) !== 200) {
      throw new Error('树洞未返回成功结果，请确认登录状态或稍后重试');
    }
    if (payload.success === false) throw new Error('树洞拒绝了请求，请确认登录状态');
    const data = payload.data;
    const rows = Array.isArray(data) ? data : data?.list ?? data?.data;
    if (!Array.isArray(rows)) throw new Error('接口中没有预期的帖子列表，已停止读取');
    const posts = rows.map(normalizePost);
    if (posts.some(post => !post)) throw new Error('帖子字段发生变化，已停止读取，避免生成错误榜单');
    return { posts, total: count(data?.total), lastPage: count(data?.last_page) };
  }

  function subscriptionKey(subscription) {
    return fold(typeof subscription === 'string' ? subscription : subscription.value).replace(/^#+/, '').trim();
  }

  function normalizeSubscriptions(subscriptions) {
    const unique = new Map();
    for (const subscription of Array.isArray(subscriptions) ? subscriptions : []) {
      const value = String(typeof subscription === 'string' ? subscription : subscription?.value ?? '')
        .normalize('NFKC').trim().replace(/^#+/, '').trim();
      if (value && value.length <= 60 && !unique.has(subscriptionKey(value))) unique.set(subscriptionKey(value), { value });
      if (unique.size >= 30) break;
    }
    return [...unique.values()];
  }

  function containsKeyword(text, value) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const left = /^[a-z0-9_]/i.test(value) ? '(^|[^a-z0-9_])' : '';
    const right = /[a-z0-9_]$/i.test(value) ? '($|[^a-z0-9_])' : '';
    return new RegExp(left + escaped + right, 'u').test(fold(text));
  }

  function matches(post, subscription) {
    const value = subscriptionKey(subscription);
    if (!value) return false;
    return post.tags.some(tag => containsKeyword(tag, value)) || containsKeyword(post.text, value);
  }

  function selectPosts(posts, window, subscriptions = []) {
    return posts.filter(post => post.createdAt >= window.start && post.createdAt < window.end &&
      (!subscriptions.length || subscriptions.some(subscription => matches(post, subscription))));
  }

  // Each referring post contributes at most once; self references do not count.
  function referenceCounts(posts) {
    const counts = new Map();
    for (const post of new Map(posts.map(post => [post.id, post])).values()) {
      for (const id of post.references) {
        if (id !== post.id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }

  function rank(posts, metric, references = referenceCounts(posts)) {
    if (!['favorites', 'comments', 'references', 'newest'].includes(metric)) throw new Error('未知排序');
    const value = post => metric === 'newest' ? post.createdAt :
      metric === 'references' ? references.get(post.id) ?? 0 : post[metric];
    return [...posts].sort((a, b) => {
      const av = value(a), bv = value(b);
      if (av === null && bv !== null) return 1;
      if (bv === null && av !== null) return -1;
      return (bv ?? -1) - (av ?? -1) || b.createdAt - a.createdAt || Number(b.id) - Number(a.id);
    });
  }

  function cacheKey(window) { return window.date === '过去 24 小时' ? 'rolling' : `day:${window.date}`; }

  function createCache({ storage, key = 'treehole-daily-digest:cache:v2', ttlMs = CACHE_TTL_MS, now = Date.now, maxEntries = 3 }) {
    let memory = [];
    function readEntries() {
      let items = [...memory];
      try {
        const value = JSON.parse(storage.getItem(key) || 'null');
        if (value?.schema === 2 && Array.isArray(value.items)) items.push(...value.items);
      } catch { /* Retain the current page's memory cache. */ }
      items = items.filter(item => item && Number.isFinite(item.savedAt) &&
        now() >= item.savedAt && now() - item.savedAt < ttlMs).sort((a, b) => b.savedAt - a.savedAt);
      return [...new Map(items.reverse().map(item => [item.scope, item])).values()].sort((a, b) => b.savedAt - a.savedAt);
    }
    function read(window) {
      const entry = readEntries().find(item => item.scope === cacheKey(window));
      if (!entry || !Array.isArray(entry.posts) || entry.posts.length > 3000 ||
        !Number.isFinite(entry.fetchedAt) || !Number.isFinite(entry.window?.start) || !Number.isFinite(entry.window?.end) ||
        cacheKey(entry.window) !== cacheKey(window) || !['boundary', 'end', 'limit', 'repeated'].includes(entry.reason)) return null;
      // Re-normalize text so old matching/reference rules never survive a script update.
      const posts = entry.posts.map(post => normalizePost({
        pid: post?.id, text: post?.text, timestamp: post?.createdAt,
        likenum: post?.favorites, comment_total: post?.comments, labels: post?.tags, is_top: post?.pinned
      }));
      if (posts.some(post => !post)) return null;
      return { ...entry, posts };
    }
    function write(result, window, fetchedAt) {
      const entry = {
        scope: cacheKey(window), savedAt: now(), fetchedAt, window: { ...window },
        pages: result.pages, reason: result.reason,
        posts: result.posts.map(post => ({ id: post.id, text: post.text, createdAt: post.createdAt,
          favorites: post.favorites, comments: post.comments, tags: post.tags, pinned: post.pinned }))
      };
      const items = [entry, ...readEntries().filter(item => item.scope !== entry.scope)].slice(0, maxEntries);
      memory = items;
      // Under a small browser quota retain just the current result; otherwise degrade to in-memory use.
      for (const candidates of [items, [entry]]) {
        try { storage.setItem(key, JSON.stringify({ schema: 2, items: candidates })); return true; }
        catch { /* Storage may be disabled or full. */ }
      }
      return false;
    }
    function clear() { memory = []; try { storage.removeItem(key); } catch { /* Optional browser storage. */ } }
    return { read, write, clear };
  }

  function abortError() { return new DOMException('已停止读取', 'AbortError'); }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(finish, ms);
      function cancel() { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(abortError()); }
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  async function collect({ fetchPage, window, maxPages = 60, delayMs = 1200, signal, onProgress = () => {}, sleep = delay }) {
    const posts = new Map();
    const signatures = new Set();
    let oldPages = 0;
    let pages = 0;
    for (let page = 1; page <= maxPages; page++) {
      if (signal?.aborted) throw abortError();
      const parsed = parsePage(await fetchPage(page, signal));
      pages = page;
      const signature = parsed.posts.map(post => post.id).join(',');
      if (parsed.posts.length && signatures.has(signature)) return { posts: [...posts.values()], pages, reason: 'repeated' };
      signatures.add(signature);
      for (const post of parsed.posts) posts.set(post.id, post);
      onProgress({ pages, count: posts.size });
      if (!parsed.posts.length) return { posts: [...posts.values()], pages, reason: 'end' };
      const normal = parsed.posts.filter(post => !post.pinned);
      oldPages = normal.length && normal.every(post => post.createdAt < window.start) ? oldPages + 1 : 0;
      // Two older pages tolerate pinned/isolated older posts; the API is assumed newest-first.
      if (oldPages >= 2) return { posts: [...posts.values()], pages, reason: 'boundary' };
      if (parsed.lastPage !== null && page >= parsed.lastPage) return { posts: [...posts.values()], pages, reason: 'end' };
      // Do not infer exhaustion from a short page or total: the server may cap either.
      if (page < maxPages) await sleep(delayMs, signal);
    }
    return { posts: [...posts.values()], pages, reason: 'limit' };
  }

  function makeFetcher({ fetchImpl, getHeaders, origin = 'https://treehole.pku.edu.cn', timeoutMs = 15000 }) {
    if (new URL(origin).origin !== 'https://treehole.pku.edu.cn') throw new Error('只能向树洞原站发送请求');
    return async (page, signal) => {
      const url = new URL(API_PATH, origin);
      url.search = new URLSearchParams({ page, limit: 50, comment_limit: 0, keyword: '' });
      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (signal?.aborted) throw abortError();
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, timeoutMs);
      try {
        const response = await fetchImpl(url.href, {
          method: 'GET', credentials: 'include', redirect: 'error',
          headers: getHeaders(), signal: controller.signal
        });
        if (response.status === 401 || response.status === 403) throw new Error('登录已失效，请在树洞原页重新登录后重试');
        if (response.status === 429) throw new Error('读取频率受到限制，已停止；请过一段时间再试');
        if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}），请稍后重试`);
        return await response.json();
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (controller.signal.aborted) throw new Error('请求超时，已停止读取，请稍后重试');
        if (error instanceof SyntaxError) throw new Error('树洞没有返回 JSON，请确认登录状态');
        // Browser network errors may include URLs; never display raw request details.
        if (error instanceof TypeError) throw new Error('无法连接树洞，请检查网络并确认登录状态');
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    };
  }

  return { ZONE, API_PATH, CACHE_TTL_MS, fold, dayKey, timeWindow, timestamp, normalizePost, parsePage,
    subscriptionKey, normalizeSubscriptions, matches, selectPosts, referenceCounts, rank, cacheKey, createCache, collect, makeFetcher };
});
