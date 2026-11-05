// =====================================================
// Alerts.gs — ประเมินเกณฑ์ (state machine ของ excursion) + ส่ง LINE Messaging API / อีเมลสำรอง
// ใช้ LINE Official Account + Messaging API (LINE Notify ปิดบริการแล้วตั้งแต่ 31 มี.ค. 2025)
// Script Properties: LINE_CHANNEL_TOKEN (Channel access token) · ALERT_EMAILS (คั่นด้วย ,) · APP_URL (ลิงก์หน้าเว็บ)
// =====================================================

const LINE_API = 'https://api.line.me/v2/bot';

// ── เกณฑ์ ─────────────────────────────────────────────
// alarm = ผิดเกณฑ์ (เปิด excursion เมื่อผิดติดกันครบ confirmReadings ครั้ง) · warn = เฝ้าระวัง (ไม่แจ้งทันที)
function classifyReading(r, lim) {
  if (lim.tMax != null && r.temp > lim.tMax) return { level: 'alarm', type: 'high' };
  if (lim.tMin != null && r.temp < lim.tMin) return { level: 'alarm', type: 'low' };
  if (lim.tWarn != null && r.temp > lim.tWarn) return { level: 'warn', type: 'near' };
  if (lim.hMax != null && r.hum != null && r.hum > lim.hMax) return { level: 'warn', type: 'humid' };
  return { level: 'ok', type: '' };
}

// ประเมินเซ็นเซอร์ 1 จุดจากค่าล่าสุด (r = null คือรอบนี้อ่านค่าไม่ได้) — แก้ค่าใน s โดยตรง และคืนรายการเหตุการณ์ที่ต้องแจ้ง
function evaluateSensor(s, r, now, lim, excT, newExc) {
  const ev = [];
  const base = extra => Object.assign({
    sensorId: str(s.sensorId), branch: str(s.branch), location: str(s.location), zoneLabel: lim.zoneLabel, limits: lim,
  }, extra);
  const lastTs = toMs(s.lastTs);

  if (!r) {
    if (!lastTs) { s.state = 'pending'; return ev; }              // ยังไม่เคยได้ค่า — ไม่แจ้ง
    if (!str(s.offExcId) && now - lastTs >= lim.offlineMinutes * 60000) {
      const exc = openExc(excT, newExc, s, 'offline', lastTs, now);
      exc.maxTemp = num(s.lastTemp);
      s.offExcId = exc.id;
      ev.push(base({ kind: 'offline', type: 'offline', start: lastTs, temp: num(s.lastTemp), excId: exc.id }));
    }
    if (str(s.offExcId)) {
      s.state = 'offline';
      const open = findExc(excT, newExc, s.offExcId);
      if (open) open.durationMin = Math.max(0, Math.round((now - toMs(open.start)) / 60000));
    }
    return ev;
  }

  if (str(s.offExcId)) {
    const exc = findExc(excT, newExc, s.offExcId);
    if (exc) closeExc(exc, r.ts);
    ev.push(base({ kind: 'online', type: 'offline', start: exc ? toMs(exc.start) : lastTs, temp: r.temp,
                   durationMin: exc ? num(exc.durationMin) : null, excId: str(s.offExcId) }));
    s.offExcId = '';
  }

  s.lastTs = r.ts;
  s.lastTemp = r.temp;
  s.lastHum = r.hum == null ? '' : r.hum;
  if (r.battery != null) s.battery = r.battery;

  const c = classifyReading(r, lim);
  if (c.level === 'alarm') {
    s.badCount = (num(s.badCount) || 0) + 1;
    if (!toMs(s.badSince)) s.badSince = r.ts;
    s.peakMax = num(s.peakMax) == null ? r.temp : Math.max(num(s.peakMax), r.temp);
    s.peakMin = num(s.peakMin) == null ? r.temp : Math.min(num(s.peakMin), r.temp);
    if (r.hum != null) s.peakHum = num(s.peakHum) == null ? r.hum : Math.max(num(s.peakHum), r.hum);
    s.state = 'alarm';
    let exc = str(s.excId) ? findExc(excT, newExc, s.excId) : null;
    if (exc) {
      updatePeaks(exc, s, r.ts);
      if (now - (toMs(s.lastAlertAt) || 0) >= lim.realertMinutes * 60000) {
        s.lastAlertAt = now;
        ev.push(base({ kind: 'still', type: str(exc.type), temp: r.temp, start: toMs(exc.start), durationMin: num(exc.durationMin),
                       maxTemp: num(exc.maxTemp), minTemp: num(exc.minTemp), excId: str(exc.id) }));
      }
    } else if (s.badCount >= lim.confirmReadings) {
      exc = openExc(excT, newExc, s, c.type, toMs(s.badSince), now);
      updatePeaks(exc, s, r.ts);
      s.excId = exc.id;
      s.lastAlertAt = now;
      ev.push(base({ kind: 'open', type: c.type, temp: r.temp, start: toMs(exc.start), durationMin: num(exc.durationMin), excId: exc.id }));
    }
  } else {
    if (str(s.excId)) {
      const exc = findExc(excT, newExc, s.excId);
      if (exc) closeExc(exc, r.ts);
      ev.push(base({ kind: 'close', type: exc ? str(exc.type) : '', temp: r.temp, start: exc ? toMs(exc.start) : null,
                     durationMin: exc ? num(exc.durationMin) : null, maxTemp: exc ? num(exc.maxTemp) : null,
                     minTemp: exc ? num(exc.minTemp) : null, excId: str(s.excId) }));
      s.excId = '';
    }
    s.badCount = 0;
    s.badSince = '';
    s.peakMax = '';
    s.peakMin = '';
    s.peakHum = '';
    s.lastAlertAt = '';
    s.state = c.level;
  }
  return ev;
}

function openExc(excT, newExc, s, type, start, now) {
  const exc = {
    id: nextExcId(excT, newExc, now), sensorId: str(s.sensorId), branch: str(s.branch), location: str(s.location),
    type, start, end: '', durationMin: Math.max(0, Math.round((now - start) / 60000)),
    maxTemp: '', minTemp: '', maxHum: '', status: 'open', ackBy: '', ackAt: '', correctiveAction: '', note: '',
  };
  newExc.push(exc);
  return exc;
}

function updatePeaks(exc, s, ts) {
  exc.maxTemp = num(s.peakMax) == null ? '' : num(s.peakMax);
  exc.minTemp = num(s.peakMin) == null ? '' : num(s.peakMin);
  exc.maxHum = num(s.peakHum) == null ? '' : num(s.peakHum);
  exc.durationMin = Math.max(0, Math.round((ts - toMs(exc.start)) / 60000));
}

function closeExc(exc, ts) {
  exc.end = ts;
  exc.durationMin = Math.max(0, Math.round((ts - toMs(exc.start)) / 60000));
  exc.status = 'closed';
}

function findExc(excT, newExc, id) {
  id = str(id);
  return newExc.find(e => str(e.id) === id) || excT.rows.find(e => str(e.id) === id) || null;
}

// รหัสเหตุการณ์ EX-yyMM-0001 (เรียงตามเดือน)
function nextExcId(excT, newExc, now) {
  const prefix = 'EX-' + Utilities.formatDate(new Date(now), TZ, 'yyMM') + '-';
  let n = 0;
  excT.rows.concat(newExc).forEach(e => {
    const id = str(e.id);
    if (id.indexOf(prefix) === 0) n = Math.max(n, Number(id.slice(prefix.length)) || 0);
  });
  return prefix + ('000' + (n + 1)).slice(-4);
}

// ── ข้อความ ───────────────────────────────────────────
function fmtTemp(v) { return v == null || v === '' ? '-' : Number(v).toFixed(1) + '°C'; }
function fmtTime(ms) { return ms ? Utilities.formatDate(new Date(ms), TZ, 'HH:mm') : '-'; }
function fmtDateTime(ms) { return ms ? Utilities.formatDate(new Date(ms), TZ, 'dd/MM HH:mm') : '-'; }
function fmtDuration(min) {
  min = Math.round(Number(min) || 0);
  if (min < 60) return min + ' นาที';
  const h = Math.floor(min / 60), m = min % 60;
  return h + ' ชม.' + (m ? ' ' + m + ' นาที' : '');
}

function rangeText(lim) {
  if (lim.tMin != null && lim.tMax != null) return lim.tMin + '–' + lim.tMax + '°C';
  if (lim.tMax != null) return 'ไม่เกิน ' + lim.tMax + '°C';
  if (lim.tMin != null) return 'ไม่ต่ำกว่า ' + lim.tMin + '°C';
  return '-';
}

function sinceText(start) {
  return dayKey(start) === dayKey(Date.now()) ? fmtTime(start) : fmtDateTime(start);
}

function eventLine(e) {
  const where = e.location || e.sensorId;
  const dir = e.type === 'low' ? 'ต่ำกว่าเกณฑ์' : 'สูงกว่าเกณฑ์';
  switch (e.kind) {
    case 'open':
      return '🔴 ' + where + ' ' + fmtTemp(e.temp) + ' — ' + dir + ' (' + rangeText(e.limits) + ') ตั้งแต่ ' + sinceText(e.start);
    case 'still':
      return '🔴 ' + where + ' ยังผิดเกณฑ์ ' + fmtTemp(e.temp) + ' นาน ' + fmtDuration(e.durationMin) +
        ' (' + (e.type === 'low' ? 'ต่ำสุด ' + fmtTemp(e.minTemp) : 'สูงสุด ' + fmtTemp(e.maxTemp)) + ')';
    case 'close':
      return '✅ ' + where + ' กลับสู่เกณฑ์ ' + fmtTemp(e.temp) + ' · ผิดเกณฑ์นาน ' + fmtDuration(e.durationMin) +
        ' (' + (e.type === 'low' ? 'ต่ำสุด ' + fmtTemp(e.minTemp) : 'สูงสุด ' + fmtTemp(e.maxTemp)) + ') — กรุณาบันทึกการแก้ไข';
    case 'offline':
      return '⚪ ' + where + ' ขาดการเชื่อมต่อตั้งแต่ ' + sinceText(e.start) + ' (ค่าล่าสุด ' + fmtTemp(e.temp) + ')';
    case 'online':
      return '🔵 ' + where + ' กลับมาออนไลน์ ' + fmtTemp(e.temp) + ' (ขาดไป ' + fmtDuration(e.durationMin) + ')';
  }
  return '';
}

function formatAlert(events, now) {
  const byBranch = {};
  events.forEach(e => { (byBranch[e.branch] = byBranch[e.branch] || []).push(e); });
  const lines = ['🌡️ แจ้งเตือนอุณหภูมิยา (GPP) · ' + fmtDateTime(now)];
  Object.keys(byBranch).sort().forEach(b => {
    lines.push('', '📍 ' + b);
    byBranch[b].forEach(e => lines.push(eventLine(e)));
  });
  const url = PropertiesService.getScriptProperties().getProperty('APP_URL');
  if (events.some(e => e.kind === 'open' || e.kind === 'close') && url) lines.push('', '📝 บันทึกการแก้ไข: ' + url);
  return lines.join('\n');
}

// ── ส่งแจ้งเตือน ───────────────────────────────────────
// รวมทุกเหตุการณ์ของรอบเป็นข้อความเดียวต่อกลุ่ม (ประหยัดโควตา LINE) · กลุ่มสาขาได้เฉพาะสาขาตัวเอง · กลุ่ม * ได้ทุกสาขา
function dispatchAlerts(events, now) {
  const targets = activeLineTargets();
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  const sent = [];
  const covered = {};
  const failedEvents = [];
  targets.forEach(t => {
    const mine = events.filter(e => str(t.branch) === '*' || branchCode(t.branch) === branchCode(e.branch));
    if (!mine.length) return;
    mine.forEach(e => { covered[e.sensorId + e.kind] = true; });
    const text = formatAlert(mine, now);
    const res = token ? linePush(token, str(t.groupId), text) : { ok: false, error: 'no_token' };
    logAlert(now, 'line', str(t.label) || str(t.groupId), str(t.branch), res.ok ? 'ok' : res.error, text);
    sent.push({ target: str(t.label) || str(t.groupId), ok: res.ok, error: res.error || '' });
    if (!res.ok) mine.forEach(e => failedEvents.push(e));
  });
  const fallback = events.filter(e => !covered[e.sensorId + e.kind]).concat(failedEvents);
  if (fallback.length) {
    const uniq = [];
    fallback.forEach(e => { if (uniq.indexOf(e) === -1) uniq.push(e); });
    const res = sendAlertEmail('[GPP] แจ้งเตือนอุณหภูมิ ' + fmtDateTime(now), formatAlert(uniq, now));
    logAlert(now, 'email', res.to || '-', '', res.ok ? 'ok' : res.error, formatAlert(uniq, now));
    sent.push({ target: 'email', ok: res.ok, error: res.error || '' });
  }
  return sent;
}

function activeLineTargets() {
  return readTable('lineTargets').rows.filter(t => truthy(t.active) && str(t.groupId));
}

function linePush(token, to, text) {
  try {
    const res = UrlFetchApp.fetch(LINE_API + '/message/push', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
    });
    const code = res.getResponseCode();
    if (code === 200) return { ok: true };
    const j = parseJson(res.getContentText()) || {};
    return { ok: false, error: (code === 429 ? 'quota_' : 'http_' + code + '_') + (j.message || '') };
  } catch (err) {
    return { ok: false, error: 'fetch_' + String(err && err.message || err).slice(0, 80) };
  }
}

function lineReply(token, replyToken, text) {
  UrlFetchApp.fetch(LINE_API + '/message/reply', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
}

function sendAlertEmail(subject, body) {
  const to = str(PropertiesService.getScriptProperties().getProperty('ALERT_EMAILS'));
  if (!to) return { ok: false, error: 'no_email' };
  try {
    MailApp.sendEmail({ to, subject, body });
    return { ok: true, to };
  } catch (err) {
    return { ok: false, to, error: String(err && err.message || err).slice(0, 100) };
  }
}

function logAlert(now, channel, target, branch, result, message) {
  const t = readTable('alertLog');
  appendRows(t, [{ ts: now, channel, target, branch, result, message: String(message).slice(0, 2000) }]);
}

// แจ้งปัญหาบัญชี API (token ผิด/หมดอายุ/เกินโควตา) ไปกลุ่มส่วนกลาง — ไม่เกิน 1 ครั้งต่อ 6 ชม. ต่อบัญชี
function notifyAccountErrors(errors, now) {
  const cache = CacheService.getScriptCache();
  const fresh = errors.filter(e => !cache.get('accerr:' + e.accountId));
  if (!fresh.length) return;
  fresh.forEach(e => cache.put('accerr:' + e.accountId, '1', 21600));
  const text = '⚙️ ดึงข้อมูลเครื่องวัดไม่ได้ · ' + fmtDateTime(now) + '\n' +
    fresh.map(e => '• บัญชี ' + e.accountId + ': ' + e.error).join('\n') +
    '\nเซ็นเซอร์ในบัญชีนี้จะขึ้นสถานะขาดการเชื่อมต่อจนกว่าจะแก้ไข';
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  const central = activeLineTargets().filter(t => str(t.branch) === '*');
  let ok = false;
  central.forEach(t => {
    const res = token ? linePush(token, str(t.groupId), text) : { ok: false, error: 'no_token' };
    logAlert(now, 'line', str(t.label) || str(t.groupId), '*', res.ok ? 'ok' : res.error, text);
    ok = ok || res.ok;
  });
  if (!ok) {
    const res = sendAlertEmail('[GPP] ดึงข้อมูลเครื่องวัดไม่ได้', text);
    logAlert(now, 'email', res.to || '-', '', res.ok ? 'ok' : res.error, text);
  }
}

// ── LINE webhook: เก็บ groupId เมื่อบอทถูกเชิญเข้ากลุ่ม หรือมีคนพิมพ์ #ลงทะเบียน ──
// (Apps Script อ่าน header X-Line-Signature ไม่ได้ จึงแค่บันทึกไว้ให้แอดมินเลือกผูกสาขาเอง ไม่มีการส่งข้อมูลออก)
function handleLineWebhook(body) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  const t = readTable('linePending');
  (body.events || []).slice(0, 10).forEach(ev => {
    const src = ev.source || {};
    const id = str(src.groupId || src.roomId);
    const text = ev.message && ev.message.type === 'text' ? str(ev.message.text) : '';
    const isRegister = /^#\s*(ลงทะเบียน|register|id)\b/i.test(text);
    if (!id || !(ev.type === 'join' || isRegister)) return;
    if (!/^[CR][0-9a-f]{32}$/.test(id)) return;
    if (!t.rows.some(r => str(r.groupId) === id)) {
      appendRows(t, [{ ts: Date.now(), groupId: id, type: ev.type, text: text.slice(0, 100) }]);
    }
    if (token && ev.replyToken) {
      try {
        lineReply(token, ev.replyToken, 'บันทึกกลุ่มนี้ในระบบแจ้งเตือนอุณหภูมิแล้ว ✅\nให้แอดมินเปิดหน้า "ตั้งค่า > LINE" เพื่อเลือกสาขาของกลุ่มนี้\n(รหัสกลุ่ม: ' + id.slice(0, 8) + '…)');
      } catch (err) { console.warn(err); }
    }
  });
  // เก็บไว้ไม่เกิน 50 แถว
  while (t.rows.length > 50) deleteRow(t, t.rows[0]);
}

function lineTest(branch) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  if (!token) throw fail('no_token', 'ยังไม่ได้ใส่ LINE_CHANNEL_TOKEN ใน Script Properties');
  const now = Date.now();
  const targets = activeLineTargets().filter(t => !branch || str(t.branch) === str(branch));
  if (!targets.length) throw fail('not_found', 'ไม่มีกลุ่ม LINE ที่เปิดใช้งานสำหรับ ' + (branch || 'ทุกสาขา'));
  const results = targets.map(t => {
    const text = '🧪 ทดสอบระบบแจ้งเตือนอุณหภูมิ (GPP)\nกลุ่มนี้จะได้รับแจ้งเตือนของ: ' + (str(t.branch) === '*' ? 'ทุกสาขา' : str(t.branch)) + '\n' + fmtDateTime(now);
    const res = linePush(token, str(t.groupId), text);
    logAlert(now, 'line', str(t.label) || str(t.groupId), str(t.branch), res.ok ? 'ok' : res.error, text);
    return { target: str(t.label) || str(t.groupId), ok: res.ok, error: res.error || '' };
  });
  return { ok: true, results };
}

function lineQuota() {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  if (!token) return null;
  const get = path => parseJson(UrlFetchApp.fetch(LINE_API + path, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }).getContentText()) || {};
  const q = get('/message/quota');
  const c = get('/message/quota/consumption');
  return { type: q.type || '', limit: q.value == null ? null : q.value, used: c.totalUsage == null ? null : c.totalUsage };
}
