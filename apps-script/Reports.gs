// =====================================================
// Reports.gs — สรุปรายวันทาง LINE (08:00) และรายงาน PDF รายเดือนสำหรับการตรวจ GPP (วันที่ 1 เวลา 07:00)
// =====================================================

const LOW_BATTERY = 15;

function dailySummaryTrigger() {
  try { sendDailySummary(Date.now()); } catch (err) { console.error('daily summary failed', err); }
}

function monthlyReportTrigger() {
  try { sendMonthlyReports(Date.now()); } catch (err) { console.error('monthly report failed', err); }
}

// บันทึกค่าสะสมของวันก่อนลง Daily (กรณียังไม่มีรอบดึงค่าหลังเที่ยงคืน)
function flushDays(now) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    resetTableCache();
    const t = readTable('sensors', true);
    const out = [];
    t.rows.forEach(s => {
      if (!truthy(s.active)) return;
      const row = rollDay(s, now);
      if (row) out.push(row);
    });
    if (out.length) {
      appendRows(readTable('daily'), out);
      saveAll(t);
    }
  } finally {
    lock.releaseLock();
  }
}

function dayLine(s, d, zones) {
  const name = str(s.location) || str(s.sensorId);
  if (!d || !num(d.readings)) return '⚪ ' + name + ': ไม่มีข้อมูล';
  const range = fmtTemp(num(d.tMin)) + ' – ' + fmtTemp(num(d.tMax));
  const st = str(d.state);
  if (num(d.excursionMin) || st === 'alarm') return '🔴 ' + name + ': ' + range + ' · ผิดเกณฑ์ ' + fmtDuration(num(d.excursionMin));
  if (st === 'warn') {
    const lim = effectiveLimits(s, zones);
    const why = lim.tWarn != null && num(d.tMax) > lim.tWarn ? 'เกิน ' + lim.tWarn + '°C' : 'ความชื้นสูงสุด ' + num(d.hMax) + '%';
    return '🟡 ' + name + ': ' + range + ' · เฝ้าระวัง (' + why + ')';
  }
  return '✅ ' + name + ': ' + range;
}

// สรุปของแต่ละสาขา → { lines, problem }
function branchSummary(branch, sensors, dailyRows, excRows, zones) {
  const lines = [];
  let problem = false;
  sensors.forEach(s => {
    const d = dailyRows.find(r => str(r.sensorId) === str(s.sensorId));
    const line = dayLine(s, d, zones);
    if (/^(🔴|⚪)/.test(line)) problem = true;   // 🟡 เฝ้าระวัง แสดงในกลุ่มสาขา แต่ไม่นับเป็นปัญหาของส่วนกลาง
    lines.push(line);
  });
  const pending = excRows.filter(e => e.status === 'open' || !toMs(e.ackAt));
  if (pending.length) { problem = true; lines.push('📝 รอบันทึกการแก้ไข ' + pending.length + ' รายการ'); }
  const off = sensors.filter(s => str(s.state) === 'offline');
  if (off.length) { problem = true; lines.push('⚪ ขาดการเชื่อมต่อขณะนี้: ' + off.map(s => str(s.location)).join(', ')); }
  const low = sensors.filter(s => num(s.battery) != null && num(s.battery) <= LOW_BATTERY);
  if (low.length) { problem = true; lines.push('🔋 แบตเตอรี่ต่ำ: ' + low.map(s => str(s.location) + ' ' + num(s.battery) + '%').join(', ')); }
  return { lines, problem };
}

function sendDailySummary(now, date) {
  flushDays(now);
  resetTableCache();
  date = /^\d{4}-\d{2}-\d{2}$/.test(str(date)) ? str(date) : dayKey(now - 86400000);
  const zones = zoneMap();
  const sensors = readTable('sensors').rows.filter(s => truthy(s.active) && str(s.sensorId));
  const daily = readTable('daily').rows.filter(d => dayKey(d.date) === date);
  const excs = readTable('excursions').rows;
  const branches = uniqueBranches(sensors);
  const title = '📋 สรุปอุณหภูมิยา (GPP) วันที่ ' + thaiDate(date);

  const sections = {};
  branches.forEach(b => {
    const code = branchCode(b);
    sections[b] = branchSummary(b,
      sensors.filter(s => branchCode(s.branch) === code),
      daily.filter(d => branchCode(d.branch) === code),
      excs.filter(e => branchCode(e.branch) === code), zones);
  });

  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  const targets = activeLineTargets();
  const sent = [];
  const send = (t, text) => {
    const res = token ? linePush(token, str(t.groupId), text) : { ok: false, error: 'no_token' };
    logAlert(now, 'line', str(t.label) || str(t.groupId), str(t.branch), res.ok ? 'ok' : res.error, text);
    sent.push({ target: str(t.label) || str(t.groupId), ok: res.ok, error: res.error || '' });
  };
  targets.forEach(t => {
    if (str(t.branch) === '*') return;
    const b = branches.find(x => branchCode(x) === branchCode(t.branch));
    if (b) send(t, title + '\n📍 ' + b + '\n' + sections[b].lines.join('\n'));
  });
  const centralText = centralSummary(title, branches, sections);
  targets.filter(t => str(t.branch) === '*').forEach(t => send(t, centralText));
  if (!targets.length) {
    const res = sendAlertEmail('[GPP] ' + title.replace(/^\S+\s/, ''), branches.map(b => '📍 ' + b + '\n' + sections[b].lines.join('\n')).join('\n\n'));
    logAlert(now, 'email', res.to || '-', '', res.ok ? 'ok' : res.error, 'daily summary ' + date);
    sent.push({ target: 'email', ok: res.ok, error: res.error || '' });
  }
  return { ok: true, date, branches: branches.length, sent, preview: centralText };
}

// กลุ่มส่วนกลาง: แสดงรายละเอียดเฉพาะสาขาที่มีปัญหา
function centralSummary(title, branches, sections) {
  const bad = branches.filter(b => sections[b].problem);
  const good = branches.filter(b => !sections[b].problem);
  const lines = [title, 'ทั้งหมด ' + branches.length + ' สาขา · ปกติ ' + good.length + ' · ต้องตรวจสอบ ' + bad.length];
  bad.forEach(b => { lines.push('', '📍 ' + b); sections[b].lines.filter(l => !/^(✅|🟡)/.test(l)).forEach(l => lines.push(l)); });
  if (good.length) lines.push('', '✅ ไม่มีจุดผิดเกณฑ์: ' + good.map(branchCode).join(', '));
  const url = PropertiesService.getScriptProperties().getProperty('APP_URL');
  if (url) lines.push('', url);
  return lines.join('\n').slice(0, 4900);
}

function uniqueBranches(sensors) {
  const seen = {};
  const out = [];
  sensors.forEach(s => {
    const code = branchCode(s.branch);
    if (code && !seen[code]) { seen[code] = true; out.push(str(s.branch)); }
  });
  return out.sort();
}

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thaiDate(d) {
  const p = d.split('-');
  return Number(p[2]) + ' ' + THAI_MONTHS_SHORT[Number(p[1]) - 1] + ' ' + (Number(p[0]) + 543);
}
function thaiMonth(m) {
  const p = m.split('-');
  return THAI_MONTHS[Number(p[1]) - 1] + ' ' + (Number(p[0]) + 543);
}

// ── รายงานเดือน (PDF) ─────────────────────────────────
function sendMonthlyReports(now) {
  flushDays(now);
  const d = new Date(now);
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 15);
  const month = Utilities.formatDate(prev, TZ, 'yyyy-MM');
  resetTableCache();
  const branches = uniqueBranches(readTable('sensors').rows.filter(s => truthy(s.active)));
  const started = Date.now();
  const links = [];
  branches.forEach(b => {
    if (Date.now() - started > 300000) { links.push({ branch: b, error: 'หมดเวลา — สร้างเองจากหน้าเว็บ' }); return; }
    try { links.push(Object.assign({ branch: b }, buildMonthlyReport(b, month))); }
    catch (err) { links.push({ branch: b, error: String(err && err.message || err) }); }
  });
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  const title = '📄 รายงานอุณหภูมิประจำเดือน ' + thaiMonth(month);
  activeLineTargets().forEach(t => {
    const mine = str(t.branch) === '*' ? links : links.filter(l => branchCode(l.branch) === branchCode(t.branch));
    if (!mine.length) return;
    const text = title + '\n' + mine.map(l => '• ' + l.branch + ': ' + (l.url || l.error)).join('\n') +
      '\nกรุณาพิมพ์และให้เภสัชกรลงนามเก็บไว้ตรวจ GPP';
    const res = token ? linePush(token, str(t.groupId), text) : { ok: false, error: 'no_token' };
    logAlert(now, 'line', str(t.label) || str(t.groupId), str(t.branch), res.ok ? 'ok' : res.error, text);
  });
  return { ok: true, month, links };
}

function buildMonthlyReport(branch, month, orient) {
  if (!/^\d{4}-\d{2}$/.test(str(month))) throw fail('invalid', 'รูปแบบเดือนไม่ถูกต้อง');
  return buildReport({ branch, month, orient });
}

// สร้าง PDF จากหน้าเว็บ: { branch, month } หรือ { branch, from, to } + orient
function buildReport(body) {
  const branch = str(body.branch);
  if (!branchCode(branch)) throw fail('invalid', 'กรุณาเลือกสาขา');
  const range = reportRange(body);
  const data = Object.assign(collectRange(branch, range.from, range.to, chartSettings()), { month: range.month });
  if (!data.sensors.length) throw fail('not_found', 'สาขานี้ยังไม่มีเซ็นเซอร์');
  const tag = range.month || range.from + '_' + range.to;
  const name = 'GPP-Temp_' + branchCode(branch) + '_' + tag + '.pdf';
  const blob = HtmlService.createHtmlOutput(reportHtml(data, body.orient)).getBlob().getAs('application/pdf').setName(name);
  const folder = driveFolder(range.from.slice(0, 7), driveFolder(REPORT_FOLDER));
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  const file = folder.createFile(blob);
  return { ok: true, url: file.getUrl(), name };
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function cell(v) { return v == null || v === '' ? '' : Number(v).toFixed(1); }

const EXC_TYPE_TH = { high: 'สูงกว่าเกณฑ์', low: 'ต่ำกว่าเกณฑ์', offline: 'ขาดการเชื่อมต่อ' };

function reportHtml(data, orient) {
  orient = orient === 'h' || orient === 'v' ? orient : data.settings.orient;
  const css = '@page{size:A4 ' + (orient === 'v' ? 'landscape' : 'portrait') + ';margin:8mm}body{font-family:"Sarabun","Noto Sans Thai",sans-serif;font-size:11px;color:#111;margin:0}' +
    '.pg{page-break-after:always;padding:6px 4px}.pg:last-child{page-break-after:auto}' +
    'h1{font-size:16px;margin:0 0 2px}h2{font-size:13px;margin:10px 0 4px;color:#0a6c36}' +
    '.meta{font-size:11px;color:#333;margin-bottom:6px}table{width:100%;border-collapse:collapse}' +
    'th,td{border:1px solid #888;padding:2px 4px;text-align:center}th{background:#eef5f0}' +
    'td.l{text-align:left}.bad{color:#b91c1c;font-weight:bold}.warn{color:#a16207}' +
    '.sign{width:100%;margin-top:18px}.sign td{border:0;width:50%;text-align:center;padding:0 24px}' +
    '.line{border-bottom:1px dotted #333;height:24px;margin-bottom:3px}' + GRID_CSS;
  const head = '<h1>บันทึกการควบคุมอุณหภูมิการเก็บรักษายา</h1>' +
    '<div class="meta">สาขา: <b>' + esc(data.branch) + '</b>' +
    (data.month ? ' · ประจำเดือน <b>' + esc(thaiMonth(data.month)) + '</b>' : ' · ช่วงวันที่ <b>' + esc(thaiDate(data.from)) + ' – ' + esc(thaiDate(data.to)) + '</b>') +
    ' · บันทึกอัตโนมัติจากเครื่องวัด (ระบบ Sala-TempGPP)</div>';
  const signs = '<table class="sign"><tr><td><div class="line"></div>ผู้ตรวจสอบบันทึก<br>วันที่ ........................</td>' +
    '<td><div class="line"></div>เภสัชกรผู้มีหน้าที่ปฏิบัติการ<br>วันที่ ........................</td></tr></table>';

  const pages = data.sensors.map(s => {
    const lim = s.limits;
    const mine = data.days.filter(x => x.sensorId === s.sensorId && x.readings);
    const excTotal = mine.reduce((t, r) => t + (r.excursionMin || 0), 0);
    const nBad = mine.filter(r => (r.excursionMin || 0) > 0 || r.state === 'alarm').length;
    const mins = mine.map(r => r.tMin).filter(v => v != null), maxs = mine.map(r => r.tMax).filter(v => v != null);
    const grid = gridChartHtml({
      settings: data.settings, zoneType: s.zoneType, limits: lim, dates: data.dates, values: data.values[s.sensorId] || {}, today: data.today,
      fmtTime: ms => Utilities.formatDate(new Date(ms), TZ, 'HH:mm'), showHum: lim.hMax != null, orient,
    });
    return '<div class="pg">' + head +
      '<h2>' + esc(s.location) + ' (' + esc(s.sensorId) + ') · ' + esc(lim.zoneLabel) + '</h2>' + grid +
      '<div class="meta" style="margin-top:4px">' + (data.month ? 'ทั้งเดือน' : 'ทั้งช่วง') + ': ต่ำสุด ' + (mins.length ? cell(Math.min.apply(null, mins)) : '-') +
      '°C · สูงสุด ' + (maxs.length ? cell(Math.max.apply(null, maxs)) : '-') + '°C (จากทุกค่าที่วัดได้ทุก ' + pollMinutes() + ' นาที)' +
      ' · วันที่ผิดเกณฑ์ ' + nBad + ' วัน · รวมเวลานอกเกณฑ์ ' + esc(fmtDuration(excTotal)) +
      (s.calOffset ? ' · ค่าชดเชยการสอบเทียบ ' + s.calOffset + '°C' : '') + '</div>' + signs + '</div>';
  });

  const ex = data.excursions.filter(e => e.type !== 'offline' || e.durationMin >= 60);
  const exRows = ex.length ? ex.map(e =>
    '<tr><td>' + esc(e.id) + '</td><td class="l">' + esc(e.location) + '</td><td>' + esc(EXC_TYPE_TH[e.type] || e.type) + '</td><td>' +
    esc(fmtDateTime(e.start)) + '</td><td>' + esc(e.end ? fmtDateTime(e.end) : 'ยังไม่สิ้นสุด') + '</td><td>' + esc(fmtDuration(e.durationMin)) +
    '</td><td>' + (e.type === 'low' ? cell(e.minTemp) : cell(e.maxTemp)) + '</td><td class="l">' + esc(e.correctiveAction || '— ยังไม่ได้บันทึก —') +
    '</td><td class="l">' + esc(e.ackBy.replace(/\s*<.*>$/, '')) + '</td></tr>').join('') :
    '<tr><td colspan="9">ไม่มีเหตุการณ์ผิดเกณฑ์ในเดือนนี้</td></tr>';
  pages.push('<div class="pg">' + head + '<h2>บันทึกเหตุการณ์ผิดเกณฑ์และการแก้ไข</h2>' +
    '<table><tr><th>รหัส</th><th>จุด</th><th>ประเภท</th><th>เริ่ม</th><th>สิ้นสุด</th><th>ระยะเวลา</th><th>ค่าสุดขีด (°C)</th><th>การแก้ไข</th><th>ผู้บันทึก</th></tr>' +
    exRows + '</table>' + signs + '</div>');

  return '<html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + pages.join('') + '</body></html>';
}
