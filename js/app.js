/* DPMS interface. Calculations live in engine.js; this file draws screens and saves records. */
(function () {
  'use strict';
  const E = window.DPMSEngine, CATALOG = window.DPMS_CATALOG;
  const KEY = 'dpms-state-v6', OLD_KEYS = ['dpms-state-v4', 'dpms-state-v3'];
  const $ = sel => document.querySelector(sel);

  /* ---------- Safe HTML: every value placed in a template is escaped ---------- */
  class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const put = v => v instanceof Safe ? v.s : Array.isArray(v) ? v.map(put).join('') : (v === null || v === undefined || v === false) ? '' : esc(v);
  /* aria-* attributes keep true and false as words, because screen readers depend on them. */
  const h = (parts, ...vals) => new Safe(parts.reduce((out, p, i) => out + (typeof vals[i - 1] === 'boolean' && /aria-[a-z]+="$/.test(parts[i - 1]) ? vals[i - 1] : put(vals[i - 1])) + p));

  /* ---------- Saved records ---------- */
  function load() {
    try {
      for (const k of [KEY, ...OLD_KEYS]) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const state = E.migrateState(JSON.parse(raw));
        if (state) return state;
      }
    } catch (e) { /* Unreadable storage starts a new shop. */ }
    return E.freshState();
  }
  let S = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('This phone is out of storage. Download a backup from Settings.'); }
  }
  function log(text) { S.activity.unshift({ t: Date.now(), text }); S.activity = S.activity.slice(0, 100); }
  const UI = { filter: 'all', search: '', budget: '', overrides: {}, orderTab: 'active', supSearch: '', onb: null, walk: null, chartTip: null };

  /* ---------- Words and numbers ---------- */
  const money = n => '₦' + Math.round(n || 0).toLocaleString('en-NG');
  const num = n => (Math.round(n * 10) / 10).toLocaleString('en-NG');
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const qty = (n, unit) => num(n) + ' ' + E.unitLabel(unit, n);
  const shortDate = t => new Date(t).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const STOCK_UNITS = ['bag', 'sack', 'carton', 'crate', 'keg', 'drum', 'packet', 'tin', 'bundle', 'roll', 'piece', 'bottle'];
  const STATUS_WORD = { Requested: 'Ordered', Confirmed: 'Confirmed', Dispatched: 'On the way', Delivered: 'Received', Cancelled: 'Cancelled' };
  const STATE_WORD = { late: 'Buy now', buy: 'Buy soon', soon: 'Watch', ok: 'Good', coming: 'On the way', unknown: 'Not checked' };
  const today = () => E.dateKey();
  const info = item => E.reorderInfo(item, S.settings, S.orders);
  const findItem = id => S.items.find(i => i.id === id);
  const findSup = id => S.suppliers.find(s => s.id === id);

  function usageWords(item, r) {
    if (r.perDay <= 0) return '';
    const small = item.usageUnit !== item.stockUnit && item.conversion > 1;
    const amount = small ? qty(r.perDay * item.conversion, item.usageUnit) : qty(r.perDay, item.stockUnit);
    return 'uses about ' + amount + ' a day';
  }
  function statusLine(item, r) {
    if (r.state === 'unknown') return 'Tap what you see on the shelf.';
    const left = r.daysLeft === null ? null : Math.floor(r.daysLeft);
    const parts = [qty(item.onHand, item.stockUnit) + ' left'];
    if (left !== null) parts.push(left === 0 ? 'may finish today' : 'about ' + plural(left, 'day'));
    return parts.join(', ') + '.';
  }

  /* ---------- Icons ---------- */
  const ic = path => new Safe('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>');
  const I = {
    today: ic('<path d="M3 10.5 12 3l9 7.5V21H3z"/><path d="M9 21v-7h6v7"/>'),
    buy: ic('<path d="M3 4h2l2.4 11.5h11L21 7H6"/><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/>'),
    orders: ic('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
    suppliers: ic('<path d="M2 6h12v11H2zM14 10h4l4 4v3h-8z"/><circle cx="7" cy="18.5" r="2"/><circle cx="18" cy="18.5" r="2"/>'),
    insights: ic('<path d="M5 21V11M12 21V4M19 21v-7"/>'),
    gear: ic('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
    close: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
    back: ic('<path d="M15 5l-7 7 7 7"/>'),
    plus: ic('<path d="M12 5v14M5 12h14"/>'),
    chat: ic('<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.4A8.5 8.5 0 1 1 21 12z"/>'),
    phone: ic('<path d="M21 16.5v3a2 2 0 0 1-2.2 2A18 18 0 0 1 2.5 5.2 2 2 0 0 1 4.5 3h3l1.5 4.5-2 1.5a13 13 0 0 0 7.5 7.5l1.5-2z"/>'),
    alert: ic('<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.01"/>'),
    check: ic('<path d="M5 13l4 4L19 7"/>'),
    clock: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    truck: ic('<path d="M2 7h12v10H2zM14 11h4l4 3v3h-8z"/>')
  };
  const STATE_ICON = { late: I.alert, buy: I.clock, soon: I.clock, ok: I.check, coming: I.truck, unknown: I.clock };
  const pill = state => h`<span class="pill p-${state}">${STATE_ICON[state]}${STATE_WORD[state]}</span>`;
  const tank = lv => new Safe('<span class="tank" aria-hidden="true"><i style="height:' + { full: 100, half: 55, low: 22, out: 0 }[lv] + '%"></i></span>');
  const LEVEL_WORD = { full: 'Full', half: 'Half', low: 'Low', out: 'Out' };

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(text, action) {
    const el = $('#toast');
    el.innerHTML = put(h`<span>${text}</span>${action ? h`<button data-act="toastAction">${action.label}</button>` : ''}`);
    el._action = action && action.run;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 7000 : 3000);
  }
  function undoable(text) {
    const snapshot = JSON.stringify(S);
    return () => toast(text, { label: 'Undo', run: () => { S = JSON.parse(snapshot); save(); render(); toast('Undone'); } });
  }

  /* ---------- Bottom sheet, closed by the phone's back button too ---------- */
  const sheet = $('#sheet');
  let sheetView = null, sheetPushed = false;
  function openSheet(viewFn, cls) {
    sheetView = viewFn;
    sheet.className = cls || '';
    sheet.innerHTML = put(viewFn());
    if (!sheet.open) {
      sheet.showModal();
      history.pushState({ sheet: 1 }, '');
      sheetPushed = true;
    }
    sheet.scrollTop = 0;
  }
  function redrawSheet() { if (sheet.open && sheetView) { sheet.innerHTML = put(sheetView()); } }
  function closeSheet() {
    if (!sheet.open) return;
    sheet.close(); sheetView = null;
    if (sheetPushed) { sheetPushed = false; history.back(); }
  }
  sheet.addEventListener('cancel', e => { e.preventDefault(); closeSheet(); });
  sheet.addEventListener('click', e => {
    if (e.target !== sheet || sheet.classList.contains('walk')) return;
    const r = sheet.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (outside) { closeSheet(); render(); }
  });
  window.addEventListener('popstate', () => {
    if (sheet.open) { sheetPushed = false; sheet.close(); sheetView = null; render(); }
  });
  const sheetHead = title => h`<div class="sheet-h"><h2 id="sheet-title">${title}</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">${I.close}</button></div>`;

  /* Moves to a screen, replacing any open sheet in the back history. */
  function go(route) {
    if (sheet.open) {
      sheet.close(); sheetView = null; sheetPushed = false;
      history.replaceState(null, '', '#/' + route);
      render(true);
    } else if (location.hash === '#/' + route) render(true);
    else location.hash = '/' + route;
  }

  /* ---------- Frame and routing ---------- */
  const routeParts = () => (location.hash.replace(/^#\/?/, '') || 'today').split('/');
  const NAV = [['today', 'Today', I.today], ['buy', 'Buy', I.buy], ['orders', 'Orders', I.orders], ['suppliers', 'Suppliers', I.suppliers], ['insights', 'Insights', I.insights]];

  function drawRail(active) {
    const need = S.items.filter(i => ['late', 'buy'].includes(info(i).state)).length;
    const open = S.orders.filter(o => !['Delivered', 'Cancelled'].includes(o.status)).length;
    const counts = { buy: need, orders: open };
    $('#rail').innerHTML = put(h`
      <a class="wordmark brand" href="#/today"><img src="icons/icon.svg" alt="" width="34" height="34">DPMS</a>
      ${NAV.map(([id, label, icon]) => h`<button class="nav" data-act="nav" data-route="${id}" aria-current="${active === id ? 'page' : 'false'}">${icon}<span>${label}</span>${counts[id] ? h`<span class="count num" aria-label="${counts[id]} waiting">${counts[id]}</span>` : ''}</button>`)}`);
  }

  function render(fresh) {
    const landing = $('#landing'), app = $('#app');
    if (!S.onboarded && !UI.onb) { landing.hidden = false; app.hidden = true; drawDemo(); return; }
    landing.hidden = true; app.hidden = false;
    const view = $('#view');
    if (UI.onb) { $('#rail').hidden = true; view.style.cssText = 'max-width:none;padding:0'; view.innerHTML = put(viewSetup()); if (fresh) window.scrollTo(0, 0); return; }
    $('#rail').hidden = false; view.style.cssText = '';
    const [route, id] = routeParts();
    const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focus : null;
    const views = { today: viewToday, buy: viewBuy, orders: viewOrders, suppliers: () => id ? viewSupplier(id) : viewSuppliers(), compare: viewCompare, insights: viewInsights, settings: viewSettings };
    const banner = S.sample ? h`<div class="sample"><span>You are exploring a sample shop.</span><button class="btn" data-act="leaveSample">Start my own</button></div>` : '';
    view.innerHTML = put(banner) + put((views[route] || viewToday)());
    drawRail(route === 'compare' ? 'suppliers' : route === 'settings' ? 'insights' : route);
    if (focus) {
      const el = view.querySelector('[data-focus="' + CSS.escape(focus) + '"]');
      if (el) { el.focus({ preventScroll: true }); if (el.setSelectionRange && el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); }
    }
    if (fresh) { window.scrollTo(0, 0); }
  }
  window.addEventListener('hashchange', () => {
    if (UI.onb && !location.hash.startsWith('#/setup')) UI.onb = null;
    render(true);
  });

  /* ---------- Landing page demo ---------- */
  const demo = { rice: 'low', oil: 'half', sugar: 'out' };
  const DEMO_ITEMS = { rice: ['Rice, 50kg bags', 'bags', { full: 0, half: 2, low: 5, out: 8 }], oil: ['Groundnut oil, 25L kegs', 'kegs', { full: 0, half: 0, low: 3, out: 5 }], sugar: ['Sugar, 50kg bags', 'bags', { full: 0, half: 1, low: 3, out: 4 }] };
  function drawDemo() {
    const lines = Object.entries(DEMO_ITEMS).filter(([k, d]) => d[2][demo[k]] > 0).map(([k, d]) => '- ' + d[2][demo[k]] + ' ' + d[1] + ' of ' + d[0]);
    $('#demo').innerHTML = put(h`
      <p class="demo-cap">Try it. Tap what is on your shelf.</p>
      ${Object.entries(DEMO_ITEMS).map(([k, d]) => h`<div class="demo-row"><b>${d[0]}</b><div class="levels">${E.LEVELS.map(lv => h`<button class="level ${lv === 'low' || lv === 'out' ? 'warn' : ''}" data-act="demoTap" data-k="${k}" data-lv="${lv}" aria-pressed="${demo[k] === lv}">${tank(lv)}${LEVEL_WORD[lv]}</button>`)}</div></div>`)}
      <div class="bubble" aria-live="polite">${lines.length ? 'Hello, I would like to order:\n' + lines.join('\n') : 'Your shelf is full. Nothing to buy today.'}</div>`);
  }

  /* ---------- Setup ---------- */
  function viewSetup() {
    const o = UI.onb;
    const steps = o.type === 'manufacturer' ? ['name', 'type', 'category', 'items', 'products'] : ['name', 'type', 'category', 'items'];
    const n = steps.indexOf(o.step) + 1;
    const head = h`<div class="row"><button class="icon-btn" style="color:#fff;margin-left:-12px" data-act="onbBack" aria-label="Go back">${I.back}</button><span>Step ${n} of ${steps.length}</span></div><div class="meter"><i style="width:${n / steps.length * 100}%"></i></div>`;
    let body = '';
    if (o.step === 'name') body = h`<h1>What is your business called?</h1><p>This goes on the orders you send to suppliers.</p>
      <form data-form="onbName"><label class="field"><span>Business name</span><input name="name" required maxlength="60" autocomplete="organization" value="${o.name}" placeholder="Example: Tolu Provisions"></label><button class="btn btn-turmeric btn-lg btn-block">Continue</button></form>`;
    if (o.step === 'type') body = h`<h1>What do you do?</h1><p>This decides what DPMS shows you each day.</p>
      <button class="choice" data-act="onbType" data-v="reseller"><span class="e" aria-hidden="true">🛍️</span><span>I buy and sell<small>A shop, stall or trader</small></span></button>
      <button class="choice" data-act="onbType" data-v="manufacturer"><span class="e" aria-hidden="true">🥖</span><span>I make what I sell<small>Baking, food, soap, tailoring and more</small></span></button>`;
    if (o.step === 'category') body = h`<h1>Which fits you best?</h1><p>We will suggest items you are likely to stock.</p>
      ${Object.entries(CATALOG[o.type]).map(([k, c]) => h`<button class="choice" data-act="onbCat" data-v="${k}"><span class="e" aria-hidden="true">${c.icon}</span><span>${c.label}</span></button>`)}`;
    if (o.step === 'items') {
      const list = CATALOG[o.type][o.cat].items;
      body = h`<h1>What do you stock?</h1><p>Tap each one you sell. You can add more later.</p>
      ${list.map((it, i) => h`<button class="choice" data-act="onbItem" data-i="${i}" aria-pressed="${o.picks.includes(i)}"><span>${it.name}</span></button>`)}
      <div class="onb-foot"><button class="btn btn-turmeric btn-lg btn-block" data-act="onbItemsNext">${o.picks.length ? 'Continue with ' + plural(o.picks.length, 'item') : 'Skip for now'}</button></div>`;
    }
    if (o.step === 'products') {
      const list = CATALOG[o.type][o.cat].products || [];
      body = h`<h1>What do you make?</h1><p>DPMS will suggest how many to make each day. You can set your own costs next.</p>
      ${list.map((p, i) => h`<button class="choice" data-act="onbProduct" data-i="${i}" aria-pressed="${o.prods.includes(i)}"><span>${p.name}</span></button>`)}
      <div class="onb-foot"><button class="btn btn-turmeric btn-lg btn-block" data-act="onbFinish">Open my shop</button></div>`;
    }
    return h`<div class="onb"><div class="onb-in">${head}${body}</div></div>`;
  }
  function finishSetup() {
    const o = UI.onb, cat = CATALOG[o.type][o.cat];
    S = { ...E.freshState(), onboarded: true, orgName: o.name, businessType: o.type, category: o.cat, settings: S.settings };
    S.items = o.picks.map(i => E.makeItem({ ...cat.items[i] }));
    S.products = o.prods.map(i => { const p = cat.products[i]; return { id: E.uid(), name: p.name, cost: p.cost, price: p.price, salvage: p.salvage, usual: p.usual, log: [], needsReview: true }; });
    log('Set up the shop');
    save(); UI.onb = null;
    history.replaceState(null, '', '#/today');
    render(true);
  }

  /* ---------- Today ---------- */
  function setLevel(item, level) { setCount(item, item.levels[level]); }
  function setCount(item, q) {
    const now = Date.now(), last = item.history[item.history.length - 1];
    item.onHand = q;
    if (last && now - last.t < 120000) { last.t = now; last.q = q; } else item.history.push({ t: now, q });
    item.history = item.history.slice(-60);
    item.lastCheck = today();
    if (!S.checkDays.includes(today())) S.checkDays = [...S.checkDays, today()].slice(-90);
  }
  function viewToday() {
    const rows = S.items.map(item => ({ item, r: info(item) }));
    const urgent = rows.filter(x => ['late', 'buy'].includes(x.r.state)).sort((a, b) => (a.r.daysLeft ?? 1e9) - (b.r.daysLeft ?? 1e9));
    const checked = rows.filter(x => x.item.lastCheck === today()).length;
    const total = rows.length, streak = E.checkStreak(S.checkDays);
    const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
    let title, line;
    if (!total) { title = 'Add what you sell.'; line = 'Your daily check starts with your first item.'; }
    else if (checked < total && !urgent.length) { title = (total - checked) + ' left to check today.'; line = 'It takes about a minute.'; }
    else if (urgent.length) { title = plural(urgent.length, 'item') + ' to buy.'; line = urgent[0].item.name + (urgent[0].r.daysLeft !== null ? ' could finish in about ' + plural(Math.floor(urgent[0].r.daysLeft), 'day') + '.' : ' is running low.'); }
    else { title = 'Your shelf is in good shape.'; line = 'Nothing needs buying today.'; }

    let shown = rows;
    if (UI.filter === 'buy') shown = rows.filter(x => ['late', 'buy', 'soon'].includes(x.r.state));
    if (UI.filter === 'todo') shown = rows.filter(x => x.item.lastCheck !== today());
    if (UI.search) shown = shown.filter(x => x.item.name.toLowerCase().includes(UI.search.toLowerCase()));

    return h`
    <header class="top"><div><p>${greeting}</p><h1>${S.orgName}</h1></div><button class="icon-btn" data-act="nav" data-route="settings" aria-label="Settings">${I.gear}</button></header>
    <section class="pulse">
      <h2>${title}</h2><p>${line}</p>
      ${total ? h`<div class="meter" role="progressbar" aria-label="Items checked today" aria-valuenow="${checked}" aria-valuemin="0" aria-valuemax="${total}"><i style="width:${checked / total * 100}%"></i></div>
      <p class="small">${checked} of ${total} checked today${streak > 1 ? ', ' + streak + ' days in a row' : ''}</p>` : ''}
      <div class="row row-wrap">
        ${total ? h`<button class="btn btn-turmeric" data-act="walkStart">${checked === total ? 'Walk my shelf again' : 'Walk my shelf'}</button>` : h`<button class="btn btn-turmeric" data-act="itemNew">Add my first item</button>`}
        ${urgent.length ? h`<button class="btn btn-quiet-light" data-act="nav" data-route="buy">See buy plan</button>` : ''}
      </div>
    </section>
    ${viewMakeToday()}
    ${marketNudge(urgent)}
    <div class="section-h"><h2>Your shelf</h2><button class="btn btn-ghost" data-act="itemNew">${I.plus}Add item</button></div>
    ${total > 6 ? h`<label class="field"><span class="small">Find an item</span><input type="text" data-input="search" data-focus="search" value="${UI.search}" autocomplete="off"></label>` : ''}
    ${total ? h`<div class="chips">${[['all', 'All'], ['buy', 'Needs buying'], ['todo', 'Not checked']].map(([k, l]) => h`<button class="chip" data-act="filter" data-v="${k}" aria-pressed="${UI.filter === k}">${l}</button>`)}</div>` : ''}
    ${shown.map(({ item, r }) => h`<article class="item">
      <button class="item-h" data-act="itemOpen" data-id="${item.id}"><h3>${item.name}</h3>${pill(r.state)}</button>
      <p class="item-sub">${statusLine(item, r)}</p>
      <div class="levels" role="group" aria-label="Stock level for ${item.name}">${E.LEVELS.map(lv => h`<button class="level ${lv === 'low' || lv === 'out' ? 'warn' : ''}" data-act="tap" data-id="${item.id}" data-lv="${lv}" data-focus="${item.id}-${lv}" aria-pressed="${E.levelOf(item) === lv}">${tank(lv)}${LEVEL_WORD[lv]}</button>`)}</div>
    </article>`)}
    ${total && !shown.length ? h`<div class="empty"><h2>Nothing here</h2><p>No items match this view.</p><button class="btn btn-line" data-act="filter" data-v="all">Show all items</button></div>` : ''}`;
  }
  function marketNudge(urgent) {
    const tomorrow = DAYS[new Date(Date.now() + E.DAY).getDay()];
    const match = S.suppliers.find(s => (s.marketDays || []).includes(tomorrow) && urgent.some(x => s.quotes[x.item.id]));
    if (!match) return '';
    const names = urgent.filter(x => match.quotes[x.item.id]).map(x => x.item.name);
    return h`<section class="panel"><h2>${match.name} is at the market tomorrow</h2><p class="muted">You could collect ${names.join(', ')} in person.</p><button class="btn btn-line" style="margin-top:10px" data-act="nav" data-route="buy">See buy plan</button></section>`;
  }
  function viewMakeToday() {
    if (S.businessType !== 'manufacturer' || !S.products.length) return '';
    return h`<div class="section-h"><h2>Make today</h2></div>${S.products.map(p => {
      const b = E.batchAdvice(p);
      return h`<section class="panel"><div class="group-h"><h3 class="h2">${p.name}</h3><b class="num" style="font:800 30px var(--display)">${b.qty}</b></div>
        <p class="muted small">${b.source === 'measured' ? 'You sell about ' + Math.round(b.mean) + ' a day.' : 'Based on your usual sales until you log 5 days.'}${p.needsReview ? ' Check your cost and price so this number fits your shop.' : ''}</p>
        <div class="row row-wrap" style="margin-top:8px"><button class="btn btn-line" data-act="logSales" data-id="${p.id}">Log today's sales</button><button class="btn btn-ghost" data-act="productEdit" data-id="${p.id}">Edit costs</button></div></section>`;
    })}`;
  }

  /* Shelf walk: one item at a time, one tap each */
  function walkView() {
    const w = UI.walk;
    if (w.i >= w.queue.length) {
      const secs = Math.max(1, Math.round((Date.now() - w.start) / 1000));
      const need = S.items.filter(i => ['late', 'buy'].includes(info(i).state)).length;
      return h`<div class="w"><div class="w-done"><h2>Shelf checked in ${secs < 90 ? secs + ' seconds' : Math.round(secs / 60) + ' minutes'}.</h2>
        <p>${need ? plural(need, 'item') + ' to buy. Your plan is ready.' : 'Nothing needs buying today.'}</p>
        ${need ? h`<button class="btn btn-turmeric btn-lg btn-block" data-act="walkPlan">See buy plan</button>` : ''}
        <button class="btn btn-quiet-light btn-lg btn-block" data-act="closeSheet">Back to today</button></div></div>`;
    }
    const item = findItem(w.queue[w.i]);
    return h`<div class="w"><div class="w-top"><span id="sheet-title">Item ${w.i + 1} of ${w.queue.length}</span><button class="icon-btn" data-act="closeSheet" aria-label="Stop the shelf walk">${I.close}</button></div>
      <div class="meter"><i style="width:${w.i / w.queue.length * 100}%"></i></div>
      <div class="w-name"><h2>${item.name}</h2><p>How much is on the shelf?</p></div>
      <div class="w-grid">${E.LEVELS.map(lv => h`<button class="w-btn ${lv}" data-act="walkTap" data-lv="${lv}">${tank(lv)}${LEVEL_WORD[lv]}</button>`)}</div>
      <button class="btn btn-ghost w-skip" data-act="walkSkip">Skip this item</button></div>`;
  }

  /* ---------- Item sheets ---------- */
  function sparkline(item) {
    const pts = item.history.slice(-20);
    if (pts.length < 2) return '';
    const max = Math.max(...pts.map(p => p.q), 1), t0 = pts[0].t, span = (pts[pts.length - 1].t - t0) || 1;
    const line = pts.map(p => ((p.t - t0) / span * 298 + 1).toFixed(1) + ',' + (54 - p.q / max * 50).toFixed(1)).join(' ');
    return new Safe('<svg class="spark" viewBox="0 0 300 56" preserveAspectRatio="none" role="img" aria-label="Stock level over time"><polyline points="' + line + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>');
  }
  function quoteRows(ranked, itemId) {
    return ranked.map((r, i) => h`<button class="quote ${i === 0 ? 'best' : ''}" data-act="quoteEdit" data-item="${itemId}" data-sup="${r.supplier.id}">
      <span class="score num" aria-label="Value score ${r.score} out of 100">${r.score}</span>
      <span class="grow"><b>${r.supplier.name}</b><br><span class="muted small">${money(r.quote.price)}, ${plural(r.quote.leadDays || 3, 'day')} delivery${i === 0 ? ', best value' : r.cheapest ? ', cheapest' : ''}</span></span></button>`);
  }
  function itemSheet(id) {
    const item = findItem(id);
    if (!item) return '';
    const r = info(item), ranked = E.rankQuotes(id, S.suppliers, S.orders);
    const why = r.perDay > 0
      ? 'It takes ' + plural(r.lead, 'day') + ' to arrive and you ' + usageWords(item, r) + '. DPMS warns you at ' + qty(r.rop, item.stockUnit) + ', which includes a safety cushion.'
      : 'DPMS warns you at ' + qty(r.rop, item.stockUnit) + ' until it learns how fast this sells.';
    return h`${sheetHead(item.name)}
      <p>${pill(r.state)}</p><p class="muted" style="margin:8px 0">${statusLine(item, r)} ${why}</p>${sparkline(item)}
      <form data-form="count" data-id="${id}" class="row" style="align-items:flex-end;margin-bottom:6px"><label class="field grow" style="margin:0"><span>Exact count (${E.unitLabel(item.stockUnit, 2)})</span><input name="count" type="number" min="0" step="any" inputmode="decimal" required value="${item.onHand ?? ''}"></label><button class="btn btn-line">Save count</button></form>
      <div class="section-h"><h2>Prices</h2><button class="btn btn-ghost" data-act="quoteEdit" data-item="${id}">${I.plus}Add price</button></div>
      ${ranked.length ? quoteRows(ranked, id) : h`<p class="muted">Add a supplier's price and DPMS can tell you who gives the best value.</p>`}
      <div class="actions" style="margin-top:14px"><button class="btn btn-line" data-act="itemEdit" data-id="${id}">Edit item</button></div>`;
  }
  function itemForm(id) {
    const it = id ? findItem(id) : null;
    const unit = it ? it.stockUnit : 'bag';
    return h`${sheetHead(it ? 'Edit item' : 'Add an item')}
    <form data-form="item" data-id="${id || ''}">
      <label class="field"><span>Item name</span><input name="name" required maxlength="60" value="${it ? it.name : ''}" placeholder="Example: Rice, 50kg bags"></label>
      <div class="two">
        <label class="field"><span>You buy it by the</span><select name="stockUnit">${STOCK_UNITS.concat(STOCK_UNITS.includes(unit) ? [] : [unit]).map(u => h`<option value="${u}" ${new Safe(u === unit ? 'selected' : '')}>${u}</option>`)}</select></label>
        <label class="field"><span>Days to arrive</span><input name="leadTime" type="number" min="1" max="60" required value="${it ? it.leadTime : 3}" inputmode="numeric"></label>
      </div>
      <div class="two">
        <label class="field"><span>A full shelf holds</span><input name="full" type="number" min="1" required value="${it ? it.levels.full : ''}" inputmode="numeric"></label>
        <label class="field"><span>You have now</span><input name="onHand" type="number" min="0" step="any" value="${it && it.onHand !== null ? it.onHand : ''}" inputmode="decimal"></label>
      </div>
      <label class="field"><span>How many do you sell in a week?</span><input name="weeklyEstimate" type="number" min="0" step="any" value="${it && it.weeklyEstimate ? it.weeklyEstimate : ''}" inputmode="decimal"><small>A rough guess is fine. DPMS replaces it with what it learns from your checks.</small></label>
      <details class="more"><summary>I sell it in smaller units</summary>
        <div class="two"><label class="field"><span>Smaller unit</span><input name="usageUnit" maxlength="20" value="${it && it.usageUnit !== it.stockUnit ? it.usageUnit : ''}" placeholder="cup"></label>
        <label class="field"><span>How many in one</span><input name="conversion" type="number" min="1" value="${it && it.conversion > 1 ? it.conversion : ''}" inputmode="numeric" placeholder="96"></label></div>
      </details>
      <div class="actions"><button class="btn btn-block">Save item</button>
      ${it ? h`<button type="button" class="btn btn-danger btn-block" data-act="itemDelete" data-id="${it.id}">Delete item</button>` : ''}</div>
    </form>`;
  }

  /* ---------- Prices ---------- */
  function quoteForm(ctx) {
    const sup = ctx.supplierId ? findSup(ctx.supplierId) : null;
    const q = sup && ctx.itemId ? sup.quotes[ctx.itemId] : null;
    const stars = ctx.quality || (q && q.quality) || 3;
    return h`${sheetHead(q ? 'Update price' : 'Add a price')}
    <form data-form="quote">
      ${ctx.itemId ? h`<input type="hidden" name="itemId" value="${ctx.itemId}"><p class="muted" style="margin-bottom:12px">${findItem(ctx.itemId).name}</p>` :
        h`<label class="field"><span>Item</span><select name="itemId" required>${S.items.map(i => h`<option value="${i.id}">${i.name}</option>`)}</select></label>`}
      ${sup ? h`<input type="hidden" name="supplierId" value="${sup.id}"><p style="margin-bottom:12px"><b>${sup.name}</b></p>` :
        S.suppliers.length ? h`<label class="field"><span>Supplier</span><select name="supplierId" required>${S.suppliers.map(s => h`<option value="${s.id}">${s.name}</option>`)}</select></label><button type="button" class="link" data-act="supplierNewFromQuote" data-item="${ctx.itemId || ''}">Add a new supplier</button>` :
        h`<label class="field"><span>Supplier name</span><input name="newSupplier" required maxlength="60"></label><label class="field"><span>WhatsApp number</span><input name="newPhone" type="tel" inputmode="tel" placeholder="0803 000 0000"></label>`}
      <div class="two"><label class="field"><span>Price (₦)</span><input name="price" type="number" min="1" required inputmode="numeric" value="${q ? q.price : ''}"></label>
      <label class="field"><span>Days to deliver</span><input name="leadDays" type="number" min="1" max="60" required inputmode="numeric" value="${q ? q.leadDays : (ctx.itemId ? findItem(ctx.itemId).leadTime : 3)}"></label></div>
      ${starInput('quality', stars, 'How good is their quality?')}
      <div class="actions"><button class="btn btn-block">Save price</button>
      ${q ? h`<button type="button" class="btn btn-danger btn-block" data-act="quoteDelete" data-item="${ctx.itemId}" data-sup="${sup.id}">Remove price</button>` : ''}</div>
    </form>`;
  }
  function starInput(name, value, label) {
    return h`<fieldset><legend class="legend">${label}</legend><div class="stars">${[1, 2, 3, 4, 5].map(n => h`<label class="${n <= value ? 'on' : ''}"><input type="radio" name="${name}" value="${n}" ${new Safe(n === value ? 'checked' : '')} data-input="star" aria-label="${plural(n, 'star')}">★</label>`)}</div></fieldset>`;
  }
  function setQuote(supplier, itemId, price, leadDays, quality) {
    const old = supplier.quotes[itemId];
    const history = old && old.history ? old.history.slice(-11) : [];
    if (!old || old.price !== price) history.push({ t: Date.now(), price });
    supplier.quotes[itemId] = { price, leadDays, quality, history };
  }

  /* ---------- Buy plan ---------- */
  const plan = () => E.buildPlan({ items: S.items, suppliers: S.suppliers, orders: S.orders, settings: S.settings, budget: UI.budget === '' ? null : Number(UI.budget), overrides: UI.overrides });
  function viewBuy() {
    const p = plan();
    const nothing = !p.groups.length && !p.deferred.length && !p.unpriced.length;
    const shortBy = UI.budget !== '' && p.needed > Number(UI.budget) ? p.needed - Number(UI.budget) : 0;
    return h`<header class="top"><h1>Buy plan</h1></header>
    <section class="cash"><label for="cash">How much can you spend today?</label>
      <div class="cash-in"><span>₦</span><input id="cash" type="text" inputmode="numeric" autocomplete="off" data-input="budget" data-focus="budget" value="${UI.budget === '' ? '' : Number(UI.budget).toLocaleString('en-NG')}" placeholder="Enter amount"></div>
      <div class="chips">${[50000, 100000, 250000].map(v => h`<button class="chip num" data-act="budgetSet" data-v="${v}" aria-pressed="${Number(UI.budget) === v}">${money(v)}</button>`)}${UI.budget !== '' ? h`<button class="chip" data-act="budgetSet" data-v="">Clear</button>` : ''}</div>
      <div class="cash-sum"><div><b class="num">${money(p.total)}</b><span>This plan costs</span></div>
      <div><b class="num">${p.left !== null ? money(p.left) : money(p.needed)}</b><span>${p.left !== null ? 'Left over' : 'Full restock'}</span></div></div>
      ${shortBy > 0 ? h`<p class="small" style="margin-top:10px">A full restock needs ${money(shortBy)} more. The items that would run out first are bought first.</p>` : ''}
    </section>
    ${nothing ? h`<div class="empty"><h2>Nothing to buy right now</h2><p>Walk your shelf and DPMS will update this plan.</p><button class="btn" data-act="nav" data-route="today">Go to today</button></div>` : ''}
    ${p.groups.map(g => h`<section class="panel"><div class="group-h"><h3>${g.supplier.name}</h3><b class="num">${money(g.total)}</b></div>
      ${g.lines.map(l => h`<div class="line"><div class="line-top"><span>${l.item.name}</span>${pill(l.info.state)}</div>
        <p class="line-why">${money(l.price)} per ${E.unitLabel(l.item.stockUnit, 1)}${l.info.daysLeft !== null ? ', about ' + plural(Math.floor(l.info.daysLeft), 'day') + ' of stock left' : ''}</p>
        <div class="row row-wrap"><div class="stepper"><button data-act="qtyStep" data-id="${l.item.id}" data-q="${l.qty - 1}" aria-label="One less ${l.item.name}">−</button><output class="num" aria-live="polite">${l.qty}</output><button data-act="qtyStep" data-id="${l.item.id}" data-q="${l.qty + 1}" aria-label="One more ${l.item.name}">+</button></div>
        ${l.ranked.length > 1 ? h`<button class="link" data-act="pickSupplier" data-id="${l.item.id}">Compare ${l.ranked.length} suppliers</button>` : ''}<button class="link" data-act="skipLine" data-id="${l.item.id}">Not today</button></div></div>`)}
      <div class="actions" style="margin-top:10px">${E.normalisePhone(g.supplier.phone) ? h`<button class="btn btn-wa btn-block" data-act="sendOrder" data-sup="${g.supplier.id}">${I.chat}Send order on WhatsApp</button>` : h`<button class="btn btn-block" data-act="sendOrder" data-sup="${g.supplier.id}">Prepare order</button>`}</div></section>`)}
    ${p.deferred.length ? h`<div class="section-h"><h2>Not enough cash today</h2></div><section class="panel">${p.deferred.map(l => h`<div class="line"><div class="line-top"><span>${l.item.name}</span><span class="num">${money(l.minQty * l.price)}</span></div><p class="line-why">Needs at least ${qty(l.minQty, l.item.stockUnit)}.</p></div>`)}</section>` : ''}
    ${p.unpriced.length ? h`<div class="section-h"><h2>Add a price to plan these</h2></div><section class="panel">${p.unpriced.map(u => h`<div class="line"><div class="line-top"><span>${u.item.name}</span>${pill(u.info.state)}</div><button class="btn btn-line" style="margin-top:8px" data-act="quoteEdit" data-item="${u.item.id}">${I.plus}Add supplier price</button></div>`)}</section>` : ''}
    ${p.skipped.length ? h`<div class="section-h"><h2>Left out today</h2></div><section class="panel">${p.skipped.map(u => h`<div class="line"><div class="line-top"><span>${u.item.name}</span><button class="link" data-act="unskipLine" data-id="${u.item.id}">Add back</button></div></div>`)}</section>` : ''}`;
  }
  function pickSheet(id) {
    const item = findItem(id), ranked = E.rankQuotes(id, S.suppliers, S.orders);
    return h`${sheetHead('Choose a supplier')}<p class="muted" style="margin-bottom:8px">${item.name}. The score weighs quality, speed and reliability against price.</p>
      ${ranked.map((r, i) => h`<button class="quote ${i === 0 ? 'best' : ''}" data-act="supplierChoose" data-id="${id}" data-sup="${r.supplier.id}"><span class="score num" aria-label="Value score ${r.score} out of 100">${r.score}</span><span class="grow"><b>${r.supplier.name}</b><br><span class="muted small">${money(r.quote.price)}, ${plural(r.quote.leadDays || 3, 'day')} delivery${i === 0 ? ', best value' : r.cheapest ? ', cheapest' : ''}</span></span></button>`)}`;
  }
  function placeOrder(group) {
    const now = Date.now();
    const lines = group.lines.map(l => {
      const dearest = Math.max(...l.ranked.map(r => r.quote.price));
      return { itemId: l.item.id, name: l.item.name, qty: l.qty, unit: l.item.stockUnit, price: l.price, saved: (dearest - l.price) * l.qty };
    });
    const lead = Math.max(...group.lines.map(l => l.choice.quote.leadDays || 3));
    const order = { id: E.uid(), supplierId: group.supplier.id, supplierName: group.supplier.name, lines, status: 'Requested', statusHistory: [{ status: 'Requested', at: now }], placedAt: now, expectedAt: now + lead * E.DAY, deliveredAt: null };
    S.orders.unshift(order);
    group.lines.forEach(l => delete UI.overrides[l.item.id]);
    log('Ordered from ' + group.supplier.name);
    save();
    return order;
  }

  /* ---------- Orders ---------- */
  function viewOrders() {
    const active = S.orders.filter(o => !['Delivered', 'Cancelled'].includes(o.status));
    const past = S.orders.filter(o => ['Delivered', 'Cancelled'].includes(o.status));
    const list = UI.orderTab === 'active' ? active : past;
    return h`<header class="top"><h1>Orders</h1></header>
    <div class="chips"><button class="chip" data-act="orderTab" data-v="active" aria-pressed="${UI.orderTab === 'active'}">Open (${active.length})</button><button class="chip" data-act="orderTab" data-v="past" aria-pressed="${UI.orderTab === 'past'}">Finished (${past.length})</button></div>
    ${list.length ? list.map(orderCard) : h`<div class="empty"><h2>${UI.orderTab === 'active' ? 'No open orders' : 'No finished orders yet'}</h2><p>Orders you send from your buy plan appear here.</p><button class="btn" data-act="nav" data-route="buy">Open buy plan</button></div>`}`;
  }
  function orderCard(o) {
    const idx = E.ORDER_FLOW.indexOf(o.status), open = idx >= 0 && idx < 3;
    const late = open && o.expectedAt && Date.now() > o.expectedAt + E.DAY;
    const sup = findSup(o.supplierId);
    const nextWord = { Requested: 'Mark confirmed', Confirmed: 'Mark on the way' }[o.status];
    return h`<article class="panel"><div class="group-h"><h3 class="h2">${o.supplierName}</h3><b class="num">${money(E.orderTotal(o))}</b></div>
      <p class="muted small">Ordered ${shortDate(o.placedAt)}${o.expectedAt && open ? ', expected ' + shortDate(o.expectedAt) : ''}${o.deliveredAt ? ', received ' + shortDate(o.deliveredAt) : ''}</p>
      ${late ? h`<p style="margin-top:6px"><span class="pill p-late">${I.alert}Late</span></p>` : ''}
      ${o.status === 'Cancelled' ? h`<p style="margin-top:6px"><span class="pill p-unknown">Cancelled</span> ${o.cancelReason || ''}</p>` :
        h`<ol class="track">${E.ORDER_FLOW.map((st, i) => h`<li class="${i < idx || o.status === 'Delivered' ? 'done' : i === idx ? 'now' : ''}" ${new Safe(i === idx ? 'aria-current="step"' : '')}>${STATUS_WORD[st]}</li>`)}</ol>`}
      <ul style="margin:8px 0;padding-left:20px">${o.lines.map(l => h`<li>${qty(l.qty, l.unit)} of ${l.name}</li>`)}</ul>
      ${open ? h`<div class="actions">
        ${nextWord ? h`<button class="btn btn-line btn-block" data-act="orderNext" data-id="${o.id}">${nextWord}</button>` : ''}
        <button class="btn btn-block" data-act="orderReceive" data-id="${o.id}">Goods received</button>
        <div class="row">${late && sup && E.normalisePhone(sup.phone) ? h`<button class="link" data-act="orderChase" data-id="${o.id}">Ask where it is</button>` : ''}<button class="link" data-act="orderCancel" data-id="${o.id}">Cancel order</button></div>
      </div>` : ''}</article>`;
  }
  function receiveSheet(id) {
    const o = S.orders.find(x => x.id === id);
    return h`${sheetHead('Goods received')}<form data-form="receive" data-id="${id}">
      ${o.lines.map((l, i) => h`<p style="font-weight:600;margin-bottom:6px">${l.name}</p><div class="two"><label class="field"><span>Quantity</span><input name="qty${i}" type="number" min="0" step="any" required value="${l.qty}" inputmode="decimal"></label><label class="field"><span>Price paid (₦)</span><input name="price${i}" type="number" min="0" required value="${l.price}" inputmode="numeric"></label></div>`)}
      ${starInput('quality', 4, 'How was the quality?')}
      <button class="btn btn-block">Add to my stock</button></form>`;
  }
  function cancelSheet(id) {
    return h`${sheetHead('Cancel this order?')}<p class="muted" style="margin-bottom:12px">Your stock will not change.</p><div class="actions">
      ${['Found a better price', 'Supplier took too long', 'Ordered by mistake', 'Other reason'].map(r => h`<button class="btn btn-line btn-block" data-act="orderCancelDo" data-id="${id}" data-r="${r}">${r}</button>`)}</div>`;
  }

  /* ---------- Suppliers ---------- */
  function viewSuppliers() {
    const q = UI.supSearch.toLowerCase();
    const list = S.suppliers.filter(s => !q || s.name.toLowerCase().includes(q));
    return h`<header class="top"><h1>Suppliers</h1><button class="btn" data-act="supplierNew">${I.plus}Add</button></header>
    ${S.suppliers.length > 1 && S.items.length ? h`<button class="btn btn-line btn-block" style="margin-bottom:12px" data-act="nav" data-route="compare">Compare prices side by side</button>` : ''}
    ${S.suppliers.length > 5 ? h`<label class="field"><span class="small">Find a supplier</span><input type="text" data-input="supSearch" data-focus="supSearch" value="${UI.supSearch}" autocomplete="off"></label>` : ''}
    ${list.map(s => { const st = E.supplierStats(s.id, S.orders), n = Object.keys(s.quotes).length; return h`<button class="card-btn" data-act="nav" data-route="suppliers/${s.id}"><b style="font-size:18px">${s.name}</b><br><span class="muted small">${plural(n, 'price')} saved${st.onTimeRate !== null ? ', ' + Math.round(st.onTimeRate * 100) + '% on time' : ''}${(s.marketDays || []).length ? ', market on ' + s.marketDays.join(', ') : ''}</span></button>`; })}
    ${!S.suppliers.length ? h`<div class="empty"><h2>Add the people you buy from</h2><p>Save their WhatsApp number and prices, and DPMS will compare them for you.</p><button class="btn" data-act="supplierNew">Add a supplier</button></div>` : ''}`;
  }
  function viewSupplier(id) {
    const s = findSup(id);
    if (!s) return h`<div class="empty"><h2>Supplier not found</h2><button class="btn" data-act="nav" data-route="suppliers">Back to suppliers</button></div>`;
    const st = E.supplierStats(id, S.orders), wa = E.normalisePhone(s.phone);
    return h`<button class="btn btn-ghost back" data-act="nav" data-route="suppliers">${I.back}Suppliers</button>
    <header class="top"><h1>${s.name}</h1><button class="btn btn-line" data-act="supplierEdit" data-id="${id}">Edit</button></header>
    ${s.address ? h`<p class="muted" style="margin-bottom:10px">${s.address}</p>` : ''}
    ${wa ? h`<div class="two" style="margin-bottom:12px"><a class="btn btn-wa" href="https://wa.me/${wa}" target="_blank" rel="noopener">${I.chat}WhatsApp</a><a class="btn btn-line" href="tel:+${wa}">${I.phone}Call</a></div>` : h`<button class="btn btn-line btn-block" style="margin-bottom:12px" data-act="supplierEdit" data-id="${id}">Add their WhatsApp number</button>`}
    <section class="panel"><div class="facts"><div><b class="num">${st.orders}</b><span>Orders</span></div><div><b class="num">${st.onTimeRate === null ? 'New' : Math.round(st.onTimeRate * 100) + '%'}</b><span>On time</span></div><div><b class="num">${st.avgQuality === null ? 'New' : st.avgQuality.toFixed(1) + '★'}</b><span>Quality</span></div></div></section>
    <div class="section-h"><h2>Their prices</h2>${S.items.length ? h`<button class="btn btn-ghost" data-act="quoteForSupplier" data-sup="${id}">${I.plus}Add price</button>` : ''}</div>
    <section class="panel">${Object.entries(s.quotes).filter(([k]) => findItem(k)).map(([k, q]) => h`<button class="quote" data-act="quoteEdit" data-item="${k}" data-sup="${id}"><span class="grow"><b>${findItem(k).name}</b><br><span class="muted small">${plural(q.leadDays, 'day')} delivery, ${q.quality} of 5 for quality</span></span><b class="num">${money(q.price)}</b></button>`)}
    ${!Object.keys(s.quotes).length ? h`<p class="muted">No prices saved yet.</p>` : ''}</section>`;
  }
  function supplierForm(id, afterSave) {
    const s = id ? findSup(id) : null, canPick = 'contacts' in navigator && 'ContactsManager' in window;
    UI.afterSupplier = afterSave || null;
    return h`${sheetHead(s ? 'Edit supplier' : 'Add a supplier')}
    ${!s && canPick ? h`<button class="btn btn-line btn-block" style="margin-bottom:14px" data-act="pickContact">Choose from my contacts</button>` : ''}
    <form data-form="supplier" data-id="${id || ''}">
      <label class="field"><span>Name</span><input name="name" required maxlength="60" value="${s ? s.name : UI.draftName || ''}"></label>
      <label class="field"><span>WhatsApp number</span><input name="phone" type="tel" inputmode="tel" value="${s ? s.phone : UI.draftPhone || ''}" placeholder="0803 000 0000"></label>
      <label class="field"><span>Market or address</span><input name="address" maxlength="120" value="${s ? s.address : ''}"></label>
      <fieldset><legend class="legend">Market days</legend><div class="daypick">${DAYS.map(d => h`<label><input type="checkbox" name="day" value="${d}" ${new Safe(s && (s.marketDays || []).includes(d) ? 'checked' : '')}>${d}</label>`)}</div></fieldset>
      <div class="actions"><button class="btn btn-block">Save supplier</button>
      ${s ? h`<button type="button" class="btn btn-danger btn-block" data-act="supplierDelete" data-id="${id}">Delete supplier</button>` : ''}</div>
    </form>`;
  }
  function viewCompare() {
    return h`<button class="btn btn-ghost back" data-act="nav" data-route="suppliers">${I.back}Suppliers</button>
    <header class="top"><div><h1>Compare prices</h1><p>Green marks the best value for each item. Tap a price to change it.</p></div></header>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Item</th>${S.suppliers.map(s => h`<th scope="col">${s.name}</th>`)}</tr></thead><tbody>
    ${S.items.map(it => { const top = E.rankQuotes(it.id, S.suppliers, S.orders)[0]; return h`<tr><th scope="row">${it.name}</th>${S.suppliers.map(s => { const q = s.quotes[it.id], best = top && top.supplier.id === s.id; return h`<td><button class="cell num ${q ? '' : 'none'} ${best ? 'best' : ''}" data-act="quoteEdit" data-item="${it.id}" data-sup="${s.id}" aria-label="${it.name} from ${s.name}: ${q ? money(q.price) : 'no price'}${best ? ', best value' : ''}">${q ? money(q.price) : 'Add'}</button></td>`; })}</tr>`; })}
    </tbody></table></div>`;
  }

  /* ---------- Insights ---------- */
  function viewInsights() {
    const weeks = E.spendByWeek(S.orders, 8), maxW = Math.max(...weeks.map(w => w.total), 1);
    const bySup = E.spendBySupplier(S.orders).slice(0, 5), maxS = bySup.length ? bySup[0].total : 1;
    const recent = weeks.slice(-4).reduce((s, w) => s + w.total, 0);
    const timed = S.orders.filter(o => o.status === 'Delivered' && o.expectedAt && o.deliveredAt);
    const onTime = timed.length ? Math.round(timed.filter(o => o.deliveredAt <= o.expectedAt + E.DAY).length / timed.length * 100) + '%' : 'No data';
    const changes = E.priceChanges(S.items, S.suppliers).slice(0, 6);
    const tip = UI.chartTip !== null && weeks[UI.chartTip] ? weeks[UI.chartTip] : weeks[weeks.length - 1];
    return h`<header class="top"><h1>Insights</h1><button class="icon-btn" data-act="nav" data-route="settings" aria-label="Settings">${I.gear}</button></header>
    <div class="tiles">
      <div class="tile"><b class="num">${money(recent)}</b><span>Spent in 4 weeks</span></div>
      <div class="tile"><b class="num">${money(E.savings(S.orders))}</b><span>Saved against your dearest price</span></div>
      <div class="tile"><b class="num">${money(E.stockValue(S.items, S.suppliers))}</b><span>Stock on your shelf</span></div>
      <div class="tile"><b class="num">${onTime}</b><span>Deliveries on time</span></div>
    </div>
    <section class="panel"><h2>Weekly spending</h2><p class="muted small">Week ending ${shortDate(tip.to)}: <b class="num">${money(tip.total)}</b></p>
      <div class="bars">${weeks.map((w, i) => h`<button class="bar" data-act="chartTip" data-i="${i}" aria-pressed="${tip === w}" aria-label="Week ending ${shortDate(w.to)}: ${money(w.total)}"><i style="height:${w.total / maxW * 100}%"></i></button>`)}</div>
      <div class="bar-x"><span>${shortDate(weeks[0].to)}</span><span>${shortDate(weeks[7].to)}</span></div></section>
    <section class="panel"><h2>Where your money goes</h2>${bySup.length ? bySup.map(s => h`<div class="hbar"><div><span>${s.name}</span><b class="num">${money(s.total)}</b></div><div class="t"><i style="width:${s.total / maxS * 100}%"></i></div></div>`) : h`<p class="muted">Your spending by supplier appears after your first order.</p>`}</section>
    <section class="panel"><h2>Price changes</h2>${changes.length ? changes.map(c => h`<div class="line"><div class="line-top"><span>${c.item.name}</span><span class="pill ${c.pct > 0 ? 'p-late' : 'p-ok'} num">${c.pct > 0 ? 'Up' : 'Down'} ${Math.abs(c.pct).toFixed(0)}%</span></div><p class="line-why">${c.supplier.name}: ${money(c.was)} to ${money(c.now)}</p></div>`) : h`<p class="muted">When you update a supplier's price, the change shows here.</p>`}</section>
    <details class="panel"><summary>How DPMS decides</summary>
      <p><b>When to buy.</b> Daily use multiplied by delivery days, plus a safety cushion. If your stock is at or below that number, the item goes on your buy plan.</p>
      <p><b>Who to buy from.</b> Value equals function divided by cost. Function is half quality, a quarter delivery speed and a quarter on-time record.</p>
      <p><b>How much to make.</b> The newsvendor model balances the profit you lose by making too few against the money you lose on unsold goods.</p></details>
    <details class="panel"><summary>Activity</summary><ul>${S.activity.slice(0, 15).map(a => h`<li>${a.text}, ${shortDate(a.t)}</li>`)}</ul></details>`;
  }

  /* ---------- Settings ---------- */
  function viewSettings() {
    const st = S.settings;
    return h`<button class="btn btn-ghost back" data-act="nav" data-route="insights">${I.back}Insights</button><header class="top"><h1>Settings</h1></header>
    <section class="panel"><h2>Your business</h2><form data-form="business"><label class="field"><span>Business name</span><input name="name" required maxlength="60" value="${S.orgName}"></label><button class="btn btn-line">Save name</button></form></section>
    <section class="panel"><h2>Appearance</h2><div class="seg" role="group" aria-label="Theme">${[['auto', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => h`<button data-act="theme" data-v="${k}" aria-pressed="${st.theme === k}">${l}</button>`)}</div></section>
    <section class="panel"><h2>Restock warnings</h2><p class="muted small" style="margin-bottom:10px">Standard keeps a set number of spare days. Careful adds more when your sales swing up and down.</p>
      <div class="seg" role="group" aria-label="Warning style">${[['simple', 'Standard'], ['advanced', 'Careful']].map(([k, l]) => h`<button data-act="ropMode" data-v="${k}" aria-pressed="${st.ropMode === k}">${l}</button>`)}</div>
      <label class="field" style="margin-top:14px"><span>Buy enough stock for</span><select data-input="coverDays">${[7, 14, 21, 30].map(d => h`<option value="${d}" ${new Safe(st.coverDays === d ? 'selected' : '')}>${d} days</option>`)}</select></label></section>
    ${S.businessType === 'manufacturer' ? h`<section class="panel"><h2>Products you make</h2>${S.products.map(p => h`<button class="quote" data-act="productEdit" data-id="${p.id}"><span class="grow"><b>${p.name}</b><br><span class="muted small">Costs ${money(p.cost)}, sells for ${money(p.price)}</span></span></button>`)}<button class="btn btn-line btn-block" style="margin-top:10px" data-act="productEdit">Add a product</button></section>` : ''}
    <section class="panel"><h2>Your records</h2><p class="muted small" style="margin-bottom:10px">Everything is stored on this device only. If you lose this phone or clear its browser data, your records are gone, so download a backup often.</p>
      <div class="actions"><button class="btn btn-block" data-act="backup">Download backup</button><label class="btn btn-line btn-block">Restore from backup<input type="file" accept="application/json,.json" data-input="restore" hidden></label><button class="btn btn-line btn-block" data-act="exportCsv">Download orders as a spreadsheet</button>
      ${UI.installPrompt ? h`<button class="btn btn-line btn-block" data-act="install">Install DPMS on this phone</button>` : ''}
      <button class="btn btn-danger btn-block" data-act="resetAsk">Delete all my records</button></div></section>`;
  }
  function productForm(id) {
    const p = id ? S.products.find(x => x.id === id) : null;
    return h`${sheetHead(p ? 'Edit product' : 'Add a product')}<form data-form="product" data-id="${id || ''}">
      <label class="field"><span>Product name</span><input name="name" required maxlength="60" value="${p ? p.name : ''}"></label>
      <div class="two"><label class="field"><span>Cost to make one (₦)</span><input name="cost" type="number" min="0" required inputmode="numeric" value="${p ? p.cost : ''}"></label><label class="field"><span>Selling price (₦)</span><input name="price" type="number" min="1" required inputmode="numeric" value="${p ? p.price : ''}"></label></div>
      <div class="two"><label class="field"><span>Value if unsold (₦)</span><input name="salvage" type="number" min="0" inputmode="numeric" value="${p ? p.salvage : 0}"></label><label class="field"><span>Usual sales a day</span><input name="usual" type="number" min="0" required inputmode="numeric" value="${p ? p.usual : ''}"></label></div>
      <div class="actions"><button class="btn btn-block">Save product</button>${p ? h`<button type="button" class="btn btn-danger btn-block" data-act="productDelete" data-id="${p.id}">Delete product</button>` : ''}</div></form>`;
  }
  function confirmSheet(title, text, label, act, id) {
    return h`${sheetHead(title)}<p class="muted" style="margin-bottom:14px">${text}</p><div class="actions"><button class="btn btn-danger btn-block" data-act="${act}" data-id="${id || ''}">${label}</button><button class="btn btn-line btn-block" data-act="closeSheet">Keep it</button></div>`;
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function applyTheme() {
    if (S.settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', S.settings.theme);
  }

  /* Sample shop: clearly labelled, with no real people or phone numbers */
  function sampleState() {
    const now = Date.now(), s = E.freshState();
    Object.assign(s, { onboarded: true, sample: true, orgName: 'Sample Provisions', businessType: 'reseller', category: 'provisions' });
    const mk = (name, unit, full, week, lead, series) => {
      const it = E.makeItem({ name, stockUnit: unit, full, weeklyEstimate: week, leadTime: lead });
      it.history = series.map((q, i) => ({ t: now - (series.length - 1 - i) * 2 * E.DAY, q }));
      it.onHand = series[series.length - 1];
      it.lastCheck = E.dateKey(now - E.DAY);
      return it;
    };
    s.items = [mk('Rice, 50kg bags', 'bag', 30, 7, 3, [26, 22, 19, 15, 11, 6]), mk('Beans, 50kg bags', 'bag', 20, 4, 3, [18, 17, 15, 14, 13, 11]), mk('Groundnut oil, 25L kegs', 'keg', 15, 3, 4, [12, 11, 9, 8, 6, 3]), mk('Sugar, 50kg bags', 'bag', 12, 2, 4, [11, 10, 10, 9, 9, 8]), mk('Tomato paste, cartons', 'carton', 15, 5, 3, [14, 12, 10, 8, 6, 5])];
    const quotes = (id, q) => { const out = {}; q.forEach(([i, price, leadDays, quality, was]) => { out[s.items[i].id] = { price, leadDays, quality, history: was ? [{ t: now - 20 * E.DAY, price: was }, { t: now - 2 * E.DAY, price }] : [{ t: now - 20 * E.DAY, price }] }; }); return out; };
    s.suppliers = [
      { id: E.uid(), name: 'Sample Grains Depot', phone: '', address: 'Sample market', marketDays: ['Mon', 'Thu'], notes: '', quotes: quotes(0, [[0, 62000, 3, 5, 58000], [1, 74000, 3, 4], [3, 48000, 4, 4]]) },
      { id: E.uid(), name: 'Sample Wholesale Hub', phone: '', address: 'Sample road', marketDays: ['Sat'], notes: '', quotes: quotes(1, [[0, 59500, 6, 3], [1, 71000, 6, 3], [2, 44000, 5, 4], [4, 8500, 3, 4]]) },
      { id: E.uid(), name: 'Sample Oil Traders', phone: '', address: 'Sample lane', marketDays: [], notes: '', quotes: quotes(2, [[2, 42500, 4, 5, 39000], [4, 9000, 2, 3]]) }
    ];
    const a = s.suppliers[0];
    s.orders = [3, 10, 18, 26].map((d, i) => ({ id: E.uid(), supplierId: a.id, supplierName: a.name, lines: [{ itemId: s.items[0].id, name: s.items[0].name, qty: 4 + i, unit: 'bag', price: 58000, saved: 1500 * (4 + i) }], status: 'Delivered', statusHistory: [], placedAt: now - d * E.DAY, expectedAt: now - (d - 3) * E.DAY, deliveredAt: now - (d - 3) * E.DAY, quality: 5 }));
    s.checkDays = [E.dateKey(now - E.DAY), E.dateKey(now - 2 * E.DAY)];
    s.activity = [{ t: now, text: 'Opened the sample shop' }];
    return s;
  }

  /* ---------- Taps ---------- */
  const ACT = {
    nav: d => go(d.route), closeSheet: () => { closeSheet(); render(); },
    toastAction: () => { const el = $('#toast'); el.classList.remove('show'); if (el._action) el._action(); },
    demoTap: d => { demo[d.k] = d.lv; drawDemo(); },
    startSetup: () => { UI.onb = { step: 'name', name: '', type: null, cat: null, picks: [], prods: [] }; history.pushState(null, '', '#/setup'); render(true); },
    loadSample: () => { S = sampleState(); save(); history.replaceState(null, '', '#/today'); render(true); },
    leaveSample: () => { S = E.freshState(); localStorage.removeItem(KEY); ACT.startSetup(); },
    onbBack: () => { const o = UI.onb, order = ['name', 'type', 'category', 'items', 'products'], i = order.indexOf(o.step); if (i === 0) { UI.onb = null; history.replaceState(null, '', '#/'); render(true); } else { o.step = order[i - 1]; render(true); } },
    onbType: d => { UI.onb.type = d.v; UI.onb.step = 'category'; render(true); },
    onbCat: d => { UI.onb.cat = d.v; UI.onb.picks = []; UI.onb.prods = []; UI.onb.step = 'items'; render(true); },
    onbItem: d => { const p = UI.onb.picks, i = +d.i; UI.onb.picks = p.includes(i) ? p.filter(x => x !== i) : [...p, i]; render(); },
    onbProduct: d => { const p = UI.onb.prods, i = +d.i; UI.onb.prods = p.includes(i) ? p.filter(x => x !== i) : [...p, i]; render(); },
    onbItemsNext: () => { const o = UI.onb; if (o.type === 'manufacturer' && (CATALOG[o.type][o.cat].products || []).length) { o.step = 'products'; render(true); } else finishSetup(); },
    onbFinish: () => finishSetup(),
    filter: d => { UI.filter = d.v; render(); },
    tap: d => { setLevel(findItem(d.id), d.lv); save(); render(); },
    walkStart: () => { const todo = S.items.filter(i => i.lastCheck !== today()).map(i => i.id); UI.walk = { queue: todo.length ? todo : S.items.map(i => i.id), i: 0, start: Date.now() }; openSheet(walkView, 'walk'); },
    walkTap: d => { const w = UI.walk; setLevel(findItem(w.queue[w.i]), d.lv); w.i++; save(); redrawSheet(); },
    walkSkip: () => { UI.walk.i++; redrawSheet(); },
    walkPlan: () => go('buy'),
    itemOpen: d => openSheet(() => itemSheet(d.id)), itemNew: () => openSheet(() => itemForm()), itemEdit: d => openSheet(() => itemForm(d.id)),
    itemDelete: d => openSheet(() => confirmSheet('Delete this item?', findItem(d.id).name + ' and its stock history will be removed.', 'Delete item', 'itemDeleteDo', d.id)),
    itemDeleteDo: d => { const done = undoable('Item deleted'); S.items = S.items.filter(i => i.id !== d.id); S.suppliers.forEach(s => delete s.quotes[d.id]); save(); closeSheet(); render(); done(); },
    quoteEdit: d => openSheet(() => quoteForm({ itemId: d.item || null, supplierId: d.sup || null })),
    quoteForSupplier: d => openSheet(() => quoteForm({ itemId: null, supplierId: d.sup })),
    quoteDelete: d => { delete findSup(d.sup).quotes[d.item]; save(); closeSheet(); render(); toast('Price removed'); },
    supplierNewFromQuote: d => openSheet(() => supplierForm(null, id => openSheet(() => quoteForm({ itemId: d.item || null, supplierId: id })))),
    budgetSet: d => { UI.budget = d.v; render(); },
    qtyStep: d => { const q = +d.q; UI.overrides[d.id] = { ...UI.overrides[d.id], qty: Math.max(1, q) }; render(); },
    skipLine: d => { UI.overrides[d.id] = { ...UI.overrides[d.id], skip: true }; render(); },
    unskipLine: d => { delete UI.overrides[d.id].skip; render(); },
    pickSupplier: d => openSheet(() => pickSheet(d.id)),
    supplierChoose: d => { UI.overrides[d.id] = { ...UI.overrides[d.id], supplierId: d.sup }; closeSheet(); render(); },
    sendOrder: d => {
      const group = plan().groups.find(g => g.supplier.id === d.sup);
      if (!group) return;
      const lines = group.lines.map(l => ({ name: l.item.name, qty: l.qty, unit: l.item.stockUnit }));
      const text = E.orderMessage(group.supplier.name, S.orgName, lines);
      const done = undoable('Order saved to your orders');
      if (E.normalisePhone(group.supplier.phone)) {
        window.open(E.whatsappLink(group.supplier.phone, text), '_blank', 'noopener');
        placeOrder(group); render(); done();
      } else {
        placeOrder(group); render();
        openSheet(() => h`${sheetHead('Your order is ready')}<p class="msg">${text}</p><div class="actions"><button class="btn btn-block" data-act="copyText" data-text="${text}">Copy message</button><button class="btn btn-line btn-block" data-act="closeSheet">Done</button></div>`);
      }
    },
    copyText: async d => { try { await navigator.clipboard.writeText(d.text); toast('Message copied'); } catch (e) { toast('Press and hold the message to copy it'); } },
    orderTab: d => { UI.orderTab = d.v; render(); },
    orderNext: d => { const o = S.orders.find(x => x.id === d.id); o.status = E.ORDER_FLOW[E.ORDER_FLOW.indexOf(o.status) + 1]; o.statusHistory.push({ status: o.status, at: Date.now() }); save(); render(); toast('Order marked ' + STATUS_WORD[o.status].toLowerCase()); },
    orderReceive: d => openSheet(() => receiveSheet(d.id)),
    orderCancel: d => openSheet(() => cancelSheet(d.id)),
    orderCancelDo: d => { const o = S.orders.find(x => x.id === d.id); o.status = 'Cancelled'; o.cancelReason = d.r; o.statusHistory.push({ status: 'Cancelled', at: Date.now() }); log('Cancelled an order from ' + o.supplierName); save(); closeSheet(); render(); toast('Order cancelled'); },
    orderChase: d => { const o = S.orders.find(x => x.id === d.id), s = findSup(o.supplierId); window.open(E.whatsappLink(s.phone, 'Hello ' + s.name + ', this is ' + S.orgName + '. Please, when will my order from ' + shortDate(o.placedAt) + ' arrive?'), '_blank', 'noopener'); },
    supplierNew: () => { UI.draftName = UI.draftPhone = ''; openSheet(() => supplierForm()); }, supplierEdit: d => openSheet(() => supplierForm(d.id)),
    supplierDelete: d => openSheet(() => confirmSheet('Delete this supplier?', 'Their saved prices will be removed. Past orders stay in your records.', 'Delete supplier', 'supplierDeleteDo', d.id)),
    supplierDeleteDo: d => { S.suppliers = S.suppliers.filter(s => s.id !== d.id); save(); go('suppliers'); toast('Supplier deleted'); },
    pickContact: async () => { try { const [c] = await navigator.contacts.select(['name', 'tel']); if (c) { UI.draftName = (c.name || [''])[0]; UI.draftPhone = (c.tel || [''])[0]; redrawSheet(); } } catch (e) { toast('Type the supplier details instead'); } },
    chartTip: d => { UI.chartTip = +d.i; render(); },
    theme: d => { S.settings.theme = d.v; applyTheme(); save(); render(); },
    ropMode: d => { S.settings.ropMode = d.v; save(); render(); },
    logSales: d => { const p = S.products.find(x => x.id === d.id), b = E.batchAdvice(p); openSheet(() => h`${sheetHead(p.name)}<form data-form="sales" data-id="${p.id}"><div class="two"><label class="field"><span>Made today</span><input name="made" type="number" min="0" required inputmode="numeric" value="${b.qty}"></label><label class="field"><span>Sold today</span><input name="sold" type="number" min="0" required inputmode="numeric"></label></div><button class="btn btn-block">Save sales</button></form>`); },
    productEdit: d => openSheet(() => productForm(d.id)),
    productDelete: d => { S.products = S.products.filter(p => p.id !== d.id); save(); closeSheet(); render(); toast('Product deleted'); },
    backup: () => { download('dpms-backup-' + today() + '.json', JSON.stringify(S, null, 1), 'application/json'); toast('Backup downloaded'); },
    exportCsv: () => {
      const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const rows = [['Date', 'Supplier', 'Item', 'Quantity', 'Unit', 'Price', 'Total', 'Status']];
      S.orders.forEach(o => o.lines.forEach(l => rows.push([E.dateKey(o.placedAt), o.supplierName, l.name, l.qty, l.unit, l.price, l.qty * l.price, STATUS_WORD[o.status] || o.status])));
      download('dpms-orders-' + today() + '.csv', rows.map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv');
      toast('Spreadsheet downloaded');
    },
    install: async () => { const p = UI.installPrompt; UI.installPrompt = null; if (p) { p.prompt(); await p.userChoice; } render(); },
    resetAsk: () => openSheet(() => confirmSheet('Delete all your records?', 'Every item, supplier and order on this device will be removed. Download a backup first if you may need them.', 'Delete everything', 'resetDo')),
    resetDo: () => { [KEY, ...OLD_KEYS].forEach(k => localStorage.removeItem(k)); S = E.freshState(); closeSheet(); history.replaceState(null, '', '#/'); applyTheme(); render(true); }
  };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset, el); }
  });

  /* ---------- Forms ---------- */
  const FORMS = {
    onbName: f => { UI.onb.name = f.name.trim(); if (!UI.onb.name) return; UI.onb.step = 'type'; render(true); },
    count: (f, form) => { setCount(findItem(form.dataset.id), Number(f.count)); save(); closeSheet(); render(); toast('Count saved'); },
    item: (f, form) => {
      const full = Number(f.full), levels = { full, half: Math.ceil(full / 2), low: Math.max(1, Math.ceil(full / 4)), out: 0 };
      if (full < 3) { toast('A full shelf must hold at least 3'); return; }
      const fields = { name: f.name.trim(), stockUnit: f.stockUnit, usageUnit: f.usageUnit.trim() || f.stockUnit, conversion: Number(f.conversion) || 1, leadTime: Number(f.leadTime), levels, weeklyEstimate: Number(f.weeklyEstimate) || 0 };
      const id = form.dataset.id;
      if (id) { const it = findItem(id); Object.assign(it, fields); if (f.onHand !== '' && Number(f.onHand) !== it.onHand) setCount(it, Number(f.onHand)); }
      else { const it = E.makeItem(fields); if (f.onHand !== '') setCount(it, Number(f.onHand)); S.items.push(it); log('Added ' + it.name); }
      save(); closeSheet(); render(); toast('Item saved');
    },
    quote: f => {
      let sup = f.supplierId ? findSup(f.supplierId) : null;
      if (!sup && f.newSupplier) { sup = { id: E.uid(), name: f.newSupplier.trim(), phone: f.newPhone || '', address: '', notes: '', marketDays: [], quotes: {} }; S.suppliers.push(sup); }
      if (!sup) return;
      setQuote(sup, f.itemId, Number(f.price), Number(f.leadDays), Number(f.quality) || 3);
      save(); closeSheet(); render(); toast('Price saved');
    },
    supplier: (f, form) => {
      const days = [...form.querySelectorAll('input[name=day]:checked')].map(x => x.value);
      if (f.phone.trim() && !E.normalisePhone(f.phone)) { toast('Enter a full phone number, like 0803 000 0000'); return; }
      const fields = { name: f.name.trim(), phone: f.phone.trim(), address: f.address.trim(), marketDays: days };
      let id = form.dataset.id;
      if (id) Object.assign(findSup(id), fields);
      else { id = E.uid(); S.suppliers.push({ id, notes: '', quotes: {}, ...fields }); log('Added supplier ' + fields.name); }
      save();
      const after = UI.afterSupplier; UI.afterSupplier = null;
      if (after) { after(id); render(); return; }
      closeSheet(); render(); toast('Supplier saved');
    },
    receive: (f, form) => {
      const o = S.orders.find(x => x.id === form.dataset.id), now = Date.now();
      o.lines.forEach((l, i) => {
        l.qty = Number(f['qty' + i]); l.price = Number(f['price' + i]);
        const item = findItem(l.itemId);
        if (item) setCount(item, (item.onHand || 0) + l.qty);
        const sup = findSup(o.supplierId);
        if (sup && sup.quotes[l.itemId] && l.price > 0) { const q = sup.quotes[l.itemId]; setQuote(sup, l.itemId, l.price, q.leadDays, q.quality); }
      });
      o.status = 'Delivered'; o.deliveredAt = now; o.quality = Number(f.quality) || null;
      o.statusHistory.push({ status: 'Delivered', at: now });
      log('Received an order from ' + o.supplierName);
      save(); closeSheet(); render(); toast('Added to your stock');
    },
    sales: (f, form) => {
      const p = S.products.find(x => x.id === form.dataset.id), d = today();
      p.log = p.log.filter(l => l.d !== d).concat({ d, made: Number(f.made), sold: Number(f.sold) }).slice(-60);
      save(); closeSheet(); render(); toast('Sales saved');
    },
    product: (f, form) => {
      const cost = Number(f.cost), price = Number(f.price), salvage = Number(f.salvage) || 0;
      if (price <= cost) { toast('Selling price must be higher than cost'); return; }
      if (salvage > cost) { toast('Value if unsold cannot be higher than cost'); return; }
      const fields = { name: f.name.trim(), cost, price, salvage, usual: Number(f.usual), needsReview: false };
      const id = form.dataset.id;
      if (id) Object.assign(S.products.find(p => p.id === id), fields); else S.products.push({ id: E.uid(), log: [], ...fields });
      save(); closeSheet(); render(); toast('Product saved');
    },
    business: f => { S.orgName = f.name.trim(); save(); render(); toast('Name saved'); }
  };
  document.addEventListener('submit', e => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    FORMS[form.dataset.form](Object.fromEntries(new FormData(form)), form);
  });
  document.addEventListener('input', e => {
    const t = e.target, kind = t.dataset && t.dataset.input;
    if (kind === 'search') { UI.search = t.value; render(); }
    if (kind === 'supSearch') { UI.supSearch = t.value; render(); }
    if (kind === 'budget') { UI.budget = t.value.replace(/\D/g, '').slice(0, 12); render(); }
    if (kind === 'star') t.closest('.stars').querySelectorAll('label').forEach((l, i) => l.classList.toggle('on', i < Number(t.value)));
  });
  document.addEventListener('change', async e => {
    const t = e.target, kind = t.dataset && t.dataset.input;
    if (kind === 'coverDays') { S.settings.coverDays = Number(t.value); save(); render(); }
    if (kind === 'restore' && t.files[0]) {
      const state = E.readBackup(await t.files[0].text());
      if (!state) { toast('That file is not a DPMS backup'); return; }
      S = state; save(); applyTheme(); render(true); toast('Backup restored');
    }
  });

  /* ---------- Offline and install ---------- */
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); UI.installPrompt = e; });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller) toast('A new version of DPMS is ready', { label: 'Update', run: () => next.postMessage('update') });
        });
      });
    }).catch(() => {});
    /* Reload only when replacing a running version, never on the very first visit. */
    let replacing = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (replacing) { replacing = false; location.reload(); } });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  applyTheme();
  render(true);
})();
