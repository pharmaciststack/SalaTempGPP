// =====================================================
// Store.gs — โครงชีต + ตัวช่วยอ่าน/เขียนแบบตาราง + เก็บค่าดิบรายเดือน
// =====================================================

const SCHEMA = {
  accounts:    ['accountId', 'provider', 'label', 'active', 'minIntervalMin', 'lastPollAt', 'lastError', 'note'],
  sensors:     ['sensorId', 'accountId', 'deviceId', 'branch', 'location', 'zoneType', 'tMin', 'tWarn', 'tMax', 'hMax', 'calOffset', 'active', 'note',
                'lastTs', 'lastTemp', 'lastHum', 'battery', 'state', 'badCount', 'badSince', 'excId', 'offExcId', 'lastAlertAt',
                'peakMax', 'peakMin', 'peakHum',
                'dayDate', 'dayMin', 'dayMax', 'daySum', 'dayN', 'dayHMax', 'dayExcMin', 'dayWorst'],
  zones:       ['zoneType', 'label', 'tMin', 'tWarn', 'tMax', 'hMax', 'confirmReadings', 'offlineMinutes', 'realertMinutes'],
  excursions:  ['id', 'sensorId', 'branch', 'location', 'type', 'start', 'end', 'durationMin', 'maxTemp', 'minTemp', 'maxHum',
                'status', 'ackBy', 'ackAt', 'correctiveAction', 'note'],
  daily:       ['date', 'sensorId', 'branch', 'location', 'zoneType', 'tMin', 'tMax', 'tAvg', 'hMax', 'readings', 'excursionMin', 'state'],
  alertLog:    ['ts', 'channel', 'target', 'branch', 'result', 'message'],
  lineTargets: ['branch', 'groupId', 'label', 'active'],
  linePending: ['ts', 'groupId', 'type', 'text'],
};

// ชื่อชีตจริงใน Google Sheet
const SHEET_NAMES = {
  accounts: 'Accounts', sensors: 'Sensors', zones: 'ZoneDefaults', excursions: 'Excursions', daily: 'Daily',
  alertLog: 'AlertLog', lineTargets: 'LineTargets', linePending: 'LinePending',
};

// ค่าเริ่มต้นตามหลัก GPP — แก้ได้ที่ชีต ZoneDefaults หรือหน้า ตั้งค่า (และกำหนดรายจุดได้ที่ชีต Sensors)
// ความชื้นเกิน hMax = "เฝ้าระวัง" (สีเหลือง + อยู่ในสรุปรายวัน) ไม่เปิดเป็นเหตุการณ์ผิดเกณฑ์
const DEFAULT_ZONES = [
  { zoneType: 'room',   label: 'ห้องเก็บ/ขายยา', tMin: '', tWarn: 25, tMax: 30, hMax: 70, confirmReadings: 2, offlineMinutes: 30, realertMinutes: 60 },
  { zoneType: 'fridge', label: 'ตู้เย็นเก็บยา',  tMin: 2,  tWarn: '', tMax: 8,  hMax: '', confirmReadings: 2, offlineMinutes: 30, realertMinutes: 60 },
];

const DATE_COLS = { lastTs: 1, badSince: 1, lastAlertAt: 1, start: 1, end: 1, ackAt: 1, ts: 1, lastPollAt: 1 };
const TEXT_COLS = { sensorId: 1, deviceId: 1, groupId: 1, accountId: 1, id: 1 };

const DATA_FOLDER = 'SalaTemp_Data';       // โฟลเดอร์ Drive เก็บไฟล์ค่าดิบรายเดือน
const REPORT_FOLDER = 'SalaTemp_Reports';  // โฟลเดอร์ Drive เก็บรายงาน PDF
const READING_HEADERS = ['ts', 'sensorId', 'temp', 'hum', 'battery'];

let _TABLES = {};
function resetTableCache() { _TABLES = {}; }

function mainSS() {
  const id = PropertiesService.getScriptProperties().getProperty('MAIN_SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

// อ่านทั้งชีตเป็น object ตามหัวคอลัมน์ (เพิ่มคอลัมน์ที่ขาดให้อัตโนมัติ) — แคชไว้ภายในการเรียกครั้งเดียว
function readTable(name, fresh) {
  if (_TABLES[name] && !fresh) return _TABLES[name];
  const sh = getOrCreateSheet(mainSS(), SHEET_NAMES[name], SCHEMA[name]);
  let values = sh.getDataRange().getValues();
  let head = values[0].map(h => String(h).trim());
  if (head.length === 1 && !head[0]) { head = []; }
  const missing = SCHEMA[name].filter(h => head.indexOf(h) === -1);
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    head = head.concat(missing);
  }
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (r.every(v => v === '' || v === null)) continue;
    const o = { _row: i + 1 };
    head.forEach((h, j) => { o[h] = j < r.length ? r[j] : ''; });
    rows.push(o);
  }
  return (_TABLES[name] = { name, sh, head, rows });
}

function toCells(t, o) {
  return t.head.map(h => {
    let v = o[h];
    if (v === undefined || v === null) return '';
    if (DATE_COLS[h] && typeof v === 'number') return new Date(v);
    if (TEXT_COLS[h] && v !== '') return "'" + String(v);
    if (typeof v === 'number' && !isFinite(v)) return '';
    return v;
  });
}

function saveRow(t, o) {
  t.sh.getRange(o._row, 1, 1, t.head.length).setValues([toCells(t, o)]);
}

// เขียนทุกแถวของตารางกลับในครั้งเดียว (ใช้กับชีต Sensors/Accounts ทุกรอบดึงค่า)
function saveAll(t) {
  if (!t.rows.length) return;
  const maxRow = t.rows.reduce((m, r) => Math.max(m, r._row), 1);
  const blank = t.head.map(() => '');
  const byRow = {};
  t.rows.forEach(r => { byRow[r._row] = r; });
  const grid = [];
  for (let n = 2; n <= maxRow; n++) grid.push(byRow[n] ? toCells(t, byRow[n]) : blank.slice());
  t.sh.getRange(2, 1, grid.length, t.head.length).setValues(grid);
}

function appendRows(t, objs) {
  if (!objs.length) return;
  const start = t.sh.getLastRow() + 1;
  objs.forEach((o, i) => { o._row = start + i; t.rows.push(o); });
  t.sh.getRange(start, 1, objs.length, t.head.length).setValues(objs.map(o => toCells(t, o)));
}

function deleteRow(t, o) {
  t.sh.deleteRows(o._row, 1);
  t.rows = t.rows.filter(r => r !== o);
  t.rows.forEach(r => { if (r._row > o._row) r._row--; });
}

// ── ค่าเวลา ───────────────────────────────────────────
function toMs(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? null : v.getTime();
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim();
  if (/^\d{10,}$/.test(s)) return Number(s);
  const p = Date.parse(s);
  return isNaN(p) ? null : p;
}

// วันที่แบบ yyyy-MM-dd ตามเวลาไทย (รับ Date / ms / ข้อความ)
function dayKey(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
  const ms = toMs(v);
  return ms == null ? '' : Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd');
}

function monthKey(ms) {
  return ms == null ? '' : Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM');
}

// เวลาเริ่มต้นของวัน 'yyyy-MM-dd' (เที่ยงคืนเวลาไทย) เป็น ms
function dayStartMs(day) {
  return Utilities.parseDate(day, TZ, 'yyyy-MM-dd').getTime();
}

// นาทีนับจากเที่ยงคืนตามเวลาไทย
function localMinutes(ms) {
  const p = Utilities.formatDate(new Date(ms), TZ, 'H:mm').split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

// ── เกณฑ์ ─────────────────────────────────────────────
function zoneMap() {
  const out = {};
  readTable('zones').rows.forEach(z => {
    const k = str(z.zoneType);
    if (!k) return;
    out[k] = {
      zoneType: k, label: str(z.label) || k,
      tMin: num(z.tMin), tWarn: num(z.tWarn), tMax: num(z.tMax), hMax: num(z.hMax),
      confirmReadings: Math.max(1, num(z.confirmReadings) || 2),
      offlineMinutes: Math.max(10, num(z.offlineMinutes) || 30),
      realertMinutes: Math.max(15, num(z.realertMinutes) || 60),
    };
  });
  return out;
}

// ค่าที่กำหนดรายจุด (ชีต Sensors) มาก่อนค่าของประเภทพื้นที่
function effectiveLimits(s, zones) {
  const z = zones[str(s.zoneType)] || { tMin: null, tWarn: null, tMax: null, hMax: null, confirmReadings: 2, offlineMinutes: 30, realertMinutes: 60, label: str(s.zoneType) };
  const pick = k => (num(s[k]) != null ? num(s[k]) : z[k]);
  return {
    zoneLabel: z.label,
    tMin: pick('tMin'), tWarn: pick('tWarn'), tMax: pick('tMax'), hMax: pick('hMax'),
    confirmReadings: z.confirmReadings, offlineMinutes: z.offlineMinutes, realertMinutes: z.realertMinutes,
  };
}

// ── ค่าดิบ: ไฟล์ Google Sheet ใหม่ทุกเดือน แยกแท็บตามสาขา ──
function readingsSpreadsheet(month, create) {
  const props = PropertiesService.getScriptProperties();
  const key = 'READINGS_' + month;
  const id = props.getProperty(key);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { console.warn('readings file missing', month, e); }
  }
  if (!create) return null;
  const ss = SpreadsheetApp.create('SalaTemp_Readings_' + month);
  try { DriveApp.getFileById(ss.getId()).moveTo(driveFolder(DATA_FOLDER)); } catch (e) { console.warn('moveTo', e); }
  props.setProperty(key, ss.getId());
  return ss;
}

function appendReadings(list) {
  const groups = {};
  list.forEach(r => {
    const k = monthKey(r.ts) + '|' + branchCode(r.branch);
    (groups[k] = groups[k] || []).push(r);
  });
  Object.keys(groups).forEach(k => {
    const parts = k.split('|');
    const ss = readingsSpreadsheet(parts[0], true);
    const sh = getOrCreateSheet(ss, parts[1], READING_HEADERS);
    const rows = groups[k].map(r => [new Date(r.ts), "'" + r.sensorId, r.temp, r.hum == null ? '' : r.hum, r.battery == null ? '' : r.battery]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, READING_HEADERS.length).setValues(rows);
  });
}

function readReadings(branch, from, to, sensorId) {
  const out = [];
  const code = branchCode(branch);
  const months = [];
  for (let m = monthKey(from); m <= monthKey(to);) {
    months.push(m);
    const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
    m = mo === 12 ? (y + 1) + '-01' : y + '-' + ('0' + (mo + 1)).slice(-2);
  }
  months.forEach(m => {
    const ss = readingsSpreadsheet(m, false);
    const sh = ss && ss.getSheetByName(code);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, READING_HEADERS.length).getValues().forEach(r => {
      const ts = toMs(r[0]);
      if (ts == null || ts < from || ts > to) return;
      if (sensorId && str(r[1]) !== sensorId) return;
      out.push({ ts, sensorId: str(r[1]), temp: num(r[2]), hum: num(r[3]), battery: num(r[4]) });
    });
  });
  return out.sort((a, b) => a.ts - b.ts);
}

function driveFolder(name, parent) {
  const it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

// สร้างชีตทั้งหมด + ค่าเกณฑ์เริ่มต้น (เรียกจาก setup())
function setupSheets() {
  resetTableCache();
  Object.keys(SCHEMA).forEach(name => readTable(name, true));
  const zones = readTable('zones', true);
  const have = zones.rows.map(z => str(z.zoneType));
  appendRows(zones, DEFAULT_ZONES.filter(z => have.indexOf(z.zoneType) === -1).map(z => Object.assign({}, z)));
  const accounts = readTable('accounts', true);
  if (!accounts.rows.length) {
    appendRows(accounts, [{ accountId: 'MOCK', provider: 'mock', label: 'เครื่องจำลอง (ทดสอบระบบ)', active: false, minIntervalMin: '', note: 'เปิด active เพื่อทดสอบโดยไม่ต้องมีเครื่องจริง' }]);
  }
  getOrCreateSheet(mainSS(), 'Users', USER_HEADERS);
  getOrCreateSheet(mainSS(), 'AdminEmails', ['email', 'addedAt']);
}
