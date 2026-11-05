// ทดสอบ backend (apps-script/*.gs) ด้วยบริการ Google จำลอง:  node tests/run.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createGasFakes, loadGas } = require(path.join(root, 'dev/gas-fakes.js'));
const GS_ORDER = ['Code.gs', 'Store.gs', 'Providers.gs', 'Poller.gs', 'Alerts.gs', 'Reports.gs', 'ReportGrid.gs'];
const sources = GS_ORDER.map(f => readFileSync(path.join(root, 'apps-script', f), 'utf8'));
if (readdirSync(path.join(root, 'apps-script')).filter(f => f.endsWith('.gs')).length !== GS_ORDER.length) throw new Error('GS_ORDER ไม่ครบ');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'eq') + ': got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function throwsCode(fn, code) {
  try { fn(); } catch (e) { if (e.code === code) return; throw new Error('expected ' + code + ' got ' + (e.code || e.message)); }
  throw new Error('expected throw ' + code);
}

function fresh(http) {
  const fakes = createGasFakes({ crypto, http, keepBlobs: true });
  const G = loadGas(sources, fakes);
  return { fakes, G };
}

const MIN = 60000;
const T0 = Date.UTC(2026, 9, 12, 1, 0);   // 12 ต.ค. 2026 08:00 เวลาไทย

function seed(G, fakes) {
  G.setup();
  const acc = G.readTable('accounts', true);
  acc.rows[0].active = true;
  G.saveRow(acc, acc.rows[0]);
  G.resetTableCache();
  const add = s => { G.resetTableCache(); return G.saveSensor(s).sensor; };
  return {
    fridge: add({ accountId: 'MOCK', deviceId: 'mock-fridge-1', branch: '05 เมืองใหม่นายอาม', location: 'ตู้เย็นยา', zoneType: 'fridge', active: true }),
    room:   add({ accountId: 'MOCK', deviceId: 'mock-room-1',   branch: '05 เมืองใหม่นายอาม', location: 'ห้องขายยา', zoneType: 'room', active: true }),
    other:  add({ accountId: 'MOCK', deviceId: 'mock-room-2',   branch: '12 ทับช้าง',         location: 'ห้องขายยา', zoneType: 'room', active: true }),
  };
}
const force = (fakes, o) => { fakes.state.props.MOCK_FORCE = JSON.stringify(o); };
const sensorRow = (G, id) => { G.resetTableCache(); return G.readTable('sensors').rows.find(r => String(r.sensorId) === id); };
const excRows = G => { G.resetTableCache(); return G.readTable('excursions').rows; };

console.log('Setup');
test('setup สร้างชีต เกณฑ์เริ่มต้น และ trigger 3 ตัว', () => {
  const { fakes, G } = fresh();
  G.setup();
  const ss = fakes.globals.SpreadsheetApp.getActiveSpreadsheet();
  ['Accounts', 'Sensors', 'ZoneDefaults', 'Excursions', 'Daily', 'AlertLog', 'LineTargets', 'LinePending', 'Users'].forEach(n => ok(ss.getSheetByName(n), 'missing ' + n));
  const z = G.zoneMap();
  eq([z.fridge.tMin, z.fridge.tMax, z.room.tWarn, z.room.tMax, z.room.hMax], [2, 8, 25, 30, 70]);
  eq(fakes.triggers().map(t => t.fn).sort(), ['dailySummaryTrigger', 'monthlyReportTrigger', 'pollTrigger']);
  G.setup();   // รันซ้ำต้องไม่เพิ่มแถว/trigger ซ้ำ
  G.resetTableCache();
  eq(G.readTable('zones').rows.length, 2);
  eq(fakes.triggers().length, 3);
});

test('saveSensor สร้างรหัสตามสาขา และกันผูกอุปกรณ์ซ้ำ', () => {
  const { fakes, G } = fresh();
  const s = seed(G, fakes);
  eq([s.fridge.sensorId, s.room.sensorId, s.other.sensorId], ['05-01', '05-02', '12-01']);
  G.resetTableCache();
  throwsCode(() => G.saveSensor({ accountId: 'MOCK', deviceId: 'mock-room-1', branch: '05 x', location: 'ซ้ำ', zoneType: 'room' }), 'duplicate');
  throwsCode(() => G.saveSensor({ accountId: 'MOCK', deviceId: 'y', branch: 'ไม่มีเลข', location: 'a', zoneType: 'room' }), 'invalid');
  throwsCode(() => G.saveSensor({ accountId: 'MOCK', deviceId: 'y', branch: '05 x', location: 'a', zoneType: 'freezer' }), 'invalid');
});

console.log('State machine');
test('ผิดเกณฑ์ 1 ครั้งยังไม่เปิด, ครั้งที่ 2 เปิด, เตือนซ้ำทุก 60 นาที, กลับปกติแล้วปิด', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  force(fakes, { 'mock-fridge-1': 5 });
  let r = G.runPoll(T0, { silent: true });
  eq(r.events.length, 0);
  eq(sensorRow(G, '05-01').state, 'ok');

  force(fakes, { 'mock-fridge-1': 9.5 });
  r = G.runPoll(T0 + 15 * MIN, { silent: true });
  eq(r.events.filter(e => e.sensorId === '05-01').length, 0, 'ครั้งแรกยังไม่เปิด');
  eq(sensorRow(G, '05-01').state, 'alarm');
  eq(excRows(G).length, 0);

  force(fakes, { 'mock-fridge-1': 10.4 });
  r = G.runPoll(T0 + 30 * MIN, { silent: true });
  eq(r.events.filter(e => e.sensorId === '05-01').map(e => e.kind), ['open']);
  let ex = excRows(G);
  eq(ex.length, 1);
  eq([ex[0].type, ex[0].status, ex[0].maxTemp, ex[0].durationMin], ['high', 'open', 10.4, 15]);
  eq(new Date(ex[0].start).getTime(), T0 + 15 * MIN, 'เริ่มนับจากค่าแรกที่ผิด');
  ok(/^EX-2610-0001$/.test(ex[0].id), ex[0].id);

  r = G.runPoll(T0 + 45 * MIN, { silent: true });
  eq(r.events.filter(e => e.sensorId === '05-01').length, 0, 'ยังไม่ถึงรอบเตือนซ้ำ');
  r = G.runPoll(T0 + 90 * MIN, { silent: true });
  eq(r.events.filter(e => e.sensorId === '05-01').map(e => e.kind), ['still']);

  force(fakes, { 'mock-fridge-1': 6.1 });
  r = G.runPoll(T0 + 105 * MIN, { silent: true });
  eq(r.events.filter(e => e.sensorId === '05-01').map(e => e.kind), ['close']);
  ex = excRows(G);
  eq([ex[0].status, ex[0].durationMin], ['closed', 90]);
  const s = sensorRow(G, '05-01');
  eq([s.state, s.excId, s.badCount], ['ok', '', 0]);
});

test('ผิดเกณฑ์ครั้งเดียว (เปิดประตูตู้เย็น) ไม่เปิดเหตุการณ์', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  force(fakes, { 'mock-fridge-1': 9 });
  G.runPoll(T0, { silent: true });
  force(fakes, { 'mock-fridge-1': 5 });
  const r = G.runPoll(T0 + 15 * MIN, { silent: true });
  eq(r.events.length, 0);
  eq(excRows(G).length, 0);
  eq(sensorRow(G, '05-01').badCount, 0);
});

test('ต่ำกว่าเกณฑ์ตู้เย็น (<2°C) และ เฝ้าระวังห้อง (>25°C) ไม่แจ้ง', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  force(fakes, { 'mock-fridge-1': 1.2, 'mock-room-1': 27 });
  G.runPoll(T0, { silent: true });
  const r = G.runPoll(T0 + 15 * MIN, { silent: true });
  eq(r.events.map(e => e.sensorId + ':' + e.kind + ':' + e.type), ['05-01:open:low']);
  eq(sensorRow(G, '05-02').state, 'warn');
});

test('ขาดการเชื่อมต่อ ≥ 30 นาทีแจ้งครั้งเดียว และแจ้งเมื่อกลับมา', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  force(fakes, {});
  G.runPoll(T0, { silent: true });
  force(fakes, { 'mock-room-2': 'offline' });
  let r = G.runPoll(T0 + 15 * MIN, { silent: true });
  eq(r.events.length, 0, '15 นาทียังไม่แจ้ง');
  r = G.runPoll(T0 + 30 * MIN, { silent: true });
  eq(r.events.map(e => e.sensorId + ':' + e.kind), ['12-01:offline']);
  r = G.runPoll(T0 + 45 * MIN, { silent: true });
  eq(r.events.length, 0, 'ไม่แจ้งซ้ำ');
  eq(sensorRow(G, '12-01').state, 'offline');
  force(fakes, {});
  r = G.runPoll(T0 + 60 * MIN, { silent: true });
  eq(r.events.map(e => e.sensorId + ':' + e.kind), ['12-01:online']);
  const ex = excRows(G)[0];
  eq([ex.type, ex.status, ex.durationMin], ['offline', 'closed', 60]);
});

test('บัญชี API ใช้ไม่ได้ → เซ็นเซอร์ offline + แจ้งส่วนกลางครั้งเดียว', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  G.runPoll(T0, { silent: true });
  const acc = G.readTable('accounts', true);
  acc.rows[0].provider = 'switchbot';   // ไม่มี CRED → error
  G.saveRow(acc, acc.rows[0]);
  fakes.state.props.ALERT_EMAILS = 'ops@example.com';
  let r = G.runPoll(T0 + 15 * MIN);
  eq(r.accountErrors.length, 1);
  ok(/CRED_MOCK/.test(r.accountErrors[0].error));
  eq(fakes.sent.mail.length, 1);
  G.runPoll(T0 + 30 * MIN);
  eq(fakes.sent.mail.filter(m => /ดึงข้อมูล/.test(m.subject)).length, 1, 'ไม่แจ้งซ้ำภายใน 6 ชม.');
  ok(r.read === 0);
  G.resetTableCache();
  ok(/CRED_MOCK/.test(G.readTable('accounts').rows[0].lastError));
});

console.log('Daily + readings');
test('สะสมรายวัน (ต่ำสุด/สูงสุด/เฉลี่ย) + ขึ้นวันใหม่บันทึกลง Daily', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  const day0 = Date.UTC(2026, 9, 11, 17, 0);  // 12 ต.ค. 00:00 ไทย
  const temps = { 465: 3.6, 495: 5.5, 540: 6.0, 765: 7.2, 795: 6.4, 1200: 3.1 };
  Object.keys(temps).forEach(m => { force(fakes, { 'mock-fridge-1': temps[m] }); G.runPoll(day0 + Number(m) * MIN, { silent: true }); });
  let s = sensorRow(G, '05-01');
  eq([s.dayMin, s.dayMax, s.dayN], [3.1, 7.2, 6]);
  G.runPoll(day0 + 24 * 60 * MIN + 5 * MIN, { silent: true });
  G.resetTableCache();
  const d = G.readTable('daily').rows.filter(r => r.sensorId === '05-01');
  eq(d.length, 1);
  eq([G.dayKey(d[0].date), d[0].tMin, d[0].tMax, d[0].tAvg, d[0].readings, d[0].state], ['2026-10-12', 3.1, 7.2, 5.3, 6, 'ok']);
  s = sensorRow(G, '05-01');
  eq([G.dayKey(s.dayDate), s.dayN], ['2026-10-13', 1]);
});

test('ค่ารอบเวลาคำนวณจากค่าดิบ: เช้า = ค่าแรกช่วง 08:00–09:30, บ่าย = ค่าแรก 13:00–14:00', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  const now = Date.now();
  const day0 = G.dayStartMs(G.dayKey(now)) - 86400000;   // เมื่อวาน 00:00 ไทย
  // 07:45 ยังไม่ใช่รอบเช้า, 08:15 = เช้า, 09:00 ไม่ทับค่าแรก, 12:45 ยังไม่ใช่บ่าย, 13:15 = บ่าย, 20:00
  const temps = { 465: 3.6, 495: 5.5, 540: 6.0, 765: 7.2, 795: 6.4, 1200: 3.1 };
  Object.keys(temps).forEach(m => { force(fakes, { 'mock-fridge-1': temps[m] }); G.runPoll(day0 + Number(m) * MIN, { silent: true }); });
  const sess = G.startSession({ email: 'goodyearzph@gmail.com', name: 'A' }).session;
  const y = G.dayKey(day0);
  let r = G.route({ action: 'monthly', session: sess, branch: '05 เมืองใหม่นายอาม', from: y, to: y });
  eq(r.dates, [y]);
  const v = r.values['05-01'][y];
  eq([v[0].t, v[0].ts, v[1].t, v[1].ts], [5.5, day0 + 495 * MIN, 6.4, day0 + 795 * MIN]);
  ok(v[0].h != null, 'มีความชื้นของรอบ');
  // ดูตัวอย่างด้วยค่าตั้งที่ยังไม่บันทึก: 3 รอบ (เพิ่ม 20:00) → มีผลย้อนหลังทันที
  const draft = { slots: [{ label: 'เช้า', from: '07:30', to: '08:00' }, { label: 'บ่าย', from: '12:00', to: '13:00' }, { label: 'ค่ำ', short: 'ค', from: '20:00', to: '21:00' }] };
  r = G.route({ action: 'monthly', session: sess, branch: '05 เมืองใหม่นายอาม', from: y, to: y, settings: draft });
  eq(r.values['05-01'][y].map(x => x && x.t), [3.6, 7.2, 3.1]);
  eq(r.settings.slots.map(x => x.short), ['เ', 'บ', 'ค']);
});

test('ไม่มีค่าในช่วงรอบเช้า → ช่องเช้าว่าง', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  const day0 = G.dayStartMs(G.dayKey(Date.now())) - 86400000;
  [585, 600, 790].forEach(m => G.runPoll(day0 + m * MIN, { silent: true }));   // 09:45, 10:00, 13:10
  const sess = G.startSession({ email: 'goodyearzph@gmail.com', name: 'A' }).session;
  const y = G.dayKey(day0);
  const v = G.route({ action: 'monthly', session: sess, branch: '05 เมืองใหม่นายอาม', from: y, to: y }).values['05-01'][y];
  eq([v[0], v[1] && v[1].ts], [null, day0 + 790 * MIN]);
});

test('เวลานอกเกณฑ์ต่อวันถูกนับลง Daily', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  const day0 = Date.UTC(2026, 9, 11, 17, 0);
  [5, 9, 9.5, 10, 5].forEach((t, i) => { force(fakes, { 'mock-fridge-1': t }); G.runPoll(day0 + 10 * 3600000 + i * 15 * MIN, { silent: true }); });
  eq(sensorRow(G, '05-01').dayExcMin, 45);
  eq(sensorRow(G, '05-01').dayWorst, 'alarm');
});

test('เก็บค่าดิบแยกไฟล์รายเดือน/แท็บสาขา และอ่านกราฟย้อนหลังได้', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  const now = Date.now();
  for (let i = 8; i >= 0; i--) G.runPoll(now - i * 15 * MIN, { silent: true });
  const mk = G.monthKey(now);
  const ss = fakes.globals.SpreadsheetApp.openById(fakes.state.props['READINGS_' + mk]);
  ok(ss.getSheetByName('05') && ss.getSheetByName('12'), 'แท็บสาขา');
  eq(ss.getSheetByName('05').getLastRow(), 1 + 9 * 2);
  const sess = G.startSession({ email: 'goodyearzph@gmail.com', name: 'Admin' }).session;
  const h = G.route({ action: 'history', session: sess, sensorId: '05-01', hours: 3 });
  eq(h.points.length, 9);
  ok(h.points[0][0] < h.points[8][0]);
});

console.log('API / สิทธิ์');
function addUser(fakes, G, email, branch, status) {
  const sh = fakes.globals.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
  sh.appendRow([email, branch, new Date().toISOString(), 'user', status]);
  return G.startSession({ email, name: email }).session;
}
test('พนักงานเห็นเฉพาะสาขาตัวเอง, แอดมินเห็นทั้งหมด', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  G.runPoll(T0, { silent: true });
  const staff = addUser(fakes, G, 'staff5@x.com', '05 เมืองใหม่นายอาม', 'approved');
  G.resetTableCache();
  eq(G.route({ action: 'overview', session: staff }).sensors.map(s => s.sensorId), ['05-01', '05-02']);
  const admin = G.startSession({ email: 'goodyearzph@gmail.com', name: 'A' }).session;
  eq(G.route({ action: 'overview', session: admin }).sensors.length, 3);
  throwsCode(() => G.route({ action: 'history', session: staff, sensorId: '12-01' }), 'forbidden');
  throwsCode(() => G.route({ action: 'adminConfig', session: staff }), 'forbidden');
  const pending = addUser(fakes, G, 'new@x.com', '05 เมืองใหม่นายอาม', '');
  throwsCode(() => G.route({ action: 'overview', session: pending }), 'not_approved');
  throwsCode(() => G.route({ action: 'overview', session: 'nope' }), 'unauthorized');
});

test('บันทึกการแก้ไข excursion (ต้องมีข้อความ และอยู่ในสาขา)', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  force(fakes, { 'mock-fridge-1': 11 });
  G.runPoll(T0, { silent: true });
  G.runPoll(T0 + 15 * MIN, { silent: true });
  const id = excRows(G)[0].id;
  const staff = addUser(fakes, G, 'staff5@x.com', '05 เมืองใหม่นายอาม', 'approved');
  const other = addUser(fakes, G, 'staff12@x.com', '12 ทับช้าง', 'approved');
  throwsCode(() => G.route({ action: 'ackExcursion', session: staff, id, correctiveAction: '' }), 'invalid');
  throwsCode(() => G.route({ action: 'ackExcursion', session: other, id, correctiveAction: 'ปิดประตูตู้เย็น' }), 'forbidden');
  const r = G.route({ action: 'ackExcursion', session: staff, id, correctiveAction: 'ปิดประตูตู้เย็นให้สนิท ย้ายยาไปตู้สำรอง' });
  ok(r.excursion.ackAt && /staff5/.test(r.excursion.ackBy));
  G.resetTableCache();
  eq(G.route({ action: 'overview', session: staff }).excursions.length, 1, 'ยังเปิดอยู่จึงยังแสดง');
});

console.log('LINE');
test('ส่งข้อความเดียวต่อกลุ่ม: กลุ่มสาขาได้เฉพาะสาขาตัวเอง, กลุ่ม * ได้ทั้งหมด', () => {
  const pushes = [];
  const { fakes, G } = fresh(req => { if (/message\/push/.test(req.url)) pushes.push(JSON.parse(req.payload)); return { code: 200, body: '{}' }; });
  seed(G, fakes);
  fakes.state.props.LINE_CHANNEL_TOKEN = 'tok';
  fakes.state.props.APP_URL = 'https://example.org/app';
  G.resetTableCache();
  G.saveLineTarget({ branch: '05 เมืองใหม่นายอาม', groupId: 'C' + 'a'.repeat(32), label: 'กลุ่ม 05' });
  G.saveLineTarget({ branch: '*', groupId: 'C' + 'b'.repeat(32), label: 'ส่วนกลาง' });
  G.runPoll(T0);
  force(fakes, { 'mock-fridge-1': 12, 'mock-room-2': 31.5 });
  G.runPoll(T0 + 15 * MIN);
  const r = G.runPoll(T0 + 30 * MIN);
  eq(r.sent.length, 2);
  eq(pushes.length, 2);
  const to05 = pushes.find(p => p.to === 'C' + 'a'.repeat(32)).messages[0].text;
  const toAll = pushes.find(p => p.to === 'C' + 'b'.repeat(32)).messages[0].text;
  ok(/ตู้เย็นยา 12\.0°C/.test(to05) && !/ทับช้าง/.test(to05), to05);
  ok(/ทับช้าง/.test(toAll) && /เมืองใหม่/.test(toAll) && /example\.org/.test(toAll), toAll);
  ok(/2–8°C/.test(to05));
});

test('LINE ส่งไม่สำเร็จ (โควตาหมด) → ส่งอีเมลแทน และบันทึก AlertLog', () => {
  const { fakes, G } = fresh(req => (/message\/push/.test(req.url) ? { code: 429, body: '{"message":"You have reached your monthly limit."}' } : { code: 200, body: '{}' }));
  seed(G, fakes);
  fakes.state.props.LINE_CHANNEL_TOKEN = 'tok';
  fakes.state.props.ALERT_EMAILS = 'a@x.com';
  G.resetTableCache();
  G.saveLineTarget({ branch: '*', groupId: 'C' + 'b'.repeat(32), label: 'ส่วนกลาง' });
  force(fakes, { 'mock-fridge-1': 12 });
  G.runPoll(T0);
  G.runPoll(T0 + 15 * MIN);
  eq(fakes.sent.mail.length, 1);
  G.resetTableCache();
  const log = G.readTable('alertLog').rows;
  ok(log.some(l => /^quota_/.test(l.result)) && log.some(l => l.channel === 'email' && l.result === 'ok'));
});

test('webhook: บอทเข้ากลุ่ม → บันทึก groupId รอแอดมินผูกสาขา (ไม่ซ้ำ)', () => {
  const { fakes, G } = fresh();
  G.setup();
  const gid = 'C' + 'c'.repeat(32);
  const body = { destination: 'U1', events: [{ type: 'join', source: { type: 'group', groupId: gid }, replyToken: 'r' }] };
  G.doPost({ postData: { contents: JSON.stringify(body) } });
  G.resetTableCache();
  G.doPost({ postData: { contents: JSON.stringify({ destination: 'U1', events: [{ type: 'message', message: { type: 'text', text: '#ลงทะเบียน' }, source: { type: 'group', groupId: gid } }] }) } });
  G.doPost({ postData: { contents: JSON.stringify({ destination: 'U1', events: [{ type: 'message', message: { type: 'text', text: 'สวัสดี' }, source: { type: 'group', groupId: 'C' + 'd'.repeat(32) } }] }) } });
  G.resetTableCache();
  eq(G.readTable('linePending').rows.map(r => r.groupId), [gid]);
});

console.log('Providers');
test('SwitchBot: ลายเซ็นตรงกับสูตรในเอกสาร (base64 HMAC-SHA256 ของ token+t+nonce)', () => {
  const { G } = fresh();
  const expect = crypto.createHmac('sha256', 'sec').update('tok' + '1700000000000' + 'n-1').digest('base64');
  eq(G.switchbotSign('tok', 'sec', '1700000000000', 'n-1'), expect);
});

test('SwitchBot: อ่านค่า + จัดการเครื่องออฟไลน์ (161) และ token ผิด (401)', () => {
  let mode = 'ok';
  const { fakes, G } = fresh(req => {
    if (mode === '401') return { code: 401, body: '{"message":"Unauthorized"}' };
    ok(req.headers.sign && req.headers.t && req.headers.nonce && req.headers.Authorization === 'tok');
    if (/AAA/.test(req.url)) return { code: 200, body: { statusCode: 100, body: { deviceId: 'AAA', temperature: 6.3, humidity: 41, battery: 88 } } };
    return { code: 200, body: { statusCode: 161, message: 'device offline' } };
  });
  fakes.state.props.CRED_SB1 = JSON.stringify({ token: 'tok', secret: 'sec' });
  const r = G.PROVIDERS.switchbot.read({ accountId: 'SB1' }, ['AAA', 'BBB'], 123);
  eq(r.AAA, { online: true, temp: 6.3, hum: 41, battery: 88, ts: 123 });
  eq(r.BBB.online, false);
  eq(r.BBB.error, 'switchbot_161');
  mode = '401';
  throwsCode(() => G.PROVIDERS.switchbot.read({ accountId: 'SB1' }, ['AAA'], 1), 'provider_auth');
});

test('Tuya: ลายเซ็น token/ธุรกิจตรงกับสูตร และแปลงค่า va_temperature/10', () => {
  const calls = [];
  const { fakes, G } = fresh(req => {
    calls.push(req);
    const h = req.headers;
    const u = new URL(req.url);
    const pq = u.pathname + (u.search ? decodeURIComponent(u.search) : '');
    const sts = 'GET\n' + crypto.createHash('sha256').update('').digest('hex') + '\n\n' + pq;
    const expect = crypto.createHmac('sha256', 'S3').update('CID' + (h.access_token || '') + h.t + h.nonce + sts).digest('hex').toUpperCase();
    if (h.sign !== expect) return { code: 200, body: { success: false, code: 1004, msg: 'sign invalid' } };
    if (u.pathname === '/v1.0/token') return { code: 200, body: { success: true, result: { access_token: 'AT', expire_time: 7200 } } };
    return { code: 200, body: { success: true, result: { has_more: false, devices: [
      { id: 'd1', name: 'Fridge', online: true, category: 'wsdcg', status: [{ code: 'va_temperature', value: 54 }, { code: 'va_humidity', value: 47 }, { code: 'battery_percentage', value: 90 }] },
      { id: 'd2', name: 'Room', online: false, category: 'wsdcg', status: [{ code: 'va_temperature', value: 281 }] },
    ] } } };
  });
  fakes.state.props.CRED_TY = JSON.stringify({ clientId: 'CID', secret: 'S3', baseUrl: 'https://openapi.tuyaus.com' });
  const r = G.PROVIDERS.tuya.read({ accountId: 'TY' }, ['d1', 'd2', 'd3'], 5);
  eq(r.d1, { online: true, temp: 5.4, hum: 47, battery: 90, ts: 5 });
  eq([r.d2.online, r.d2.error, r.d3.error], [false, 'tuya_offline', 'tuya_not_found']);
  ok(calls[1].url.indexOf('last_row_key') === -1, 'ตัด query ว่างออก');
  const list = G.PROVIDERS.tuya.list({ accountId: 'TY' });
  eq(list.map(d => d.deviceId + ':' + d.isSensor), ['d1:true', 'd2:true']);
  eq(calls.filter(c => /token/.test(c.url)).length, 1, 'แคช token');
});

console.log('Reports');
test('สรุปรายวัน: กลุ่มสาขา + กลุ่มส่วนกลางแสดงเฉพาะสาขาที่มีปัญหา', () => {
  const pushes = [];
  const { fakes, G } = fresh(req => { if (/push/.test(req.url)) pushes.push(JSON.parse(req.payload)); return { code: 200, body: '{}' }; });
  seed(G, fakes);
  const day0 = Date.UTC(2026, 9, 11, 17, 0);
  force(fakes, { 'mock-fridge-1': 9.8, 'mock-room-1': 24, 'mock-room-2': 27 });
  for (let i = 0; i < 4; i++) G.runPoll(day0 + 10 * 3600000 + i * 15 * MIN, { silent: true });
  fakes.state.props.LINE_CHANNEL_TOKEN = 'tok';
  G.resetTableCache();
  G.saveLineTarget({ branch: '05 เมืองใหม่นายอาม', groupId: 'C' + 'a'.repeat(32), label: '05' });
  G.saveLineTarget({ branch: '*', groupId: 'C' + 'b'.repeat(32), label: 'กลาง' });
  const r = G.sendDailySummary(day0 + 32 * 3600000);  // 13 ต.ค. 08:00
  eq(r.date, '2026-10-12');
  const b05 = pushes.find(p => p.to === 'C' + 'a'.repeat(32)).messages[0].text;
  const all = pushes.find(p => p.to === 'C' + 'b'.repeat(32)).messages[0].text;
  ok(/🔴 ตู้เย็นยา: 9\.8°C – 9\.8°C · ผิดเกณฑ์ 45 นาที/.test(b05), b05);
  ok(/รอบันทึกการแก้ไข 1 รายการ/.test(b05), b05);
  ok(/ปกติ 1 · ต้องตรวจสอบ 1/.test(all) && /✅ ไม่มีจุดผิดเกณฑ์: 12/.test(all), all);
  ok(!/🟡/.test(all), 'เฝ้าระวังไม่แสดงในกลุ่มส่วนกลาง');
  ok(/12 ต\.ค\. 2569/.test(all), 'ปี พ.ศ.');
});

test('Console ปรับกราฟ: บันทึก/ตรวจค่าตั้ง (เวลา, ซ้อนกัน, สเกล) และส่งให้ทุกคนใน overview', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  const admin = G.startSession({ email: 'goodyearzph@gmail.com', name: 'A' }).session;
  const save = settings => G.route({ action: 'saveChartSettings', session: admin, settings });
  throwsCode(() => save({ slots: [{ label: 'เช้า', from: '9:00', to: '08:00' }] }), 'invalid');
  throwsCode(() => save({ slots: [{ from: '08:00', to: '10:00' }, { from: '09:30', to: '11:00' }] }), 'invalid');
  throwsCode(() => save({ slots: [1, 2, 3, 4, 5].map(i => ({ from: '0' + i + ':00', to: '0' + i + ':30' })) }), 'invalid');
  throwsCode(() => save({ scales: { fridge: { min: 10, max: 2, step: 1 } } }), 'invalid');
  throwsCode(() => save({ scales: { room: { min: 0, max: 50, step: 0.1 } } }), 'invalid');
  throwsCode(() => save({ hum: { min: 0, max: 120, step: 10 } }), 'invalid');
  const r = save({ slots: [{ label: 'บ่าย', from: '13:00', to: '14:00' }, { label: 'เช้า', from: '08:00', to: '09:30' }, { label: 'เย็น', short: 'ย', from: '17:00', to: '18:00' }],
                   scales: { fridge: { min: 1, max: 10, step: 0.5 } }, autoExpand: false, orient: 'h' });
  eq(r.settings.slots.map(x => x.label), ['เช้า', 'บ่าย', 'เย็น'], 'เรียงตามเวลา');
  eq([r.settings.scales.fridge.min, r.settings.scales.room.max, r.settings.autoExpand, r.settings.orient], [1, 35, false, 'h']);
  const staff = addUser(fakes, G, 'staff5@x.com', '05 เมืองใหม่นายอาม', 'approved');
  G.resetTableCache();
  eq(G.route({ action: 'overview', session: staff }).chart.slots.length, 3);
  throwsCode(() => G.route({ action: 'saveChartSettings', session: staff, settings: {} }), 'forbidden');
  // ค่าที่เสียใน Script Property → ใช้ค่าเริ่มต้น
  fakes.state.props.CHART_SETTINGS = '{"slots":[{"from":"x"}]}';
  eq(G.chartSettings().slots.length, 2);
});

test('รายงานกำหนดช่วงวันที่: ข้ามเดือนได้ ไม่เกิน 93 วัน', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  const sess = G.startSession({ email: 'goodyearzph@gmail.com', name: 'A' }).session;
  const r = G.route({ action: 'monthly', session: sess, branch: '05 เมืองใหม่นายอาม', from: '2026-09-28', to: '2026-10-03' });
  eq(r.dates, ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
  eq(r.month, '');
  throwsCode(() => G.route({ action: 'monthly', session: sess, branch: '05 x', from: '2026-01-01', to: '2026-05-01' }), 'invalid');
  throwsCode(() => G.route({ action: 'monthly', session: sess, branch: '05 x', from: '2026-03-02', to: '2026-03-01' }), 'invalid');
  eq(G.route({ action: 'monthly', session: sess, branch: '05 x', month: '2026-02' }).dates.length, 28);
});

const GSET = { slots: [{ label: 'เช้า', short: 'ช', from: '08:00', to: '09:30' }, { label: 'บ่าย', short: 'บ', from: '13:00', to: '14:00' }] };
const FEB = Array.from({ length: 28 }, (_, i) => '2026-02-' + String(i + 1).padStart(2, '0'));

test('กราฟตาราง (X = อุณหภูมิ): วันละ N แถวตามรอบ, จุดอยู่ช่องที่ถูก และสีนอกเกณฑ์', () => {
  const { G } = fresh();
  const html = G.gridChartHtml({
    settings: GSET, zoneType: 'fridge', limits: { tMin: 2, tMax: 8, hMax: null }, dates: FEB, today: '2026-02-10',
    values: { '2026-02-03': [{ t: 5.2, ts: 1 }, { t: 9.4, ts: 2 }] }, fmtTime: ms => (ms === 1 ? '08:00' : '13:00'), showHum: false, orient: 'h',
  });
  eq(html.match(/<tr/g).length, 2 + 28 * 2, 'หัว 2 แถว + 28 วัน × 2 รอบ');
  eq((html.match(/class="pt/g) || []).length, 2);
  eq((html.match(/class="pt bad"/g) || []).length, 1, 'ค่า 9.4 นอกเกณฑ์');
  ok(/>08:00</.test(html) && />13:00</.test(html) && /เกณฑ์ 2–8°C/.test(html));
  const row3 = html.split('<tr').find(r => r.includes('rowspan="2">3<'));
  eq(row3.split('<td').slice(3).findIndex(c => c.includes('●')), 10, '0–12°C ทีละ 0.5 → 5.2 อยู่ช่อง 5.0');
  ok(/class="x"/.test(html), 'วันหลังวันนี้เป็นช่องว่าง');
  // 3 รอบ + สเกลกำหนดเอง ไม่ขยายอัตโนมัติ
  const three = { slots: GSET.slots.concat([{ label: 'เย็น', short: 'ย', from: '17:00', to: '18:00' }]), scales: { room: { min: 22, max: 30, step: 2 } }, autoExpand: false };
  const room = G.gridChartHtml({ settings: three, zoneType: 'room', limits: { tMax: 30, tWarn: 25, hMax: 70 }, dates: ['2026-02-01'], values: { '2026-02-01': [{ t: 26, h: 75 }, null, { t: 33 }] }, showHum: true, orient: 'h' });
  eq(room.match(/<tr/g).length, 2 + 3);
  ok(/rowspan="3"/.test(room) && /ความชื้น \(%RH\) · ไม่เกิน 70%/.test(room) && /pt hm/.test(room));
  eq((room.split('<tr')[2].match(/<th/g) || []).length, 5 + 9, 'อุณหภูมิ 22–30 ทีละ 2 = 5 ช่อง + ความชื้น 20–100 ทีละ 10 = 9 ช่อง');
});

test('กราฟเส้น (X = วันที่, ค่าเริ่มต้น): แกนซ้ายอุณหภูมิ แกนขวาความชื้น แยกสี ลากเส้นต่อจุด', () => {
  const { G } = fresh();
  eq(G.DEFAULT_CHART_SETTINGS.orient, 'v');
  const html = G.gridChartHtml({
    settings: GSET, zoneType: 'fridge', limits: { tMin: 2, tMax: 8 }, dates: FEB, today: '2026-02-10',
    values: {
      '2026-02-03': [{ t: 5.2, h: 50, ts: 1 }, { t: 9.4, h: 55, ts: 2 }],
      '2026-02-04': [{ t: 6.0, h: 52 }, null],
      '2026-02-06': [{ t: 4.0 }, { t: 4.5 }],
    },
    fmtTime: ms => (ms === 1 ? '08:00' : '13:00'),
  });
  ok(/<svg class="gc-svg"/.test(html), 'เป็นกราฟ SVG');
  const tPath = /class="ln-t" d="([^"]+)"/.exec(html)[1];
  const hPath = /class="ln-h" d="([^"]+)"/.exec(html)[1];
  eq((tPath.match(/M/g) || []).length, 2, 'ขาดเส้นเมื่อไม่มีค่า');
  eq((tPath.match(/L/g) || []).length, 3);
  eq((hPath.match(/[ML]/g) || []).length, 3, 'ความชื้น 3 จุด');
  ok(/stroke="#0b8541"/.test(html) && /stroke="#1d5fbf"/.test(html), 'แยกสีอุณหภูมิ/ความชื้น');
  eq((html.match(/class="pt-t bad"/g) || []).length, 1, 'ค่า 9.4 เป็นจุดแดง');
  const pts = [...tPath.matchAll(/[ML]([0-9.]+) ([0-9.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  ok(pts[0][1] < pts[3][1] && pts[1][0] > pts[0][0]);
  eq((html.match(/font-weight="700" text-anchor="middle"/g) || []).length, 28, 'หัววันที่ 28 วัน');
  ok(/>13:00</.test(html) && /class="v bad">9\.4</.test(html), 'ตารางค่าใต้กราฟ');
  const noHum = G.gridChartHtml({ settings: GSET, zoneType: 'room', limits: { tMax: 30 }, dates: ['2026-02-01'], values: { '2026-02-01': [{ t: 26 }] } });
  ok(!/ln-h/.test(noHum) && !/แกนขวา/.test(noHum), 'ไม่มีข้อมูลความชื้น = ไม่แสดงแกนขวา');
  // ข้ามเดือน: วันแรก/วันที่ 1 แสดงเดือนกำกับ
  const cross = G.gridChartHtml({ settings: GSET, zoneType: 'room', limits: {}, dates: ['2026-01-31', '2026-02-01'], values: {} });
  ok(/>31\/1</.test(cross) && />1\/2</.test(cross));
});

test('รายงานเดือน: สร้าง PDF ในโฟลเดอร์เดือน มีตารางรายวันและเหตุการณ์', () => {
  const { fakes, G } = fresh();
  seed(G, fakes);
  const day0 = Date.UTC(2026, 8, 30, 17, 0);   // 1 ต.ค. ไทย
  for (let d = 0; d < 3; d++) {
    force(fakes, d === 1 ? { 'mock-fridge-1': 9.9 } : {});
    for (let i = 0; i < 4; i++) G.runPoll(day0 + d * 86400000 + 9 * 3600000 + i * 3 * 3600000, { silent: true });
  }
  G.runPoll(day0 + 3 * 86400000 + 9 * 3600000, { silent: true });
  G.resetTableCache();
  const ex = G.readTable('excursions').rows[0];
  const sess = G.startSession({ email: 'goodyearzph@gmail.com', name: 'A' }).session;
  G.route({ action: 'ackExcursion', session: sess, id: ex.id, correctiveAction: 'เรียกช่างซ่อมตู้เย็น' });
  G.resetTableCache();
  const m = G.route({ action: 'monthly', session: sess, branch: '05 เมืองใหม่นายอาม', month: '2026-10' });
  eq(m.days.filter(d => d.sensorId === '05-01' && !d.partial).length, 3);
  const r = G.buildMonthlyReport('05 เมืองใหม่นายอาม', '2026-10');
  ok(/GPP-Temp_05_2026-10\.pdf/.test(r.name) && /drive\.google\.com/.test(r.url));
  const file = Object.values(fakes.state.files).find(f => f.name === r.name);
  ok(/บันทึกการควบคุมอุณหภูมิ/.test(file.content) && /เรียกช่างซ่อมตู้เย็น/.test(file.content) && /ตุลาคม 2569/.test(file.content));
  ok(/ผิดเกณฑ์/.test(file.content));
  ok(/class="gc-svg"/.test(file.content) && /class="ln-t"/.test(file.content) && /เช้า 08:00–09:30/.test(file.content) && /size:A4 landscape/.test(file.content), 'มีกราฟเส้นในรายงานแนวนอน');
  G.buildMonthlyReport('05 เมืองใหม่นายอาม', '2026-10', 'h');
  const f2 = Object.values(fakes.state.files).find(f => f.name === r.name && !f.trashed);
  ok(/class="gc"/.test(f2.content) && !/class="gc-svg"/.test(f2.content) && /size:A4 portrait/.test(f2.content), 'แบบเดิมแนวตั้ง');
  G.buildMonthlyReport('05 เมืองใหม่นายอาม', '2026-10');   // สร้างซ้ำ → ไฟล์เก่าถูกย้ายไปถังขยะ
  eq(Object.values(fakes.state.files).filter(f => f.name === r.name && !f.trashed).length, 1);
  const rr = G.route({ action: 'buildReport', session: sess, branch: '05 เมืองใหม่นายอาม', from: '2026-10-01', to: '2026-10-02' });
  ok(/GPP-Temp_05_2026-10-01_2026-10-02\.pdf/.test(rr.name), rr.name);
  const f3 = Object.values(fakes.state.files).find(f => f.name === rr.name);
  ok(/ช่วงวันที่ <b>1 ต\.ค\. 2569 – 2 ต\.ค\. 2569/.test(f3.content), 'หัวรายงานแบบช่วงวันที่');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
