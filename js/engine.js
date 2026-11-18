/* DPMS engine: every calculation the app relies on, with no page or browser code.
   Runs in the browser (window.DPMSEngine) and in Node for the tests in tests/. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DPMSEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;
  const SCHEMA = 6;
  const LEVELS = ['full', 'half', 'low', 'out'];
  const ORDER_FLOW = ['Requested', 'Confirmed', 'Dispatched', 'Delivered'];
  const SERVICE_Z = { '0.90': 1.282, '0.95': 1.645, '0.99': 2.326 };

  /* Suppliers shipped with the old demo. They were invented, so they are removed on upgrade. */
  const DEMO_SUPPLIERS = ['Adewale Stores', 'Blessing Ventures', 'Chidi and Sons', 'Mama Ngozi Wholesale',
    'Delta Millers Ltd.', 'Golden Grain Suppliers', 'Grand Oils Nigeria', 'Ibadan Packaging Co.',
    'GreenWrap Recyclers', 'NigerPack Industries', 'Oyo Logistics Partners', 'SwiftMove Logistics',
    'Lagos Beauty Supply', 'Radiant Cosmetics', 'TechFix Industrial'];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const stdev = a => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  };

  /* Local calendar date, so a new day starts at midnight in the shop and not in UTC. */
  function dateKey(ts) {
    const d = new Date(ts === undefined ? Date.now() : ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function invNorm(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const low = 0.02425;
    let q, r;
    if (p < low) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p <= 1 - low) { q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  /* ---------- Stock ---------- */

  function levelOf(item) {
    if (item.onHand === null || item.onHand === undefined) return null;
    const l = item.levels;
    if (item.onHand <= l.out) return 'out';
    if (item.onHand <= l.low) return 'low';
    if (item.onHand <= l.half) return 'half';
    return 'full';
  }

  /* Daily usage in stock units, from real elapsed time between shelf checks.
     Deliveries restart the measurement, and checks under 12 hours apart are combined. */
  function dailyUsage(item) {
    const h = (item.history || []).slice().sort((x, y) => x.t - y.t);
    const estimate = (Number(item.weeklyEstimate) || 0) / 7;
    let anchor = h[0], drop = 0, days = 0;
    const rates = [];
    for (let i = 1; i < h.length; i++) {
      if (h[i].q > h[i - 1].q) { anchor = h[i]; continue; }
      const span = (h[i].t - anchor.t) / DAY;
      if (span < 0.5) continue;
      const used = anchor.q - h[i].q;
      drop += used; days += span; rates.push(used / span);
      anchor = h[i];
    }
    const measured = days > 0 ? drop / days : 0;
    const trusted = days >= 3 && rates.length >= 2;
    let perDay = 0, source = 'none';
    if (trusted) { perDay = measured; source = 'measured'; }
    else if (estimate > 0) { perDay = estimate; source = 'estimate'; }
    else if (days >= 1) { perDay = measured; source = 'early'; }
    const sd = rates.length >= 3 ? stdev(rates) : perDay * 0.3;
    return { perDay, sd, source, days };
  }

  function onOrderQty(itemId, orders) {
    return (orders || []).reduce((sum, o) => {
      if (o.status === 'Delivered' || o.status === 'Cancelled') return sum;
      return sum + (o.lines || []).filter(l => l.itemId === itemId).reduce((s, l) => s + l.qty, 0);
    }, 0);
  }

  function reorderInfo(item, settings, orders) {
    const cfg = settings || {};
    const { perDay, sd, source } = dailyUsage(item);
    const lead = item.leadTime || 1;
    const onOrder = onOrderQty(item.id, orders);
    let safety;
    if (cfg.ropMode === 'advanced') safety = (SERVICE_Z[cfg.serviceLevel] || SERVICE_Z['0.95']) * sd * Math.sqrt(lead);
    else safety = perDay * (item.safetyDays || 0);
    const rop = perDay > 0 ? Math.max(1, Math.ceil(perDay * lead + safety)) : item.levels.low;
    const base = { perDay, sd, source, lead, safety, rop, onOrder, daysLeft: null, position: null, minQty: 0, fullQty: 0 };
    if (item.onHand === null || item.onHand === undefined) return { ...base, state: 'unknown' };

    const position = item.onHand + onOrder;
    const daysLeft = perDay > 0 ? item.onHand / perDay : null;
    let state = 'ok';
    if (position <= rop) state = (item.onHand <= 0 || (daysLeft !== null && daysLeft < lead)) ? 'late' : 'buy';
    else if (onOrder > 0 && item.onHand <= rop) state = 'coming';
    else if (perDay > 0 && (position - rop) / perDay <= 3) state = 'soon';

    const cover = cfg.coverDays || 14;
    /* Never suggest more than the shelf can hold, unless safety stock alone needs it. */
    const wanted = perDay > 0 ? Math.ceil(perDay * (lead + cover) + safety) : item.levels.full;
    const target = Math.min(wanted, Math.max(item.levels.full, rop));
    const minQty = Math.max(1, Math.ceil(rop - position) || 1);
    const fullQty = Math.max(minQty, Math.ceil(target - position));
    return { ...base, state, position, daysLeft, minQty, fullQty };
  }

  /* ---------- Value engineering: value = function / cost ---------- */

  function supplierStats(supplierId, orders) {
    const mine = (orders || []).filter(o => o.supplierId === supplierId && o.status !== 'Cancelled');
    const received = mine.filter(o => o.status === 'Delivered');
    const timed = received.filter(o => o.expectedAt && o.deliveredAt);
    const onTime = timed.filter(o => o.deliveredAt <= o.expectedAt + DAY).length;
    const rated = received.filter(o => o.quality);
    return {
      orders: mine.length, received: received.length,
      onTimeRate: timed.length ? onTime / timed.length : null,
      avgQuality: rated.length ? mean(rated.map(o => o.quality)) : null,
      spent: received.reduce((s, o) => s + orderTotal(o), 0)
    };
  }

  /* Function out of 10: half quality, a quarter delivery speed, a quarter proven reliability. */
  function functionScore(quote, stats) {
    const quality = clamp(Number(quote.quality) || 3, 1, 5) * 2;
    const speed = clamp(10 * (1 - ((quote.leadDays || 3) - 1) / 14), 1, 10);
    const reliability = stats && stats.onTimeRate !== null && stats.received >= 2 ? stats.onTimeRate * 10 : 7;
    return quality * 0.5 + speed * 0.25 + reliability * 0.25;
  }

  /* Only suppliers with a price for this exact item can be ranked for it. */
  function rankQuotes(itemId, suppliers, orders) {
    const rows = (suppliers || []).filter(s => s.quotes && s.quotes[itemId] && s.quotes[itemId].price > 0).map(s => {
      const quote = s.quotes[itemId];
      const stats = supplierStats(s.id, orders);
      const fn = functionScore(quote, stats);
      return { supplier: s, quote, stats, fn, value: fn / quote.price };
    });
    if (!rows.length) return [];
    const top = Math.max(...rows.map(r => r.value));
    const cheapest = Math.min(...rows.map(r => r.quote.price));
    const fastest = Math.min(...rows.map(r => r.quote.leadDays || 3));
    rows.forEach(r => {
      r.score = Math.round((r.value / top) * 100);
      r.cheapest = r.quote.price === cheapest;
      r.fastest = (r.quote.leadDays || 3) === fastest;
    });
    return rows.sort((a, b) => b.value - a.value);
  }

  /* ---------- Buy plan: spend limited cash on what runs out first ---------- */

  function buildPlan(input) {
    const { items, suppliers, orders, settings, budget, overrides } = input;
    const ov = overrides || {};
    const rank = { late: 0, buy: 1, soon: 2 };
    const hasBudget = budget !== null && budget !== undefined && budget !== '';
    const wanted = hasBudget ? ['late', 'buy', 'soon'] : ['late', 'buy'];
    const unpriced = [], lines = [], skipped = [];

    items.forEach(item => {
      const info = reorderInfo(item, settings, orders);
      if (!wanted.includes(info.state)) return;
      if ((ov[item.id] || {}).skip) { skipped.push({ item, info }); return; }
      const ranked = rankQuotes(item.id, suppliers, orders);
      if (!ranked.length) { unpriced.push({ item, info }); return; }
      const choice = ranked.find(r => r.supplier.id === (ov[item.id] || {}).supplierId) || ranked[0];
      const fixed = (ov[item.id] || {}).qty;
      lines.push({
        item, info, ranked, choice, supplierId: choice.supplier.id, price: choice.quote.price,
        minQty: fixed || info.minQty, fullQty: fixed || info.fullQty, qty: 0
      });
    });

    lines.sort((a, b) => rank[a.info.state] - rank[b.info.state] ||
      (a.info.daysLeft === null ? 1e9 : a.info.daysLeft) - (b.info.daysLeft === null ? 1e9 : b.info.daysLeft));

    if (!hasBudget) {
      lines.forEach(l => { l.qty = l.fullQty; });
    } else {
      let left = Number(budget) || 0;
      /* First pass keeps every urgent item on the shelf until delivery. */
      lines.forEach(l => {
        const n = Math.min(l.minQty, Math.floor(left / l.price));
        if (n > 0) { l.qty = n; left -= n * l.price; }
      });
      /* Second pass tops up in the same order with whatever cash remains. */
      lines.forEach(l => {
        const n = Math.min(l.fullQty - l.qty, Math.floor(left / l.price));
        if (n > 0) { l.qty += n; left -= n * l.price; }
      });
    }

    const active = lines.filter(l => l.qty > 0);
    const deferred = lines.filter(l => l.qty === 0);
    const groups = [];
    active.forEach(l => {
      let g = groups.find(x => x.supplier.id === l.supplierId);
      if (!g) { g = { supplier: l.choice.supplier, lines: [], total: 0 }; groups.push(g); }
      g.lines.push(l);
      g.total += l.qty * l.price;
    });
    const total = groups.reduce((s, g) => s + g.total, 0);
    const needed = lines.reduce((s, l) => s + l.fullQty * l.price, 0);
    return { groups, deferred, unpriced, skipped, total, needed, left: hasBudget ? (Number(budget) || 0) - total : null };
  }

  /* ---------- Production: newsvendor model ---------- */

  function batchAdvice(product) {
    const sold = (product.log || []).slice(-28).map(l => l.sold);
    const measured = sold.length >= 5;
    const avg = measured ? mean(sold) : (Number(product.usual) || mean(sold));
    const sd = measured ? stdev(sold) : avg * 0.25;
    const lostSale = Math.max(0, product.price - product.cost);
    const waste = Math.max(0, product.cost - (product.salvage || 0));
    const ratio = lostSale + waste > 0 ? clamp(lostSale / (lostSale + waste), 0.05, 0.95) : 0.5;
    const qty = Math.max(0, Math.round(avg + invNorm(ratio) * sd));
    return { mean: avg, sd, ratio, qty, source: measured ? 'measured' : 'estimate', samples: sold.length };
  }

  /* ---------- Orders and WhatsApp ---------- */

  function orderTotal(order) {
    return (order.lines || []).reduce((s, l) => s + (l.price || 0) * l.qty, 0);
  }

  /* Nigerian numbers such as 0803 123 4567 become 2348031234567 for wa.me links. */
  function normalisePhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = '234' + d.slice(1);
    else if (d.length === 10 && /^[789]/.test(d)) d = '234' + d;
    return d.length >= 10 ? d : '';
  }

  function whatsappLink(phone, text) {
    const n = normalisePhone(phone);
    return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text);
  }

  function unitLabel(unit, n) {
    const u = !unit || unit === 'custom' ? 'unit' : unit === 'litre-bottle' ? 'litre bottle' : unit;
    if (n === 1) return u;
    return /(s|x|ch|sh)$/.test(u) ? u + 'es' : u + 's';
  }

  function orderMessage(supplierName, businessName, lines) {
    const rows = lines.map(l => '- ' + l.qty + ' ' + unitLabel(l.unit, l.qty) + ' of ' + l.name);
    return 'Hello ' + supplierName + ', this is ' + (businessName || 'a customer') + '.\n\n' +
      'I would like to order:\n' + rows.join('\n') + '\n\n' +
      'Please confirm the price and delivery date. Thank you.';
  }

  /* ---------- Insights, always from the shop's own records ---------- */

  function liveOrders(orders) { return (orders || []).filter(o => o.status !== 'Cancelled'); }

  function spendByWeek(orders, weeks, now) {
    const end = now === undefined ? Date.now() : now;
    const out = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const to = end - i * 7 * DAY, from = to - 7 * DAY;
      out.push({ from, to, total: liveOrders(orders).filter(o => o.placedAt > from && o.placedAt <= to).reduce((s, o) => s + orderTotal(o), 0) });
    }
    return out;
  }

  function spendBySupplier(orders) {
    const map = {};
    liveOrders(orders).forEach(o => { map[o.supplierName] = (map[o.supplierName] || 0) + orderTotal(o); });
    return Object.entries(map).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  }

  /* Money kept by buying below the dearest price on file when the order was placed. */
  function savings(orders) {
    return liveOrders(orders).reduce((s, o) => s + (o.lines || []).reduce((x, l) => x + (l.saved || 0), 0), 0);
  }

  function stockValue(items, suppliers) {
    return items.reduce((sum, it) => {
      const prices = suppliers.map(s => s.quotes && s.quotes[it.id] && s.quotes[it.id].price).filter(Boolean);
      return sum + (prices.length && it.onHand ? it.onHand * Math.min(...prices) : 0);
    }, 0);
  }

  function priceChanges(items, suppliers) {
    const out = [];
    suppliers.forEach(s => Object.entries(s.quotes || {}).forEach(([itemId, q]) => {
      const h = q.history || [];
      const item = items.find(i => i.id === itemId);
      if (!item || h.length < 2) return;
      const was = h[h.length - 2].price, now = h[h.length - 1].price;
      if (was > 0 && was !== now) out.push({ item, supplier: s, was, now, pct: ((now - was) / was) * 100, at: h[h.length - 1].t });
    }));
    return out.sort((a, b) => b.at - a.at);
  }

  function checkStreak(days, now) {
    const set = new Set(days || []);
    let t = now === undefined ? Date.now() : now;
    if (!set.has(dateKey(t))) t -= DAY;
    let n = 0;
    while (set.has(dateKey(t))) { n++; t -= DAY; }
    return n;
  }

  /* ---------- Saved data ---------- */

  function defaultSettings() {
    return { theme: 'auto', ropMode: 'simple', serviceLevel: '0.95', coverDays: 14 };
  }

  function freshState() {
    return {
      v: SCHEMA, onboarded: false, sample: false, createdAt: Date.now(), orgName: '', businessType: null, category: null,
      settings: defaultSettings(), items: [], suppliers: [], products: [], orders: [], activity: [], checkDays: []
    };
  }

  function makeItem(fields) {
    const full = Number(fields.full) || 10;
    return {
      id: uid(), name: fields.name, stockUnit: fields.stockUnit || 'bag', usageUnit: fields.usageUnit || fields.stockUnit || 'bag',
      conversion: Number(fields.conversion) || 1, leadTime: Number(fields.leadTime) || 3,
      safetyDays: fields.safetyDays === undefined ? 2 : Number(fields.safetyDays),
      levels: fields.levels || { full, half: Math.ceil(full / 2), low: Math.max(1, Math.ceil(full / 4)), out: 0 },
      onHand: fields.onHand === undefined || fields.onHand === '' ? null : Number(fields.onHand),
      weeklyEstimate: Number(fields.weeklyEstimate) || 0, history: [], lastCheck: null
    };
  }

  /* Upgrades data saved by earlier versions and keeps what the shop really entered. */
  function migrateState(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.v === SCHEMA) {
      const base = freshState();
      return { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } };
    }
    if (![3, 4, 5].includes(raw.v)) return null;
    const next = freshState();
    next.onboarded = !!raw.onboardingComplete;
    next.createdAt = raw.createdAt || next.createdAt;
    next.orgName = raw.orgName || '';
    next.businessType = raw.businessType || null;
    next.category = raw.category || null;
    next.settings = { ...next.settings, theme: raw.theme === 'dark' ? 'dark' : raw.theme === 'light' ? 'light' : 'auto', ropMode: raw.ropMode || 'simple', serviceLevel: raw.serviceLevel || '0.95' };
    next.activity = Array.isArray(raw.activity) ? raw.activity : [];
    next.items = (raw.stockItems || []).map(it => {
      const onHand = it.status && it.levels ? it.levels[it.status] : null;
      const history = it.isSeed ? (onHand !== null && it.lastTapDate ? (it.history || []).slice(-1) : []) : (it.history || []);
      return {
        id: it.id, name: it.name, stockUnit: it.stockUnit || 'bag', usageUnit: it.usageUnit || it.stockUnit || 'bag',
        conversion: it.conversion || 1, leadTime: it.leadTime || 3, safetyDays: it.safetyDays === undefined ? 2 : it.safetyDays,
        levels: it.levels, onHand, weeklyEstimate: 0, history, lastCheck: it.lastTapDate || null
      };
    });
    next.suppliers = (raw.suppliers || []).filter(s => !DEMO_SUPPLIERS.includes(s.name)).map(s => ({
      id: s.id, name: s.name, phone: s.phone || '', address: s.address || '', notes: s.note || '', marketDays: [], quotes: {}
    }));
    next.products = (raw.products || []).map(p => ({
      id: p.id, name: p.name, cost: p.cost, price: p.price, salvage: p.salvage || 0,
      usual: Math.round(mean(p.demandHistory || [])), log: [], needsReview: true
    }));
    next.orders = (raw.orders || []).map(o => ({
      id: o.id, supplierId: next.suppliers.some(s => s.id === o.supplierId) ? o.supplierId : null, supplierName: o.supplier,
      lines: [{ itemId: o.itemId, name: o.item, qty: 1, unit: 'unit', price: o.cost || 0, saved: 0 }],
      status: o.status === 'Ordered' ? 'Requested' : (o.status || 'Requested'), statusHistory: o.statusHistory || [],
      placedAt: o.placedAt || Date.now(), expectedAt: null, deliveredAt: null, cancelReason: o.cancelReason || null
    }));
    return next;
  }

  /* Rejects a backup file that is damaged or is not a DPMS backup. */
  function readBackup(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { return null; }
    const state = migrateState(parsed);
    if (!state || !Array.isArray(state.items) || !Array.isArray(state.suppliers) || !Array.isArray(state.orders)) return null;
    return state;
  }

  return {
    DAY, SCHEMA, LEVELS, ORDER_FLOW, DEMO_SUPPLIERS, uid, clamp, mean, dateKey, levelOf, dailyUsage, onOrderQty, reorderInfo,
    supplierStats, functionScore, rankQuotes, buildPlan, batchAdvice, orderTotal, normalisePhone, whatsappLink, unitLabel,
    orderMessage, spendByWeek, spendBySupplier, savings, stockValue, priceChanges, checkStreak, defaultSettings, freshState,
    makeItem, migrateState, readBackup
  };
});
