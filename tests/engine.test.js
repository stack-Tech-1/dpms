/* Run with: node --test tests/engine.test.js */
const test = require('node:test');
const assert = require('node:assert');
const E = require('../js/engine.js');

const NOW = new Date(2026, 10, 18, 9).getTime();
const days = n => NOW - n * E.DAY;
const item = (over = {}) => ({ ...E.makeItem({ name: 'Rice', full: 40, leadTime: 3, safetyDays: 2 }), id: 'rice', ...over });
const supplier = (id, price, quality = 3, leadDays = 3) => ({ id, name: id, phone: '', quotes: { rice: { price, quality, leadDays, history: [] } } });

test('daily usage uses real elapsed time', () => {
  const slow = item({ history: [{ t: days(10), q: 30 }, { t: days(5), q: 20 }, { t: days(0), q: 10 }] });
  assert.strictEqual(E.dailyUsage(slow).perDay, 2);
  assert.strictEqual(E.dailyUsage(slow).source, 'measured');
});

test('checks made minutes apart do not count as a day of usage', () => {
  const quick = item({ history: [{ t: days(0) - 3600000, q: 30 }, { t: days(0), q: 10 }] });
  assert.strictEqual(E.dailyUsage(quick).perDay, 0);
});

test('a delivery is not counted as negative usage', () => {
  const restocked = item({ history: [{ t: days(8), q: 20 }, { t: days(6), q: 10 }, { t: days(5), q: 40 }, { t: days(3), q: 30 }, { t: days(1), q: 20 }] });
  assert.strictEqual(E.dailyUsage(restocked).perDay, 5);
});

test('the shop estimate is used until enough checks exist', () => {
  const r = E.dailyUsage(item({ weeklyEstimate: 14 }));
  assert.strictEqual(r.perDay, 2);
  assert.strictEqual(r.source, 'estimate');
});

test('reorder point combines delivery time and safety days', () => {
  const info = E.reorderInfo(item({ weeklyEstimate: 14, onHand: 9 }), {}, []);
  assert.strictEqual(info.rop, 10);
  assert.strictEqual(info.state, 'buy');
});

test('an item that will run out before delivery is marked late', () => {
  assert.strictEqual(E.reorderInfo(item({ weeklyEstimate: 14, onHand: 4 }), {}, []).state, 'late');
});

test('stock already on order stops a duplicate suggestion', () => {
  const orders = [{ status: 'Confirmed', lines: [{ itemId: 'rice', qty: 30 }] }];
  const info = E.reorderInfo(item({ weeklyEstimate: 14, onHand: 6 }), {}, orders);
  assert.strictEqual(info.state, 'coming');
});

test('a suggested order never overfills the shelf', () => {
  const info = E.reorderInfo(item({ weeklyEstimate: 14, onHand: 6 }), { coverDays: 30 }, []);
  assert.strictEqual(info.fullQty, 34);
  const small = E.reorderInfo(item({ weeklyEstimate: 14, onHand: 6, levels: { full: 20, half: 10, low: 5, out: 0 } }), { coverDays: 30 }, []);
  assert.strictEqual(small.fullQty, 14);
});

test('only suppliers with a price for the item are ranked', () => {
  const other = { id: 'x', name: 'Logistics', quotes: {} };
  const ranked = E.rankQuotes('rice', [other, supplier('a', 60000)], []);
  assert.deepStrictEqual(ranked.map(r => r.supplier.id), ['a']);
});

test('better quality can beat a slightly lower price', () => {
  const ranked = E.rankQuotes('rice', [supplier('cheap', 58000, 2), supplier('good', 60000, 5)], []);
  assert.strictEqual(ranked[0].supplier.id, 'good');
  assert.strictEqual(ranked[0].score, 100);
});

test('the plan spends limited cash on the most urgent item first', () => {
  const late = item({ id: 'rice', name: 'Rice', weeklyEstimate: 14, onHand: 2 });
  const later = item({ id: 'oil', name: 'Oil', weeklyEstimate: 7, onHand: 4 });
  const s = { id: 's', name: 'S', quotes: { rice: { price: 1000, quality: 3, leadDays: 3 }, oil: { price: 1000, quality: 3, leadDays: 3 } } };
  const plan = E.buildPlan({ items: [later, late], suppliers: [s], orders: [], settings: {}, budget: 8000 });
  assert.strictEqual(plan.groups[0].lines[0].item.id, 'rice');
  assert.strictEqual(plan.groups[0].lines[0].qty, 8);
  assert.strictEqual(plan.total, 8000);
  assert.strictEqual(plan.deferred[0].item.id, 'oil');
});

test('the plan never spends more than the budget', () => {
  const plan = E.buildPlan({ items: [item({ weeklyEstimate: 14, onHand: 2 })], suppliers: [supplier('a', 3000)], orders: [], settings: {}, budget: 10000 });
  assert.strictEqual(plan.total, 9000);
  assert.strictEqual(plan.left, 1000);
});

test('items without a price are listed for the shop to complete', () => {
  const plan = E.buildPlan({ items: [item({ weeklyEstimate: 14, onHand: 2 })], suppliers: [], orders: [], settings: {} });
  assert.strictEqual(plan.unpriced.length, 1);
});

test('batch advice stays a number when unsold goods keep their full value', () => {
  const r = E.batchAdvice({ price: 500, cost: 300, salvage: 300, usual: 12, log: [] });
  assert.ok(Number.isFinite(r.qty));
});

test('batch advice follows the critical ratio', () => {
  const log = [40, 44, 48, 52, 56].map(sold => ({ sold }));
  const r = E.batchAdvice({ price: 700, cost: 400, salvage: 100, log });
  assert.strictEqual(r.ratio, 0.5);
  assert.strictEqual(r.qty, 48);
});

test('Nigerian phone numbers are converted for WhatsApp', () => {
  assert.strictEqual(E.normalisePhone('0803 421 7788'), '2348034217788');
  assert.strictEqual(E.normalisePhone('+234 803 421 7788'), '2348034217788');
  assert.strictEqual(E.normalisePhone('8034217788'), '2348034217788');
  assert.strictEqual(E.normalisePhone('123'), '');
});

test('the WhatsApp link carries the encoded order', () => {
  assert.strictEqual(E.whatsappLink('08034217788', 'Rice & oil'), 'https://wa.me/2348034217788?text=Rice%20%26%20oil');
});

test('the check streak counts back from today or yesterday', () => {
  assert.strictEqual(E.checkStreak([E.dateKey(days(0)), E.dateKey(days(1)), E.dateKey(days(3))], NOW), 2);
  assert.strictEqual(E.checkStreak([E.dateKey(days(1)), E.dateKey(days(2))], NOW), 2);
  assert.strictEqual(E.checkStreak([E.dateKey(days(4))], NOW), 0);
});

test('cancelled orders are left out of spending', () => {
  const orders = [
    { status: 'Delivered', placedAt: days(1), supplierName: 'A', lines: [{ qty: 2, price: 100 }] },
    { status: 'Cancelled', placedAt: days(1), supplierName: 'A', lines: [{ qty: 9, price: 100 }] }
  ];
  assert.strictEqual(E.spendBySupplier(orders)[0].total, 200);
});

test('upgrading old data removes invented suppliers and keeps the shop records', () => {
  const old = {
    v: 5, onboardingComplete: true, orgName: 'My Shop', businessType: 'reseller', theme: 'dark',
    stockItems: [{ id: 'i1', name: 'Rice', status: 'low', isSeed: true, lastTapDate: '2026-01-01', levels: { full: 32, half: 20, low: 10, out: 0 }, history: [{ t: 1, q: 20 }, { t: 2, q: 10 }] }],
    suppliers: [{ id: 's1', name: 'Adewale Stores', phone: '+234 803 421 7788' }],
    orders: [{ id: 'o1', item: 'Rice', itemId: 'i1', supplier: 'Adewale Stores', supplierId: 's1', cost: 5000, status: 'Delivered', placedAt: 5 }]
  };
  const next = E.migrateState(old);
  assert.strictEqual(next.v, E.SCHEMA);
  assert.strictEqual(next.orgName, 'My Shop');
  assert.strictEqual(next.suppliers.length, 0);
  assert.strictEqual(next.items[0].onHand, 10);
  assert.strictEqual(next.items[0].history.length, 1);
  assert.strictEqual(next.orders[0].supplierName, 'Adewale Stores');
  assert.strictEqual(next.settings.theme, 'dark');
});

test('a damaged backup file is rejected', () => {
  assert.strictEqual(E.readBackup('not json'), null);
  assert.strictEqual(E.readBackup('{"v":99}'), null);
  assert.ok(E.readBackup(JSON.stringify(E.freshState())));
});
