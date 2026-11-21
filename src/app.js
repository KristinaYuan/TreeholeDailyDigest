(async function () {
  'use strict';
  const C = globalThis.TreeholeDigestCore;
  const demo = document.documentElement.dataset.treeholeDemo === 'true' &&
    (location.protocol === 'file:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost');
  if (!demo && (location.origin !== 'https://treehole.pku.edu.cn' || !/^\/(ch\/)?web(?:\/|$)/.test(location.pathname))) return;
  if (document.querySelector('#treehole-digest')) return;

  const PREFS = 'treehole-daily-digest:prefs:v1';
  function loadPrefs() {
    try {
      const value = JSON.parse(localStorage.getItem(PREFS) || '{}');
      const subscriptions = C.normalizeSubscriptions(value.subscriptions);
      return {
        subscriptions,
        readThrough: Object.fromEntries(subscriptions.map(s => {
          const key = C.subscriptionKey(s);
          const read = Number(value.readThrough && typeof value.readThrough === 'object' ? value.readThrough[key] : value.readThrough);
          return [key, Number.isFinite(read) && read >= 0 ? read : 0];
        })),
        autoOpen: value.autoOpen !== false
      };
    } catch { return { subscriptions: [], readThrough: {}, autoOpen: true }; }
  }
  const prefs = loadPrefs();
  const state = { posts: [], window: C.timeWindow(C.dayKey()), metric: 'favorites', view: 'rank', busy: false,
    result: null, fetchedAt: null, onlyNew: false, controller: null, activeWindow: null,
    activeSubscription: prefs.subscriptions.length ? C.subscriptionKey(prefs.subscriptions[0]) : null };
  let cache = C.createCache({ storage: null });
  try {
    const token = demo ? 'demo' : readHeaders().Authorization;
    if (token) {
      const owner = demo ? 'demo' : Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
        byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
      // The hash partitions results when the account changes, without storing credentials.
      cache = C.createCache({ storage: sessionStorage, key: `treehole-daily-digest:cache:v2:${owner}` });
    }
  } catch { /* The current page can still use an in-memory cache. */ }

  const host = document.createElement('div');
  host.id = 'treehole-digest';
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = globalThis.TreeholeDigestStyle;
  shadow.append(style);
  const shell = document.createElement('div');
  shell.innerHTML = `
    <button class="launcher" aria-label="打开树洞日报">◒ 树洞日报</button>
    <dialog aria-labelledby="digest-title">
      <div class="paper">
        <header>
          <div class="masthead"><span>PKU TREEHOLE DAILY</span><span class="edition"></span></div>
          <div class="heading"><h1 id="digest-title">树洞日报</h1><button class="icon close" aria-label="关闭日报">×</button></div>
          <p class="demo-note" hidden>演示模式 · 所有帖子均为虚构，不读取校园账号</p>
        </header>
        <section class="controls" aria-label="日报筛选">
          <label>阅读日期 <input type="date" class="date"></label>
          <label class="check"><input type="checkbox" class="rolling">过去 24 小时</label>
          <button class="primary refresh">Generate ↗</button>
          <button class="force-refresh" title="忽略缓存，重新读取所选时段">Refresh</button>
          <button class="stop" hidden>Stop</button>
        </section>
        <p class="status" role="status" aria-live="polite"></p>
        <nav class="tabs" aria-label="内容类型">
          <button data-view="rank" aria-pressed="true">今日热门</button>
          <button data-view="subscriptions" aria-pressed="false">我的订阅 <span class="sub-count">0</span></button>
        </nav>
        <section class="subscriptions" hidden aria-label="管理订阅">
          <form class="subscribe-form"><label class="sub-input-wrap"><span class="sr-only">订阅关键词</span><input class="sub-input" placeholder="输入关键词，例如：暂时不能给你明确的答复、discouraged" maxlength="60" required></label><button type="submit" aria-label="添加订阅">Add</button></form>
          <div class="chips"></div>
          <div class="read-controls"><label class="check"><input type="checkbox" class="only-new">只看未读</label><button class="mark-read">标为已读</button></div>
        </section>
        <div class="list-heading"><h2>今日收藏榜</h2><label class="sort-label">排序 <select class="sort"><option value="favorites">收藏最多</option><option value="comments">评论最多</option><option value="references">引用最多</option><option value="newest">最新发布</option></select></label></div>
        <p class="scope"></p>
        <section class="posts" aria-label="日报帖子列表"></section>
        <footer><label class="check"><input type="checkbox" class="auto-open">打开树洞时显示日报</label></footer>
      </div>
    </dialog>`;
  shadow.append(shell);
  const $ = selector => shadow.querySelector(selector);
  const $$ = selector => [...shadow.querySelectorAll(selector)];
  const dialog = $('dialog');
  const status = $('.status');
  let opener;

  function persist() {
    try { localStorage.setItem(PREFS, JSON.stringify(prefs)); }
    catch { status.textContent = '浏览器未允许保存偏好；当前页面仍可使用。'; }
  }
  function open() { opener = document.activeElement; if (!dialog.open) dialog.showModal(); }
  function close() { dialog.close(); opener?.focus?.(); }
  $('.launcher').onclick = open;
  $('.close').onclick = close;
  dialog.addEventListener('close', () => opener?.focus?.());
  $('.date').value = C.dayKey();
  $('.edition').textContent = C.dayKey().replaceAll('-', '.');
  $('.demo-note').hidden = !demo;
  $('.auto-open').checked = prefs.autoOpen;
  $('.auto-open').onchange = event => { prefs.autoOpen = event.target.checked; persist(); };

  function renderSubscriptions() {
    $('.sub-count').textContent = prefs.subscriptions.length;
    $('.chips').replaceChildren();
    prefs.subscriptions.forEach((subscription, index) => {
      const group = document.createElement('span'); group.className = 'chip-group';
      const key = C.subscriptionKey(subscription);
      const chip = document.createElement('button'); chip.className = 'chip';
      chip.textContent = subscription.value;
      chip.setAttribute('aria-pressed', String(key === state.activeSubscription));
      chip.onclick = () => { state.activeSubscription = key; renderSubscriptions(); render(); };
      const remove = document.createElement('button'); remove.className = 'remove-sub'; remove.textContent = '×';
      remove.setAttribute('aria-label', `取消订阅 ${subscription.value}`);
      remove.onclick = () => {
        prefs.subscriptions.splice(index, 1); delete prefs.readThrough[key];
        if (state.activeSubscription === key) state.activeSubscription = prefs.subscriptions.length ? C.subscriptionKey(prefs.subscriptions[0]) : null;
        persist(); renderSubscriptions(); render();
      };
      group.append(chip, remove); $('.chips').append(group);
    });
  }

  $('.subscribe-form').onsubmit = event => {
    event.preventDefault();
    const subscription = C.normalizeSubscriptions([$('.sub-input').value])[0];
    if (!subscription) return;
    if (prefs.subscriptions.length >= 30) { status.textContent = '最多可订阅 30 个话题。'; return; }
    if (!prefs.subscriptions.some(s => C.subscriptionKey(s) === C.subscriptionKey(subscription))) prefs.subscriptions.push(subscription);
    state.activeSubscription = C.subscriptionKey(subscription);
    $('.sub-input').value = '';
    persist(); renderSubscriptions(); render();
  };
  $$('.tabs button').forEach(button => {
    button.onclick = () => {
      state.view = button.dataset.view;
      $$('.tabs button').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
      $('.subscriptions').hidden = state.view !== 'subscriptions';
      render();
    };
  });
  $('.sort').onchange = event => { state.metric = event.target.value; render(); };
  $('.only-new').onchange = event => { state.onlyNew = event.target.checked; render(); };
  $('.mark-read').onclick = () => {
    if (!state.fetchedAt || !state.activeSubscription || state.busy) return;
    prefs.readThrough[state.activeSubscription] = state.fetchedAt;
    persist(); render();
    status.textContent = '已标为已读。';
  };

  function render() {
    const inWindow = C.selectPosts(state.posts, state.window);
    const references = C.referenceCounts(inWindow);
    const subscribed = state.view === 'subscriptions';
    const subscription = prefs.subscriptions.find(s => C.subscriptionKey(s) === state.activeSubscription);
    const readThrough = Number(prefs.readThrough[state.activeSubscription]) || 0;
    let selected = subscribed ? inWindow.filter(post => subscription && C.matches(post, subscription)) : inWindow;
    if (subscribed && state.onlyNew) selected = selected.filter(post => post.createdAt > readThrough);
    const metric = subscribed ? 'newest' : state.metric;
    const ranked = C.rank(selected, metric, references);
    $('.sort-label').hidden = subscribed;
    $('.list-heading h2').textContent = subscribed ? '订阅新帖' : {
      favorites: '今日收藏榜', comments: '今日评论榜', references: '今日引用榜', newest: '今日新帖'
    }[metric];
    if (state.window.date !== C.dayKey()) $('.list-heading h2').textContent = subscribed ? '订阅新帖' : {
      favorites: '收藏榜', comments: '评论榜', references: '引用榜', newest: '新发布'
    }[metric];
    if (subscribed && subscription) $('.list-heading h2').textContent = `${subscription.value} · 新帖`;
    $('.scope').textContent = `${state.window.date} · ${selected.length} 篇${metric === 'references' ? ' · 正文引用' : ''}`;
    $('.posts').replaceChildren();
    if (!ranked.length) {
      const empty = document.createElement('div'); empty.className = 'empty';
      empty.textContent = !state.result ? '尚未生成简报' :
        subscribed && !prefs.subscriptions.length ? '暂无订阅' :
        subscribed && state.onlyNew ? '暂无未读新帖' : '暂无符合条件的帖子';
      $('.posts').append(empty);
    }
    ranked.slice(0, 100).forEach((post, index) => {
      const article = document.createElement('article'); article.className = 'post';
      const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(index + 1).padStart(2, '0');
      const content = document.createElement('div'); content.className = 'post-content';
      const meta = document.createElement('p'); meta.className = 'meta';
      meta.textContent = `#${post.id} · ${new Intl.DateTimeFormat('zh-CN', { timeZone: C.ZONE, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(post.createdAt)}${post.createdAt > readThrough && subscribed ? ' · 未读' : ''}`;
      const body = document.createElement('p'); body.className = 'body'; body.textContent = post.text || '（图片或其他非文字内容，请回原页查看）';
      const stats = document.createElement('p'); stats.className = 'stats';
      stats.textContent = `☆ ${post.favorites ?? '—'} stars　◌ ${post.comments ?? '—'} comments　↗ ${references.get(post.id) ?? 0} cites`;
      const link = document.createElement('a'); link.href = 'https://treehole.pku.edu.cn/ch/web/pc/index';
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `回树洞，搜索 #${post.id} ↗`;
      content.append(meta, body, stats, link); article.append(rank, content); $('.posts').append(article);
    });
    if (ranked.length > 100) {
      const note = document.createElement('p'); note.textContent = `共 ${ranked.length} 篇，显示前 100 篇。`; $('.posts').append(note);
    }
  }

  function readHeaders() {
    const headers = { Accept: 'application/json' };
    // Read only existing credentials at request time; never log, copy, or persist them.
    let token = localStorage.getItem('token');
    if (token) {
      try { const parsed = JSON.parse(token); token = typeof parsed === 'string' ? parsed : parsed.token ?? parsed.access_token ?? ''; }
      catch { /* Plain JWT / bearer token. */ }
    }
    if (!token) {
      const cookie = document.cookie.split('; ').find(item => item.startsWith('pku_token='));
      if (cookie) token = decodeURIComponent(cookie.slice('pku_token='.length));
    }
    if (token) headers.Authorization = /^Bearer /i.test(token) ? token : `Bearer ${token}`;
    const uuid = localStorage.getItem('pku-uuid');
    if (uuid) headers.Uuid = uuid;
    return headers;
  }

  const fetchPage = demo ? globalThis.TreeholeDigestDemo.fetchPage : C.makeFetcher({
    fetchImpl: window.fetch.bind(window), getHeaders: readHeaders
  });
  function updateWindow() {
    state.window = C.timeWindow($('.date').value, $('.rolling').checked);
    $('.date').disabled = $('.rolling').checked;
  }
  const timeLabel = value => new Intl.DateTimeFormat('zh-CN', {
    timeZone: C.ZONE, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(value);
  const coverage = reason => ({ limit: ' · 达到抓取上限，结果可能不全',
    repeated: ' · 接口返回重复页，结果可能不全' })[reason] || '';
  function restoreCache() {
    const entry = cache.read(state.window);
    if (!entry) return false;
    state.posts = entry.posts; state.window = entry.window; state.result = entry; state.fetchedAt = entry.fetchedAt;
    status.textContent = `${demo ? '演示 · ' : ''}缓存 · ${timeLabel(entry.savedAt)} 更新${coverage(entry.reason)}`;
    render(); return true;
  }
  function changedWindow() {
    updateWindow();
    state.posts = []; state.result = null; state.fetchedAt = null;
    if (!restoreCache()) { status.textContent = '日期已切换，请重新生成简报。'; render(); }
  }
  $('.date').onchange = changedWindow;
  $('.rolling').onchange = changedWindow;
  $('.stop').onclick = () => state.controller?.abort();
  async function generate(force = false) {
    if (state.busy) return;
    updateWindow();
    if (!force && restoreCache()) return;
    state.activeWindow = { ...state.window };
    state.busy = true; state.controller = new AbortController();
    $('.refresh').disabled = true; $('.force-refresh').disabled = true; $('.date').disabled = true; $('.rolling').disabled = true; $('.stop').hidden = false;
    $('.mark-read').disabled = true;
    const startedAt = Date.now();
    try {
      const result = await C.collect({
        fetchPage, window: state.activeWindow, signal: state.controller.signal, delayMs: demo ? 50 : 1200,
        onProgress: ({ pages, count }) => { status.textContent = `正在整理第 ${pages} 页 · 已读取 ${count} 篇…`; }
      });
      state.posts = result.posts; state.result = result; state.window = state.activeWindow; state.fetchedAt = startedAt;
      const stored = cache.write(result, state.window, startedAt);
      status.textContent = `${demo ? '演示 · ' : ''}${timeLabel(Date.now())} 更新${stored ? ' · 缓存 5 分钟' : ' · 仅当前页面缓存'}${coverage(result.reason)}`;
      render();
    } catch (error) {
      if (/登录/.test(error.message)) cache.clear();
      status.textContent = error.name === 'AbortError' ? '已停止。本次结果未保存，可重新生成。' : `${error.message}。本次结果未保存。`;
    } finally {
      state.busy = false; state.controller = null;
      $('.refresh').disabled = false; $('.force-refresh').disabled = false; $('.date').disabled = $('.rolling').checked; $('.rolling').disabled = false;
      $('.stop').hidden = true; $('.mark-read').disabled = false;
    }
  }
  $('.refresh').onclick = () => generate();
  $('.force-refresh').onclick = () => generate(true);
  renderSubscriptions();
  if (!restoreCache()) render();
  if (demo || prefs.autoOpen) open();
})();
