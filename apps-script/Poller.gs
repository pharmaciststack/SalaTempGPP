// =====================================================
// Poller.gs — ดึงค่าจากทุกบัญชีตามรอบ (time trigger) → เก็บค่าดิบ → ประเมินเกณฑ์ → สรุปรายวัน → แจ้งเตือน
// =====================================================

function pollTrigger() {
  try {
    runPoll(Date.now());
  } catch (err) {
    console.error('poll failed', err);
  }
}

// รอบดึงค่า 1 ครั้ง (now ส่งเข้ามาเพื่อให้ทดสอบ/จำลองย้อนหลังได้)
function runPoll(now, opts) {
  opts = opts || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy', message: 'รอบก่อนหน้ายังทำงานอยู่' };
  try {
    resetTableCache();
    const accT = readTable('accounts', true);
    const sensT = readTable('sensors', true);
    const excT = readTable('excursions', true);
    const zones = zoneMap();
    const active = sensT.rows.filter(s => truthy(s.active) && str(s.accountId) && str(s.deviceId));

    // 1) อ่านค่าจากแต่ละบัญชี
    const results = {};
    const skipped = {};
    const accountErrors = [];
    accT.rows.forEach(acc => {
      if (!truthy(acc.active)) return;
      const mine = active.filter(s => str(s.accountId) === str(acc.accountId));
      if (!mine.length) return;
      const minInt = num(acc.minIntervalMin) || 0;
      const last = toMs(acc.lastPollAt);
      if (minInt && last && now - last < minInt * 60000 - 60000) { mine.forEach(s => { skipped[s.sensorId] = true; }); return; }
      try {
        const r = providerFor(acc).read(acc, mine.map(s => str(s.deviceId)), now);
        mine.forEach(s => { results[s.sensorId] = r[str(s.deviceId)] || { online: false, error: 'missing' }; });
        acc.lastError = '';
      } catch (err) {
        acc.lastError = String(err && err.message || err).slice(0, 300);
        accountErrors.push({ accountId: str(acc.accountId), error: acc.lastError });
        mine.forEach(s => { results[s.sensorId] = { online: false, error: 'account' }; });
      }
      acc.lastPollAt = now;
    });

    // 2) ประเมินทีละจุด
    const events = [];
    const readings = [];
    const dailyOut = [];
    const newExc = [];
    let read = 0;
    active.forEach(s => {
      // ขึ้นวันใหม่ → บันทึกสรุปของวันก่อนลงชีต Daily
      const flushed = rollDay(s, now);
      if (flushed) dailyOut.push(flushed);
      if (skipped[s.sensorId] && !results[s.sensorId]) {
        const r0 = evaluateSensor(s, null, now, effectiveLimits(s, zones), excT, newExc);
        r0.forEach(e => events.push(e));
        return;
      }
      const rd = results[s.sensorId];
      let reading = null;
      if (rd && rd.online && rd.temp !== null && isFinite(rd.temp)) {
        reading = {
          ts: rd.ts || now,
          temp: round1(Number(rd.temp) + (num(s.calOffset) || 0)),
          hum: rd.hum == null ? null : round1(rd.hum),
          battery: rd.battery == null ? null : Math.round(rd.battery),
        };
        read++;
      }
      const prevTs = toMs(s.lastTs);
      const prevState = str(s.state);
      evaluateSensor(s, reading, now, effectiveLimits(s, zones), excT, newExc).forEach(e => events.push(e));
      if (reading) {
        accumulateDay(s, reading, prevTs, prevState);
        readings.push({ branch: str(s.branch), sensorId: str(s.sensorId), ts: reading.ts, temp: reading.temp, hum: reading.hum, battery: reading.battery });
      }
    });

    // 3) บันทึก
    if (newExc.length) appendRows(excT, newExc);
    saveAll(excT);
    saveAll(sensT);
    saveAll(accT);
    if (dailyOut.length) appendRows(readTable('daily'), dailyOut);
    if (readings.length && !opts.skipReadings) appendReadings(readings);
    PropertiesService.getScriptProperties().setProperty('LAST_POLL_AT', String(now));

    // 4) แจ้งเตือน
    let sent = [];
    if (events.length && !opts.silent) sent = dispatchAlerts(events, now);
    if (accountErrors.length && !opts.silent) notifyAccountErrors(accountErrors, now);

    return { ok: true, at: now, sensors: active.length, read, events: events.map(e => ({ kind: e.kind, sensorId: e.sensorId, type: e.type })), sent, accountErrors };
  } finally {
    lock.releaseLock();
  }
}

// สะสมสถิติรายวันไว้ในแถวของเซ็นเซอร์ (ไม่ต้องอ่านค่าดิบทั้งเดือนเพื่อทำรายงาน)
function accumulateDay(s, r, prevTs, prevState) {
  const today = dayKey(r.ts);
  if (dayKey(s.dayDate) !== today) resetDay(s, today);
  const n = (num(s.dayN) || 0) + 1;
  s.dayN = n;
  s.daySum = round1((num(s.daySum) || 0) + r.temp);
  s.dayMin = num(s.dayMin) == null ? r.temp : Math.min(num(s.dayMin), r.temp);
  s.dayMax = num(s.dayMax) == null ? r.temp : Math.max(num(s.dayMax), r.temp);
  if (r.hum != null) s.dayHMax = num(s.dayHMax) == null ? r.hum : Math.max(num(s.dayHMax), r.hum);
  // เวลาที่อยู่นอกเกณฑ์ (นับช่วงระหว่างค่าที่แล้วกับค่านี้ ถ้าค่านี้ผิดเกณฑ์ · จำกัด 60 นาทีต่อช่วง)
  if (str(s.state) === 'alarm' && prevTs && dayKey(prevTs) === today) {
    s.dayExcMin = (num(s.dayExcMin) || 0) + Math.min(60, Math.round((r.ts - prevTs) / 60000));
  }
  const rank = { ok: 0, warn: 1, alarm: 2 };
  const st = str(s.state);
  if (rank[st] !== undefined && (rank[st] > (rank[str(s.dayWorst)] || 0) || !str(s.dayWorst))) s.dayWorst = st;
}

function resetDay(s, today) {
  s.dayDate = today;
  ['dayMin', 'dayMax', 'daySum', 'dayN', 'dayHMax', 'dayExcMin', 'dayWorst'].forEach(k => { s[k] = ''; });
}

// ถ้าค่าสะสมเป็นของวันก่อน → คืนแถว Daily แล้วล้างค่า
function rollDay(s, now) {
  const today = dayKey(now);
  const d = dayKey(s.dayDate);
  if (!d || d === today) return null;
  const row = dailyRowFromSensor(s, false);
  resetDay(s, today);
  return row;
}

function dailyRowFromSensor(s, asPublic) {
  const n = num(s.dayN) || 0;
  const row = {
    date: dayKey(s.dayDate), sensorId: str(s.sensorId), branch: str(s.branch), location: str(s.location), zoneType: str(s.zoneType),
    tMin: num(s.dayMin), tMax: num(s.dayMax), tAvg: n ? round1(num(s.daySum) / n) : null, hMax: num(s.dayHMax),
    readings: n, excursionMin: num(s.dayExcMin) || 0,
    state: n ? (str(s.dayWorst) || 'ok') : 'nodata',
  };
  if (asPublic) {
    return { date: row.date, sensorId: row.sensorId, tMin: row.tMin, tMax: row.tMax, tAvg: row.tAvg, hMax: row.hMax,
             readings: row.readings, excursionMin: row.excursionMin, state: row.state, partial: true };
  }
  Object.keys(row).forEach(k => { if (row[k] === null) row[k] = ''; });
  return row;
}

// ── Triggers / Setup ──────────────────────────────────
// รันฟังก์ชันนี้หนึ่งครั้งจาก Apps Script editor หลังวางโค้ด (และทุกครั้งที่เปลี่ยน POLL_MINUTES)
function setup() {
  setupSheets();
  setupTriggers();
  console.log('พร้อมใช้งาน: ดึงค่าทุก ' + pollMinutes() + ' นาที · สรุปรายวัน 08:00 · รายงานเดือนวันที่ 1 เวลา 07:00');
}

function setupTriggers() {
  const ours = ['pollTrigger', 'dailySummaryTrigger', 'monthlyReportTrigger'];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (ours.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pollTrigger').timeBased().everyMinutes(pollMinutes()).create();
  ScriptApp.newTrigger('dailySummaryTrigger').timeBased().everyDays(1).atHour(8).nearMinute(5).create();
  ScriptApp.newTrigger('monthlyReportTrigger').timeBased().onMonthDay(1).atHour(7).create();
  return { ok: true };
}

// ทดสอบดึงค่าทันที (รันจาก editor ได้)
function pollNow() {
  const r = runPoll(Date.now());
  console.log(JSON.stringify(r));
  return r;
}
