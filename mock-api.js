/* =====================================================
   mock-api.js — โหมดทดสอบ (?mock หรือยังไม่ได้ใส่ APPS_SCRIPT_URL บน localhost)
   รันโค้ด backend จริง (apps-script/*.gs) ในเบราว์เซอร์ด้วยบริการ Google จำลอง (dev/gas-fakes.js)
   ข้อมูลเก็บใน localStorage · มีข้อมูลย้อนหลัง 7 วันจากเครื่องวัดจำลอง · LINE/อีเมลไม่ได้ส่งจริง (ดูได้ที่ ตั้งค่า > บันทึกการแจ้งเตือน)
   ===================================================== */
const MockAPI = (() => {
  const KEY = 'gpp_mock_state_v3';
  const ROLE_KEY = 'gpp_mock_role';
  const GS = ['Code.gs', 'Store.gs', 'Providers.gs', 'Poller.gs', 'Alerts.gs', 'Reports.gs', 'ReportGrid.gs'];
  const MIN = 60000;
  let G = null, fakes = null, state = null;

  const SENSORS = [
    ['mock-room-1', '05 เมืองใหม่นายอาม', 'ห้องขายยา', 'room'],
    ['mock-store-1', '05 เมืองใหม่นายอาม', 'ห้องเก็บยา', 'room'],
    ['mock-fridge-1', '05 เมืองใหม่นายอาม', 'ตู้เย็นยา', 'fridge'],
    ['mock-room-2', '12 ทับช้าง', 'ห้องขายยา', 'room'],
    ['mock-fridge-2x', '12 ทับช้าง', 'ตู้เย็นยา', 'fridge'],
    ['mock-room-3', '25 แกลง', 'ห้องขายยา', 'room'],
    ['mock-fridge-3', '25 แกลง', 'ตู้เย็นยา', 'fridge'],
  ];
  const hex = c => c.repeat(32);

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('mock state not saved', e); }
  }

  function boot(saved) {
    state = saved || { files: {}, props: {}, seq: 1, activeId: null, folders: {}, cache: {} };
    state.cache = state.cache || {};
    fakes = GasFakes.createGasFakes({
      state, cache: state.cache, keepBlobs: true,
      http: req => (/api\.line\.me/.test(req.url) ? { code: 200, body: /quota\/consumption/.test(req.url) ? { totalUsage: 41 } : /quota/.test(req.url) ? { type: 'limited', value: 300 } : {} } : { code: 404, body: '{}' }),
    });
    return Promise.all(GS.map(f => fetch('apps-script/' + f, { cache: 'no-cache' }).then(r => r.text())))
      .then(srcs => { G = GasFakes.loadGas(srcs, fakes); });
  }

  function seed() {
    G.setup();
    const P = fakes.globals.PropertiesService.getScriptProperties();
    P.setProperty('LINE_CHANNEL_TOKEN', 'mock-token');
    P.setProperty('APP_URL', location.origin + location.pathname);
    P.setProperty('ALERT_EMAILS', 'pharmacist@example.com');
    G.resetTableCache();
    const acc = G.readTable('accounts', true);
    acc.rows[0].active = true;
    G.saveRow(acc, acc.rows[0]);
    SENSORS.forEach(([deviceId, branch, location, zoneType]) => {
      G.resetTableCache();
      G.saveSensor({ accountId: 'MOCK', deviceId, branch, location, zoneType, active: true });
    });
    G.resetTableCache();
    G.saveLineTarget({ branch: '05 เมืองใหม่นายอาม', groupId: 'C' + hex('5'), label: 'กลุ่ม LINE สาขา 05' });
    G.saveLineTarget({ branch: '12 ทับช้าง', groupId: 'C' + hex('c'), label: 'กลุ่ม LINE สาขา 12' });
    G.saveLineTarget({ branch: '*', groupId: 'C' + hex('a'), label: 'กลุ่มเภสัชกรส่วนกลาง' });
    G.appendRows(G.readTable('linePending'), [{ ts: Date.now() - 3600000, groupId: 'C' + hex('e'), type: 'join', text: '' }]);

    // ข้อมูลย้อนหลัง 7 วัน (รอบละ 15 นาที) — ช่วง 80 นาทีล่าสุด ห้องขายยาสาขาแกลงขาดการเชื่อมต่อ
    const now = Date.now();
    const start = Math.floor((now - 7 * 86400000) / (15 * MIN)) * 15 * MIN;
    for (let t = start; t <= now; t += 15 * MIN) {
      P.setProperty('MOCK_FORCE', now - t < 80 * MIN ? '{"mock-room-3":"offline"}' : '{}');
      G.runPoll(t, { silent: now - t > 6 * 3600000 });
    }
    // บันทึกการแก้ไขให้เหตุการณ์เก่า (เว้นรายการล่าสุดไว้ให้ทดลองกดเอง)
    G.resetTableCache();
    const ex = G.readTable('excursions', true);
    const notes = ['ปิดประตูตู้เย็นให้สนิท ตรวจสอบสภาพยาแล้ว ไม่พบความผิดปกติ', 'แจ้งช่างตรวจเครื่องปรับอากาศ ย้ายยาที่ไวต่อความร้อนไปห้องเก็บยา', 'เปลี่ยนถ่านเครื่องวัด'];
    ex.rows.forEach((e, i) => {
      if (e.status !== 'closed' || now - G.toMs(e.end) < 30 * 3600000) return;
      e.correctiveAction = notes[i % notes.length];
      e.ackBy = 'ภก.ทดสอบ <pharmacist@example.com>';
      e.ackAt = G.toMs(e.end) + 40 * MIN;
      G.saveRow(ex, e);
    });
    G.resetTableCache();
    G.sendDailySummary(now);
  }

  const ready = (async () => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    await boot(saved);
    if (!saved) { seed(); save(); }
  })();

  // จำลอง time trigger: ดึงค่าทุก 15 นาทีขณะเปิดหน้าเว็บ
  setInterval(async () => {
    await ready;
    const P = fakes.globals.PropertiesService.getScriptProperties();
    if (Date.now() - Number(P.getProperty('LAST_POLL_AT') || 0) >= 15 * MIN) { G.runPoll(Date.now()); save(); }
  }, 60000);

  function wrap(fn) {
    try {
      const r = fn();
      save();
      return JSON.parse(JSON.stringify(r));
    } catch (e) {
      if (!e.code) console.error(e);
      return { ok: false, error: e.code || 'server_error', message: e.message };
    }
  }

  return {
    async call(body) {
      await ready;
      await new Promise(r => setTimeout(r, 120));   // หน่วงเหมือนเรียกเซิร์ฟเวอร์จริง
      G.resetTableCache();
      if (body.action === 'login') {
        const role = body.mockRole || localStorage.getItem(ROLE_KEY) || 'admin';
        localStorage.setItem(ROLE_KEY, role);
        const profile = role === 'admin'
          ? { email: 'goodyearzph@gmail.com', name: 'แอดมิน (ทดสอบ)', picture: '' }
          : { email: 'staff05@example.com', name: 'พนักงานสาขา 05 (ทดสอบ)', picture: '' };
        if (role === 'staff') {
          const sh = fakes.globals.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
          if (!sh.getDataRange().getValues().some(r => r[0] === profile.email)) sh.appendRow([profile.email, '05 เมืองใหม่นายอาม', new Date().toISOString(), 'user', 'approved']);
        }
        return wrap(() => G.startSession(profile));
      }
      return wrap(() => G.route(body));
    },
    // ทดลองบังคับค่าเครื่องจำลอง เช่น MockAPI.force({'mock-fridge-1': 11}) แล้วกด "ดึงค่าเดี๋ยวนี้" 2 ครั้ง
    async force(map) {
      await ready;
      fakes.globals.PropertiesService.getScriptProperties().setProperty('MOCK_FORCE', JSON.stringify(map || {}));
      save();
    },
    reset() { localStorage.removeItem(KEY); localStorage.removeItem(ROLE_KEY); },
  };
})();
