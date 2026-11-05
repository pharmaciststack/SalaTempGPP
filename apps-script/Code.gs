// =====================================================
// ระบบติดตามอุณหภูมิร้านยาตาม GPP (Sala-TempGPP) — Google Apps Script Backend
// วางไฟล์ .gs ทั้งหมดในโฟลเดอร์ apps-script/ ลงใน Extensions > Apps Script ของ Google Sheet หลัก
// แล้วรันฟังก์ชัน setup() หนึ่งครั้ง (สร้างชีต + ตั้ง trigger) จากนั้น
// Deploy > New deployment > Web app · Execute as: Me · Who has access: Anyone
// ไฟล์: Code.gs (API/สิทธิ์) · Store.gs (ชีต) · Providers.gs (SwitchBot/Tuya/Mock)
//       Poller.gs (ดึงค่าทุกรอบ) · Alerts.gs (เกณฑ์ + LINE) · Reports.gs (สรุปรายวัน/รายงานเดือน)
// =====================================================

const APP_VERSION = '0.1.0';
const TZ = 'Asia/Bangkok';

// ใช้ Client ID เดียวกับระบบแจ้งซ่อม/ลงทะเบียนอุปกรณ์ — ต้องเพิ่ม origin ของเว็บนี้ใน Google Cloud Console
const GOOGLE_CLIENT_ID   = '854838901494-cuhmkrl29oj80i12apt7no01k763r3o2.apps.googleusercontent.com';
const SUPER_ADMIN_EMAILS = ['pharmacist@salaosot.com', 'goodyearzph@gmail.com'];

const SESSION_SECONDS    = 6 * 60 * 60;   // อายุการเข้าสู่ระบบ (สูงสุด 6 ชม. ตามข้อจำกัด CacheService)
const USER_CACHE_SECONDS = 120;           // แคชสิทธิ์ผู้ใช้ — อนุมัติ/ถอดสิทธิ์มีผลภายใน 2 นาที
const USER_HEADERS = ['email', 'branch', 'registeredAt', 'role', 'status'];

// ── Entry points ──────────────────────────────────────
function doGet(e) {
  return json({ ok: true, app: 'sala-temp-gpp', version: APP_VERSION, time: new Date().toISOString() });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'bad_request' });
  }
  // LINE webhook (บอทถูกเชิญเข้ากลุ่ม / พิมพ์ #ลงทะเบียน ในกลุ่ม)
  if (body && Array.isArray(body.events) && body.destination) {
    try { handleLineWebhook(body); } catch (err) { console.error(err); }
    return json({ ok: true });
  }
  try {
    return json(route(body));
  } catch (err) {
    if (err && err.code) return json({ ok: false, error: err.code, message: err.message });
    console.error(err);
    return json({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  }
}

function route(body) {
  const action = body.action;
  if (action === 'ping')  return { ok: true, version: APP_VERSION };
  if (action === 'login') return login(body.idToken);

  const session = requireSession(body.session);
  if (action === 'logout') {
    CacheService.getScriptCache().remove('s:' + body.session);
    return { ok: true };
  }

  const info = getUserInfo(session.email);
  if (action === 'me')           return { ok: true, user: publicUser(session, info) };
  if (action === 'registerUser') return registerUser(session, info, body.branch);

  if (!info.isSuper && (!info.registered || info.status !== 'approved')) throw fail('not_approved', 'บัญชียังไม่ได้รับการอนุมัติ');

  switch (action) {
    case 'overview':     return overview(info);
    case 'history':      return sensorHistory(info, body);
    case 'monthly':      return monthlyData(info, body);
    case 'excursions':   return listExcursions(info, body);
    case 'ackExcursion': return withLock(() => ackExcursion(session, info, body));
  }

  requireAdmin(info);
  switch (action) {
    case 'adminConfig':      return adminConfig();
    case 'discover':         return discoverDevices(body.accountId);
    case 'saveSensor':       return withLock(() => saveSensor(body.sensor || {}));
    case 'saveZone':         return withLock(() => saveZone(body.zone || {}));
    case 'saveChartSettings': return saveChartSettings(body.settings || {});
    case 'saveLineTarget':   return withLock(() => saveLineTarget(body.target || {}));
    case 'deleteLineTarget': return withLock(() => deleteLineTarget(body.groupId, body.branch));
    case 'lineTest':         return lineTest(body.branch);
    case 'lineQuota':        return { ok: true, quota: lineQuota() };
    case 'pollNow':          return runPoll(Date.now());
    case 'dailySummary':     return sendDailySummary(Date.now(), body.date);
    case 'buildReport':      return buildReport(body);
    case 'alertLog':         return { ok: true, log: readTable('alertLog').rows.slice(-Math.min(Number(body.limit) || 50, 200)).reverse().map(publicLog) };
  }
  throw fail('unknown_action', 'ไม่รู้จักคำสั่ง: ' + action);
}

// ── ขอบเขตสาขา ────────────────────────────────────────
// แอดมินเห็นทุกสาขา · พนักงานเห็นเฉพาะสาขาที่ลงทะเบียนไว้ในชีต Users (เทียบจากเลขสาขา 2 หลัก)
function branchCode(b) {
  const m = /^\s*(\d{1,2})(?!\d)/.exec(String(b || ''));
  return m ? ('0' + m[1]).slice(-2) : '';
}

function scopeOf(info) {
  return info.isAdmin ? null : branchCode(info.branch);   // null = ทุกสาขา, '' = ไม่มีสาขา (เห็นอะไรไม่ได้)
}

function inScope(info, branch) {
  const s = scopeOf(info);
  return s === null || (!!s && branchCode(branch) === s);
}

function requireScope(info, branch) {
  if (!inScope(info, branch)) throw fail('forbidden', 'ดูได้เฉพาะข้อมูลสาขาของคุณ');
}

// ── Auth (เหมือนระบบลงทะเบียนอุปกรณ์) ────────────────
function verifyGoogleToken(idToken) {
  if (!idToken) throw fail('unauthorized', 'Missing token');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw fail('unauthorized', 'Invalid token');
  const p = JSON.parse(res.getContentText());
  if (p.aud !== GOOGLE_CLIENT_ID) throw fail('unauthorized', 'Wrong audience');
  if (p.iss !== 'accounts.google.com' && p.iss !== 'https://accounts.google.com') throw fail('unauthorized', 'Wrong issuer');
  if (String(p.email_verified) !== 'true') throw fail('unauthorized', 'Email not verified');
  if (Number(p.exp) * 1000 < Date.now()) throw fail('unauthorized', 'Token expired');
  return { email: String(p.email).toLowerCase(), name: p.name || p.email, picture: p.picture || '' };
}

function login(idToken) {
  const profile = verifyGoogleToken(idToken);
  return startSession(profile);
}

function startSession(profile) {
  const session = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('s:' + session, JSON.stringify(profile), SESSION_SECONDS);
  const info = getUserInfo(profile.email);
  return { ok: true, session, expiresAt: Date.now() + SESSION_SECONDS * 1000, user: publicUser(profile, info) };
}

function requireSession(session) {
  if (!session) throw fail('unauthorized', 'กรุณาเข้าสู่ระบบ');
  const raw = CacheService.getScriptCache().get('s:' + session);
  if (!raw) throw fail('unauthorized', 'หมดเวลาการเข้าสู่ระบบ');
  return JSON.parse(raw);
}

function requireAdmin(info) {
  if (!info.isAdmin) throw fail('forbidden', 'เฉพาะแอดมินเท่านั้น');
}

function isSuperAdmin(email) {
  return SUPER_ADMIN_EMAILS.map(lower).indexOf(lower(email)) !== -1;
}

function getUserInfo(email) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('u:' + email);
  if (hit) return JSON.parse(hit);

  const ss = mainSS();
  const isSuper = isSuperAdmin(email);
  const userRow = getOrCreateSheet(ss, 'Users', USER_HEADERS)
    .getDataRange().getValues().slice(1)
    .find(r => lower(r[0]) === email);
  const inAdminList = getOrCreateSheet(ss, 'AdminEmails', ['email', 'addedAt'])
    .getDataRange().getValues().slice(1)
    .some(r => lower(r[0]) === email);

  const info = {
    registered: !!userRow || isSuper,
    status: isSuper || (userRow && String(userRow[4]).trim() === 'approved') ? 'approved' : 'pending',
    branch: userRow ? String(userRow[1] || '') : '',
    isAdmin: isSuper || inAdminList,
    isSuper,
  };
  cache.put('u:' + email, JSON.stringify(info), USER_CACHE_SECONDS);
  return info;
}

function publicUser(profile, info) {
  return {
    email: profile.email, name: profile.name, picture: profile.picture,
    registered: info.registered, status: info.status, branch: info.branch,
    role: info.isAdmin ? 'admin' : 'staff', isSuper: info.isSuper,
  };
}

function registerUser(session, info, branch) {
  branch = cleanText(branch, 80);
  if (!branch) throw fail('invalid', 'กรุณาระบุสาขา');
  if (!info.registered) {
    const sh = getOrCreateSheet(mainSS(), 'Users', USER_HEADERS);
    sh.appendRow([session.email, branch, new Date().toISOString(), 'user', isSuperAdmin(session.email) ? 'approved' : 'pending']);
    CacheService.getScriptCache().remove('u:' + session.email);
  }
  return { ok: true, user: publicUser(session, getUserInfo(session.email)) };
}

// ── หน้าภาพรวม ────────────────────────────────────────
function overview(info) {
  const zones = zoneMap();
  const today = dayKey(Date.now());
  const sensors = readTable('sensors').rows
    .filter(s => truthy(s.active) && inScope(info, s.branch))
    .map(s => publicSensor(s, zones, today));
  const excursions = readTable('excursions').rows
    .filter(e => inScope(info, e.branch) && (e.status === 'open' || !toMs(e.ackAt)))
    .slice(-200).reverse().map(publicExc);
  const props = PropertiesService.getScriptProperties();
  return {
    ok: true, sensors, excursions, zones: Object.keys(zones).map(k => zones[k]),
    lastPollAt: Number(props.getProperty('LAST_POLL_AT')) || null,
    pollMinutes: pollMinutes(), serverTime: Date.now(), chart: chartSettings(),
  };
}

function publicSensor(s, zones, today) {
  const lim = effectiveLimits(s, zones);
  const isToday = dayKey(s.dayDate) === today;
  return {
    sensorId: str(s.sensorId), branch: str(s.branch), location: str(s.location), zoneType: str(s.zoneType),
    accountId: str(s.accountId), deviceId: str(s.deviceId), active: truthy(s.active), note: str(s.note),
    tMin: num(s.tMin), tWarn: num(s.tWarn), tMax: num(s.tMax), hMax: num(s.hMax), calOffset: num(s.calOffset),
    limits: lim,
    lastTs: toMs(s.lastTs), lastTemp: num(s.lastTemp), lastHum: num(s.lastHum), battery: num(s.battery),
    state: str(s.state) || 'pending', excId: str(s.excId), offExcId: str(s.offExcId),
    today: isToday && num(s.dayN) ? { min: num(s.dayMin), max: num(s.dayMax), avg: round1(num(s.daySum) / num(s.dayN)), n: num(s.dayN) } : null,
  };
}

function publicExc(e) {
  return {
    id: str(e.id), sensorId: str(e.sensorId), branch: str(e.branch), location: str(e.location), type: str(e.type),
    start: toMs(e.start), end: toMs(e.end), durationMin: num(e.durationMin),
    maxTemp: num(e.maxTemp), minTemp: num(e.minTemp), maxHum: num(e.maxHum),
    status: str(e.status), ackBy: str(e.ackBy), ackAt: toMs(e.ackAt),
    correctiveAction: str(e.correctiveAction), note: str(e.note),
  };
}

function publicLog(l) {
  return { ts: toMs(l.ts), channel: str(l.channel), target: str(l.target), branch: str(l.branch), result: str(l.result), message: str(l.message) };
}

// ── กราฟย้อนหลัง ─────────────────────────────────────
function sensorHistory(info, body) {
  const s = findSensor(body.sensorId);
  requireScope(info, s.branch);
  const hours = Math.max(1, Math.min(Number(body.hours) || 24, 24 * 31));
  const to = Date.now(), from = to - hours * 3600000;
  const points = readReadings(s.branch, from, to, str(s.sensorId)).map(r => [r.ts, r.temp, r.hum]);
  return { ok: true, sensorId: str(s.sensorId), from, to, points };
}

// ── ข้อมูลรายงาน (รายเดือน หรือกำหนดช่วงวันที่) ─────────
// body: { branch, month: 'yyyy-MM' } หรือ { branch, from, to: 'yyyy-MM-dd' } · settings (ไม่บังคับ) = ค่าตั้งกราฟที่ยังไม่บันทึก ใช้ดูตัวอย่าง
function monthlyData(info, body) {
  const branch = str(body.branch);
  requireScope(info, branch);
  const range = reportRange(body);
  let settings = chartSettings();
  if (body.settings) {
    try { settings = normalizeChartSettings(body.settings, true); } catch (e) { throw fail('invalid', e.message); }
  }
  return Object.assign({ ok: true }, collectRange(branch, range.from, range.to, settings), { month: range.month });
}

function reportRange(body) {
  const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(str(v));
  if (isDay(body.from) && isDay(body.to)) {
    const from = str(body.from), to = str(body.to);
    if (from > to) throw fail('invalid', 'วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด');
    if (dateRange(from, to).length > MAX_RANGE_DAYS) throw fail('invalid', 'เลือกช่วงได้ไม่เกิน ' + MAX_RANGE_DAYS + ' วัน');
    return { from, to, month: '' };
  }
  const month = /^\d{4}-\d{2}$/.test(str(body.month)) ? str(body.month) : monthKey(Date.now());
  return monthBounds(month);
}

function monthBounds(month) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  return { from: month + '-01', to: month + '-' + ('0' + new Date(y, m, 0).getDate()).slice(-2), month };
}

// ค่าตั้งกราฟ (Console ปรับกราฟ) — เก็บใน Script Property CHART_SETTINGS
function chartSettings() {
  let raw = null;
  try { raw = JSON.parse(PropertiesService.getScriptProperties().getProperty('CHART_SETTINGS') || 'null'); } catch (e) {}
  return normalizeChartSettings(raw, false);
}

function saveChartSettings(input) {
  let s;
  try { s = normalizeChartSettings(input, true); } catch (e) { throw fail('invalid', e.message); }
  PropertiesService.getScriptProperties().setProperty('CHART_SETTINGS', JSON.stringify(s));
  return { ok: true, settings: s };
}

// รายงานเดือนเดียว (ใช้กับ PDF และการทดสอบ)
function collectMonth(branch, month) {
  const r = monthBounds(month);
  return Object.assign(collectRange(branch, r.from, r.to, chartSettings()), { month });
}

// รวมข้อมูลของสาขาในช่วงวันที่ — ใช้ทั้งหน้าเว็บและรายงาน PDF
// ค่าแต่ละรอบเวลาคำนวณจากค่าดิบทุกครั้ง → เปลี่ยนรอบเวลาใน Console แล้วมีผลย้อนหลังทันที
function collectRange(branch, from, to, settings) {
  const code = branchCode(branch);
  const zones = zoneMap();
  const sensors = readTable('sensors').rows.filter(s => branchCode(s.branch) === code && str(s.sensorId))
    .map(s => publicSensor(s, zones, ''));
  const days = readTable('daily').rows
    .filter(d => branchCode(d.branch) === code && dayKey(d.date) >= from && dayKey(d.date) <= to)
    .map(d => ({
      date: dayKey(d.date), sensorId: str(d.sensorId), tMin: num(d.tMin), tMax: num(d.tMax), tAvg: num(d.tAvg),
      hMax: num(d.hMax), readings: num(d.readings), excursionMin: num(d.excursionMin), state: str(d.state),
    }));
  // วันนี้ยังไม่ถูกบันทึกลง Daily — ใช้ค่าสะสมระหว่างวันจากชีต Sensors
  const today = dayKey(Date.now());
  if (today >= from && today <= to) {
    readTable('sensors').rows.forEach(s => {
      if (branchCode(s.branch) !== code || dayKey(s.dayDate) !== today || !num(s.dayN)) return;
      days.push(dailyRowFromSensor(s, true));
    });
  }
  const fromMs = dayStartMs(from), toMs2 = dayStartMs(to) + 86400000 - 1;
  const excursions = readTable('excursions').rows
    .filter(e => branchCode(e.branch) === code && toMs(e.start) >= fromMs && toMs(e.start) <= toMs2)
    .map(publicExc);
  const values = computeSlotValues(readReadings(branch, fromMs, toMs2), settings, dayKey, localMinutes);
  return { branch, from, to, month: '', dates: dateRange(from, to), today, sensors, days, excursions, values, settings };
}

// ── Excursions ────────────────────────────────────────
function listExcursions(info, body) {
  const month = str(body.month);
  const rows = readTable('excursions').rows.filter(e => {
    if (!inScope(info, e.branch)) return false;
    if (body.branch && branchCode(e.branch) !== branchCode(body.branch)) return false;
    if (body.pending) return e.status === 'open' || !toMs(e.ackAt);
    if (month) return monthKey(toMs(e.start)) === month;
    return true;
  });
  return { ok: true, excursions: rows.slice(-300).reverse().map(publicExc) };
}

function ackExcursion(session, info, body) {
  const action = cleanText(body.correctiveAction, 1000);
  if (action.length < 3) throw fail('invalid', 'กรุณาระบุการแก้ไข/การดำเนินการ');
  const t = readTable('excursions', true);
  const e = t.rows.find(r => str(r.id) === str(body.id));
  if (!e) throw fail('not_found', 'ไม่พบรายการ');
  requireScope(info, e.branch);
  e.correctiveAction = action;
  e.note = cleanText(body.note, 1000);
  e.ackBy = session.name ? session.name + ' <' + session.email + '>' : session.email;
  e.ackAt = Date.now();
  saveRow(t, e);
  return { ok: true, excursion: publicExc(e) };
}

// ── Admin ─────────────────────────────────────────────
function adminConfig() {
  const props = PropertiesService.getScriptProperties();
  const zones = zoneMap();
  return {
    ok: true,
    version: APP_VERSION,
    accounts: readTable('accounts').rows.map(a => ({
      accountId: str(a.accountId), provider: str(a.provider), label: str(a.label), active: truthy(a.active),
      minIntervalMin: num(a.minIntervalMin), lastPollAt: toMs(a.lastPollAt), lastError: str(a.lastError),
      hasCredential: str(a.provider) === 'mock' || !!props.getProperty('CRED_' + str(a.accountId)),
    })),
    sensors: readTable('sensors').rows.filter(s => str(s.sensorId)).map(s => publicSensor(s, zones, dayKey(Date.now()))),
    zones: Object.keys(zones).map(k => zones[k]),
    lineTargets: readTable('lineTargets').rows.map(l => ({ branch: str(l.branch), groupId: str(l.groupId), label: str(l.label), active: truthy(l.active) })),
    linePending: readTable('linePending').rows.slice(-30).reverse().map(p => ({ ts: toMs(p.ts), groupId: str(p.groupId), type: str(p.type), text: str(p.text) })),
    lineReady: !!props.getProperty('LINE_CHANNEL_TOKEN'),
    alertEmails: str(props.getProperty('ALERT_EMAILS')),
    pollMinutes: pollMinutes(),
    lastPollAt: Number(props.getProperty('LAST_POLL_AT')) || null,
    triggers: ScriptApp.getProjectTriggers().map(tr => tr.getHandlerFunction()),
  };
}

function discoverDevices(accountId) {
  const acc = readTable('accounts').rows.find(a => str(a.accountId) === str(accountId));
  if (!acc) throw fail('not_found', 'ไม่พบบัญชี ' + accountId);
  const mapped = {};
  readTable('sensors').rows.forEach(s => { if (str(s.accountId) === str(accountId)) mapped[str(s.deviceId)] = str(s.sensorId); });
  const devices = providerFor(acc).list(acc).map(d => Object.assign(d, { sensorId: mapped[d.deviceId] || '' }));
  return { ok: true, accountId: str(accountId), devices };
}

const SENSOR_EDITABLE = ['accountId', 'deviceId', 'branch', 'location', 'zoneType', 'tMin', 'tWarn', 'tMax', 'hMax', 'calOffset', 'active', 'note'];

function saveSensor(input) {
  const t = readTable('sensors', true);
  let s = input.sensorId ? t.rows.find(r => str(r.sensorId) === str(input.sensorId)) : null;
  if (input.sensorId && !s) throw fail('not_found', 'ไม่พบเซ็นเซอร์ ' + input.sensorId);
  const branch = cleanText(input.branch != null ? input.branch : s && s.branch, 80);
  if (!branchCode(branch)) throw fail('invalid', 'กรุณาเลือกสาขา');
  if (!cleanText(input.location != null ? input.location : s && s.location, 80)) throw fail('invalid', 'กรุณาระบุจุดติดตั้ง');
  const zone = cleanText(input.zoneType != null ? input.zoneType : s && s.zoneType, 30);
  if (!zoneMap()[zone]) throw fail('invalid', 'ไม่รู้จักประเภทพื้นที่: ' + zone);
  const dev = cleanText(input.deviceId != null ? input.deviceId : s && s.deviceId, 80);
  const acc = cleanText(input.accountId != null ? input.accountId : s && s.accountId, 40);
  const dup = t.rows.find(r => r !== s && str(r.accountId) === acc && str(r.deviceId) === dev && dev);
  if (dup) throw fail('duplicate', 'อุปกรณ์นี้ผูกกับ ' + str(dup.sensorId) + ' อยู่แล้ว');

  const isNew = !s;
  if (isNew) {
    s = { sensorId: nextSensorId(t.rows, branch), state: 'pending', active: true };
  }
  SENSOR_EDITABLE.forEach(k => {
    if (input[k] === undefined) return;
    if (['tMin', 'tWarn', 'tMax', 'hMax', 'calOffset'].indexOf(k) !== -1) s[k] = input[k] === '' || input[k] === null ? '' : Number(input[k]);
    else if (k === 'active') s[k] = !!input[k];
    else s[k] = cleanText(input[k], 200);
  });
  if (!truthy(s.active)) { s.state = 'inactive'; }
  else if (str(s.state) === 'inactive') { s.state = 'pending'; }
  if (isNew) appendRows(t, [s]); else saveRow(t, s);
  return { ok: true, sensor: publicSensor(s, zoneMap(), dayKey(Date.now())) };
}

function nextSensorId(rows, branch) {
  const code = branchCode(branch);
  let n = 0;
  rows.forEach(r => {
    const m = new RegExp('^' + code + '-(\\d+)$').exec(str(r.sensorId));
    if (m) n = Math.max(n, Number(m[1]));
  });
  return code + '-' + ('0' + (n + 1)).slice(-2);
}

function saveZone(input) {
  const t = readTable('zones', true);
  const z = t.rows.find(r => str(r.zoneType) === str(input.zoneType));
  if (!z) throw fail('not_found', 'ไม่พบประเภทพื้นที่');
  ['tMin', 'tWarn', 'tMax', 'hMax', 'confirmReadings', 'offlineMinutes', 'realertMinutes'].forEach(k => {
    if (input[k] === undefined) return;
    z[k] = input[k] === '' || input[k] === null ? '' : Number(input[k]);
  });
  if (input.label !== undefined) z.label = cleanText(input.label, 60);
  if (!(num(z.confirmReadings) >= 1)) z.confirmReadings = 1;
  if (!(num(z.offlineMinutes) >= 10)) z.offlineMinutes = 30;
  if (!(num(z.realertMinutes) >= 15)) z.realertMinutes = 60;
  saveRow(t, z);
  return { ok: true };
}

function saveLineTarget(input) {
  const groupId = cleanText(input.groupId, 80);
  const branch = cleanText(input.branch, 80);
  if (!/^[CUR][0-9a-f]{32}$/.test(groupId)) throw fail('invalid', 'groupId ไม่ถูกต้อง (ขึ้นต้นด้วย C/U/R ตามด้วย 32 ตัวอักษร)');
  if (branch !== '*' && !branchCode(branch)) throw fail('invalid', 'กรุณาเลือกสาขา หรือ * สำหรับกลุ่มส่วนกลาง');
  const t = readTable('lineTargets', true);
  let row = t.rows.find(r => str(r.groupId) === groupId && str(r.branch) === branch);
  const isNew = !row;
  row = row || { groupId, branch };
  row.label = cleanText(input.label, 80);
  row.active = input.active === undefined ? true : !!input.active;
  if (isNew) appendRows(t, [row]); else saveRow(t, row);
  return { ok: true };
}

function deleteLineTarget(groupId, branch) {
  const t = readTable('lineTargets', true);
  const row = t.rows.find(r => str(r.groupId) === str(groupId) && str(r.branch) === str(branch));
  if (!row) throw fail('not_found', 'ไม่พบรายการ');
  deleteRow(t, row);
  return { ok: true };
}

// ── Helpers ───────────────────────────────────────────
function findSensor(id) {
  const s = readTable('sensors').rows.find(r => str(r.sensorId) === str(id));
  if (!s) throw fail('not_found', 'ไม่พบเซ็นเซอร์ ' + id);
  return s;
}

function pollMinutes() {
  const v = Number(PropertiesService.getScriptProperties().getProperty('POLL_MINUTES'));
  return [5, 10, 15, 30].indexOf(v) !== -1 ? v : 15;
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw fail('busy', 'ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองใหม่');
  try { resetTableCache(); return fn(); } finally { lock.releaseLock(); }
}

function cleanText(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function lower(v) { return String(v || '').toLowerCase().trim(); }
function str(v) { return v == null ? '' : String(v).trim(); }
function truthy(v) { return v === true || /^(true|1|yes|y|ใช่)$/i.test(str(v)); }
function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function round1(n) { return n == null || !isFinite(n) ? null : Math.round(n * 10) / 10; }

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
