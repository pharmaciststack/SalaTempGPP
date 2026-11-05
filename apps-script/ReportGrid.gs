// =====================================================
// ReportGrid.gs — ค่าตั้งกราฟ (Console ปรับกราฟ) + กราฟรายงาน
//   แบบ 'v' กราฟเส้น (SVG): แกน X = วันที่ × รอบเวลา, แกนซ้าย = อุณหภูมิ, แกนขวา = ความชื้น
//   แบบ 'h' ตาราง: แกน X = อุณหภูมิ/ความชื้นแบ่งเป็นช่อง, แกน Y = วันที่ × รอบเวลา (ไม่ใช้ SVG)
// ไฟล์นี้ไม่มีการเรียกบริการของ Google — หน้าเว็บโหลดไฟล์นี้ไปใช้ด้วย (ห้ามอ้างถึงฟังก์ชันในไฟล์อื่น)
// =====================================================

// ค่าเริ่มต้นของ Console ปรับกราฟ (ค่าที่บันทึกแล้วอยู่ใน Script Property CHART_SETTINGS)
const DEFAULT_CHART_SETTINGS = {
  // รอบเวลาอ่านค่า — ใช้ค่าแรกที่อ่านได้ในแต่ละช่วง [from, to)
  slots: [
    { label: 'เช้า', short: 'ช', from: '08:00', to: '09:30' },
    { label: 'บ่าย', short: 'บ', from: '13:00', to: '14:00' },
  ],
  // สเกลแกนอุณหภูมิตามประเภทพื้นที่ (ประเภทที่ไม่มีในนี้ใช้ของ room)
  scales: {
    room:   { min: 20, max: 35, step: 1 },
    fridge: { min: 0,  max: 12, step: 0.5 },
  },
  hum: { min: 20, max: 100, step: 10 },
  autoExpand: true,   // ขยายสเกลอัตโนมัติเมื่อค่าที่วัดได้/เกณฑ์อยู่นอกสเกล
  orient: 'v',        // 'v' = กราฟเส้น (A4 แนวนอน) · 'h' = ตาราง (A4 แนวตั้ง)
};
const MAX_SLOTS = 4;
const MAX_RANGE_DAYS = 93;

const GRID_CSS =
  '.gc{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9px;line-height:1.1;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  '.gc th,.gc td{border:1px solid #cfd6d2;padding:0 1px;text-align:center;height:13px;overflow:hidden;white-space:nowrap}' +
  '.gc th{background:#eef5f0;font-weight:600;font-size:8.5px;color:#26332c}' +
  '.gc th.grp{font-size:9.5px;height:16px}' +
  '.gc td.g{background:#ecf9f0}.gc td.w{background:#fff7dc}.gc td.o{background:#fdecec}.gc td.x{background:#fafafa}' +
  '.gc tr.e td{border-bottom:1.6px solid #66726c}' +
  '.gc td.dt{font-weight:700;background:#fff;font-size:10px}.gc td.dt.we{color:#b45309}' +
  '.gc td.tm{color:#4a5550;background:#fff}' +
  '.gc td.v{font-weight:700;background:#fff}.gc td.v.bad{color:#c62828}' +
  '.gc .pt{color:#0b8541;font-size:11px;line-height:1}.gc .pt.bad{color:#c62828}.gc .pt.hm{color:#1d5fbf}' +
  '.gc th.lim{color:#c62828}' +
  '.gc.gv td,.gc.gv th{height:11px;padding:0}.gc.gv th.yl{font-size:8px;text-align:right;padding-right:3px}' +
  '.gc.gv .ds{border-left:1.6px solid #66726c}.gc.gv td.v{font-size:6.5px;font-weight:600}.gc.gv td.tm{font-size:5.5px}' +
  '.gc-svg{display:block;width:100%;height:auto}.gc.gvt{margin-top:2px}.gc.gvt th{background:#fff;border:0}.gc.gvt td.hm{color:#1d5fbf}' +
  '.gc-leg{font-size:10px;color:#4a5550;margin:4px 0 0}.gc-leg b{display:inline-block;width:10px;height:8px;margin:0 3px 0 10px;vertical-align:middle;border:1px solid #cfd6d2}';

// ── ค่าตั้ง ───────────────────────────────────────────
function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v > 1440 ? null : v;
}
function minToHhmm(n) { return ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + (n % 60)).slice(-2); }

// ตรวจและเติมค่าตั้งกราฟ — strict = true โยน Error พร้อมข้อความภาษาไทย (ใช้ตอนบันทึก) · false = ใช้ค่าเริ่มต้นแทนส่วนที่ผิด
function normalizeChartSettings(raw, strict) {
  const D = DEFAULT_CHART_SETTINGS;
  const errs = [];
  raw = raw && typeof raw === 'object' ? raw : {};
  const numOr = (v, d) => (v === '' || v === null || v === undefined || !isFinite(Number(v)) ? d : Number(v));

  let slots = Array.isArray(raw.slots) && raw.slots.length ? raw.slots : D.slots;
  if (slots.length > MAX_SLOTS) errs.push('รอบเวลาได้สูงสุด ' + MAX_SLOTS + ' รอบต่อวัน');
  slots = slots.slice(0, MAX_SLOTS).map((s, i) => {
    const from = hhmmToMin(s.from), to = hhmmToMin(s.to);
    if (from === null || to === null || to <= from) errs.push('รอบที่ ' + (i + 1) + ': เวลาต้องเป็น HH:mm และเวลาสิ้นสุดต้องหลังเวลาเริ่ม');
    const label = String(s.label == null ? '' : s.label).trim().slice(0, 20) || 'รอบ ' + (i + 1);
    const short = String(s.short == null ? '' : s.short).trim().slice(0, 2) || label.charAt(0);
    return { label, short, from: from === null ? '00:00' : minToHhmm(from), to: to === null ? '00:00' : minToHhmm(to), _f: from || 0, _t: to || 0 };
  }).sort((a, b) => a._f - b._f);
  for (let i = 1; i < slots.length; i++) {
    if (slots[i]._f < slots[i - 1]._t) errs.push('ช่วงเวลา "' + slots[i - 1].label + '" กับ "' + slots[i].label + '" ซ้อนกัน');
  }
  slots = slots.map(s => ({ label: s.label, short: s.short, from: s.from, to: s.to }));

  const scale = (r, d, name, maxCols) => {
    r = r || {};
    const o = { min: numOr(r.min, d.min), max: numOr(r.max, d.max), step: numOr(r.step, d.step) };
    if (!(o.max > o.min)) errs.push(name + ': ค่าสูงสุดต้องมากกว่าค่าต่ำสุด');
    else if (!(o.step >= 0.1) || (o.max - o.min) / o.step > maxCols) errs.push(name + ': ช่องละ (step) ต้องอย่างน้อย 0.1 และไม่เกิน ' + maxCols + ' ช่อง');
    return o;
  };
  const scales = {};
  const rawScales = raw.scales && typeof raw.scales === 'object' ? raw.scales : {};
  Object.keys(D.scales).concat(Object.keys(rawScales)).forEach(k => {
    if (scales[k] || !/^[\w-]{1,30}$/.test(k)) return;
    scales[k] = scale(rawScales[k], D.scales[k] || D.scales.room, 'สเกลอุณหภูมิ (' + k + ')', 80);
  });
  const hum = scale(raw.hum, D.hum, 'สเกลความชื้น', 40);
  if (hum.min < 0 || hum.max > 100) errs.push('สเกลความชื้นต้องอยู่ระหว่าง 0–100');

  if (errs.length) {
    if (strict) throw new Error(errs.join(' · '));
    return normalizeChartSettings(D, false);
  }
  return {
    slots, scales, hum,
    autoExpand: raw.autoExpand === undefined ? D.autoExpand : !!raw.autoExpand,
    orient: raw.orient === 'h' ? 'h' : raw.orient === 'v' ? 'v' : D.orient,
  };
}

// รอบที่นาทีนี้ตกอยู่ (-1 = ไม่อยู่ในรอบใด)
function slotIndexOf(settings, minutes) {
  for (let i = 0; i < settings.slots.length; i++) {
    if (minutes >= hhmmToMin(settings.slots[i].from) && minutes < hhmmToMin(settings.slots[i].to)) return i;
  }
  return -1;
}

// ค่าแรกของแต่ละรอบ จากค่าดิบ (เรียงตามเวลา) → { sensorId: { 'yyyy-MM-dd': [ {t,h,ts} | null, ... ] } }
function computeSlotValues(readings, settings, dayOf, minutesOf) {
  const out = {};
  readings.forEach(r => {
    if (r.temp === null || r.temp === undefined || !isFinite(r.temp)) return;
    const i = slotIndexOf(settings, minutesOf(r.ts));
    if (i < 0) return;
    const bySensor = out[r.sensorId] = out[r.sensorId] || {};
    const d = dayOf(r.ts);
    const arr = bySensor[d] = bySensor[d] || settings.slots.map(() => null);
    if (!arr[i] || r.ts < arr[i].ts) arr[i] = { t: r.temp, h: r.hum === undefined ? null : r.hum, ts: r.ts };
  });
  return out;
}

// รายการวันที่ 'yyyy-MM-dd' ตั้งแต่ from ถึง to
function dateRange(from, to) {
  const out = [];
  const p = s => s.split('-').map(Number);
  const a = p(from), b = p(to);
  for (let t = Date.UTC(a[0], a[1] - 1, a[2]); t <= Date.UTC(b[0], b[1] - 1, b[2]) && out.length <= 400; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// ── กราฟ ──────────────────────────────────────────────
// p = { settings, zoneType, limits:{tMin,tMax,tWarn,hMax}, dates:['yyyy-MM-dd'], values:{ date: [ {t,h,ts}|null per slot ] },
//       today:'yyyy-MM-dd', fmtTime: ms => 'HH:mm', showHum: bool (ตาราง: แสดงคอลัมน์ความชื้น), orient: 'v' | 'h' }
function gridChartHtml(p) {
  const S = normalizeChartSettings(p.settings, false);
  const lim = p.limits || {};
  const has = v => v !== null && v !== undefined && v !== '' && isFinite(v);
  const r1 = v => Math.round(v * 10) / 10;
  const fmt1 = v => (has(v) ? Number(v).toFixed(1) : '');
  const escH = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nS = S.slots.length;
  const values = p.values || {};
  const dates = p.dates || [];

  // ช่องข้อมูล: ทุกวัน × ทุกรอบ
  const slots = [];
  dates.forEach((date, di) => {
    const arr = values[date] || [];
    const parts = date.split('-').map(Number);
    const dow = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    S.slots.forEach((sl, si) => {
      const v = arr[si] || null;
      slots.push({
        date, di, day: parts[2], month: parts[1], si, future: !!(p.today && date > p.today), we: dow === 0 || dow === 6,
        t: v && has(v.t) ? Number(v.t) : null, h: v && has(v.h) ? Number(v.h) : null, ts: v ? v.ts : null,
      });
    });
  });
  const dayLabel = x => (x.di === 0 || x.day === 1 ? x.day + '/' + x.month : String(x.day));

  // สเกลอุณหภูมิ
  const sc = S.scales[p.zoneType] || S.scales.room;
  let step = sc.step, lo = sc.min, hi = sc.max;
  if (S.autoExpand) {
    [lim.tMin, lim.tMax, lim.tWarn].concat(slots.map(x => x.t)).forEach(v => {
      if (!has(v)) return;
      lo = Math.min(lo, Math.floor((v - step) / step) * step);
      hi = Math.max(hi, Math.ceil((v + step) / step) * step);
    });
  }
  while ((hi - lo) / step > 80) step *= 2;
  lo = Math.floor(lo / step + 1e-9) * step;
  const tCols = [];
  for (let v = lo; v <= hi + 1e-9; v += step) tCols.push(r1(v));
  const hStep = S.hum.step;
  const hCols = [];
  for (let v = S.hum.min; v <= S.hum.max + 1e-9; v += hStep) hCols.push(r1(v));

  const tCls = c => {
    if ((has(lim.tMax) && c > lim.tMax) || (has(lim.tMin) && c < lim.tMin)) return 'o';
    if (has(lim.tWarn) && c > lim.tWarn) return 'w';
    return 'g';
  };
  const hCls = c => (has(lim.hMax) && c > lim.hMax ? 'w' : 'g');
  const tBad = v => (has(lim.tMax) && v > lim.tMax) || (has(lim.tMin) && v < lim.tMin);
  const idx = (cols, s, v) => Math.max(0, Math.min(cols.length - 1, Math.round((v - cols[0]) / s)));
  const rangeTxt = has(lim.tMin) && has(lim.tMax) ? lim.tMin + '–' + lim.tMax + '°C' : has(lim.tMax) ? 'ไม่เกิน ' + lim.tMax + '°C' : has(lim.tMin) ? 'ไม่ต่ำกว่า ' + lim.tMin + '°C' : '';
  const labelEvery = tCols.length > 30 ? 2 : 1;   // ช่องเยอะ → แสดงตัวเลขเว้นช่อง
  const tLabel = c => (step < 1 ? (c % 1 === 0 ? String(c) : '') : (Math.round((c - lo) / step) % labelEvery === 0 ? String(c) : ''));
  const limitCol = c => (has(lim.tMax) && Math.abs(c - lim.tMax) < 1e-9) || (has(lim.tMin) && Math.abs(c - lim.tMin) < 1e-9);
  const slotsTxt = S.slots.map(s => escH(s.short) + ' = ' + escH(s.label) + ' ' + s.from + '–' + s.to).join(' · ');

  if ((p.orient || S.orient) === 'v') {
    // ── กราฟเส้น (SVG) ──
    const n = Math.max(1, slots.length);
    const L = 46, R = 40, HT = 30, PH = 300;
    const W = Math.max(1000, L + R + n * 10), H = HT + PH + 8;
    const sw = (W - L - R) / n, PW = W - L - R;
    const tLo = tCols[0], tHi = tCols[tCols.length - 1];
    const yT = v => HT + (tHi - Math.max(tLo, Math.min(tHi, v))) / (tHi - tLo) * PH;
    const hasH = slots.some(x => x.h != null);
    const hLo = S.hum.min, hHi = S.hum.max;
    const yH = v => HT + (hHi - Math.max(hLo, Math.min(hHi, v))) / (hHi - hLo) * PH;
    const xC = k => L + (k + 0.5) * sw;
    const f = v => Math.round(v * 10) / 10;
    let g = '';
    const band = (top, bottom, color) => {
      const y1 = yT(Math.min(tHi, top)), y2 = yT(Math.max(tLo, bottom));
      if (y2 > y1) g += '<rect x="' + L + '" y="' + f(y1) + '" width="' + PW + '" height="' + f(y2 - y1) + '" fill="' + color + '"/>';
    };
    const top = has(lim.tMax) ? lim.tMax : tHi;
    if (has(lim.tMax)) band(tHi, lim.tMax, '#fdecec');
    let greenTop = top;
    if (has(lim.tWarn) && lim.tWarn < top) { band(top, lim.tWarn, '#fff7dc'); greenTop = lim.tWarn; }
    band(greenTop, has(lim.tMin) ? lim.tMin : tLo, '#ecf9f0');
    if (has(lim.tMin)) band(lim.tMin, tLo, '#fdecec');
    const firstFuture = slots.findIndex(x => x.future);
    if (firstFuture >= 0) g += '<rect x="' + f(L + firstFuture * sw) + '" y="' + HT + '" width="' + f((n - firstFuture) * sw) + '" height="' + PH + '" fill="#f6f7f7"/>';
    // เส้นตาราง
    tCols.forEach(c => {
      const major = tLabel(c) !== '';
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + f(yT(c)) + '" y2="' + f(yT(c)) + '" stroke="' + (major ? '#c3cbc7' : '#e1e6e3') + '" stroke-width="' + (major ? 0.8 : 0.5) + '"/>';
      if (major) g += '<text x="' + (L - 5) + '" y="' + f(yT(c) + 3.5) + '" font-size="10" text-anchor="end" fill="' + (limitCol(c) ? '#c62828' : '#4a5550') + '">' + c + '</text>';
    });
    const groupW = sw * nS;
    const every = Math.max(1, Math.ceil(16 / groupW));
    for (let k = 0; k <= n; k++) {
      const day = k % nS === 0;
      if (!day && sw < 4) continue;
      g += '<line x1="' + f(L + k * sw) + '" x2="' + f(L + k * sw) + '" y1="' + (day ? 2 : 16) + '" y2="' + (HT + PH) + '" stroke="' + (day ? '#8a948f' : '#e1e6e3') + '" stroke-width="' + (day ? 0.9 : 0.5) + '"/>';
    }
    slots.forEach((x, k) => {
      if (x.si === 0 && (x.di % every === 0 || x.day === 1)) {
        g += '<text x="' + f(L + k * sw + groupW / 2) + '" y="12" font-size="10" font-weight="700" text-anchor="middle" fill="' + (x.we ? '#b45309' : '#17201b') + '">' + dayLabel(x) + '</text>';
      }
      if (sw >= 8) g += '<text x="' + f(xC(k)) + '" y="26" font-size="7.5" text-anchor="middle" fill="#7b8682">' + escH(S.slots[x.si].short) + '</text>';
    });
    g += '<text x="4" y="12" font-size="9" fill="#4a5550">วันที่</text><text x="4" y="26" font-size="9" fill="#0b8541" font-weight="700">°C</text>';
    if (hasH) {
      g += '<text x="' + (W - 2) + '" y="26" font-size="9" text-anchor="end" fill="#1d5fbf" font-weight="700">%RH</text>';
      hCols.forEach(v => { g += '<text x="' + (W - R + 5) + '" y="' + f(yH(v) + 3.5) + '" font-size="10" fill="#1d5fbf">' + v + '</text>'; });
    }
    const hline = (y, color, dash, w) => '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + f(y) + '" y2="' + f(y) + '" stroke="' + color + '" stroke-width="' + w + '" stroke-dasharray="' + dash + '"/>';
    if (has(lim.tMax)) g += hline(yT(lim.tMax), '#c62828', '6 4', 1.3);
    if (has(lim.tMin)) g += hline(yT(lim.tMin), '#c62828', '6 4', 1.3);
    if (hasH && has(lim.hMax)) g += hline(yH(lim.hMax), '#1d5fbf', '2 3', 1);
    // เส้นข้อมูล — ลากต่อจุดของรอบที่ติดกัน (ขาดเส้นเมื่อรอบใดไม่มีค่า)
    const path = (key, y) => {
      let d = '', prev = -2;
      slots.forEach((x, k) => {
        if (x[key] == null) return;
        d += (prev === k - 1 ? 'L' : 'M') + f(xC(k)) + ' ' + f(y(x[key]));
        prev = k;
      });
      return d;
    };
    const dot = Math.max(1.6, Math.min(3.2, sw / 3));
    if (hasH) {
      g += '<path class="ln-h" d="' + path('h', yH) + '" fill="none" stroke="#1d5fbf" stroke-width="1.6" stroke-dasharray="5 3" stroke-linejoin="round"/>';
      slots.forEach((x, k) => { if (x.h != null) g += '<rect class="pt-h" x="' + f(xC(k) - dot * 0.7) + '" y="' + f(yH(x.h) - dot * 0.7) + '" width="' + f(dot * 1.4) + '" height="' + f(dot * 1.4) + '" fill="#1d5fbf"/>'; });
    }
    g += '<path class="ln-t" d="' + path('t', yT) + '" fill="none" stroke="#0b8541" stroke-width="2" stroke-linejoin="round"/>';
    slots.forEach((x, k) => {
      if (x.t != null) g += '<circle class="pt-t' + (tBad(x.t) ? ' bad' : '') + '" cx="' + f(xC(k)) + '" cy="' + f(yT(x.t)) + '" r="' + f(dot) + '" fill="' + (tBad(x.t) ? '#c62828' : '#0b8541') + '" stroke="#fff" stroke-width="1"/>';
    });
    g += '<rect x="' + L + '" y="' + HT + '" width="' + PW + '" height="' + PH + '" fill="none" stroke="#66726c" stroke-width="1"/>';
    const svg = '<svg class="gc-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" font-family="Sarabun, Noto Sans Thai, sans-serif" role="img" aria-label="กราฟอุณหภูมิและความชื้น">' + g + '</svg>';

    // ตารางตัวเลขใต้กราฟ (ถ้าช่องกว้างพอให้อ่านได้)
    let t = '';
    if (n <= 124) {
      t = '<colgroup><col style="width:' + (L / W * 100) + '%">' + slots.map(() => '<col>').join('') + '<col style="width:' + (R / W * 100) + '%"></colgroup>';
      const row = (label, cells, cls) => '<tr><th class="yl">' + label + '</th>' + cells.map((c, k) => '<td class="' + cls(k) + (k % nS === 0 ? ' ds' : '') + '">' + c + '</td>').join('') + '<th></th></tr>';
      t += row('°C', slots.map(x => fmt1(x.t)), k => 'v' + (slots[k].t != null && tBad(slots[k].t) ? ' bad' : ''));
      if (hasH) t += row('%RH', slots.map(x => (x.h == null ? '' : Math.round(x.h))), () => 'v hm');
      t += row('เวลา', slots.map(x => (x.ts && p.fmtTime ? escH(p.fmtTime(x.ts)) : '')), () => 'tm');
      t = '<table class="gc gv gvt">' + t + '</table>';
    }
    const sample = inner => '<svg width="26" height="8" style="vertical-align:middle">' + inner + '</svg>';
    const leg = '<div class="gc-leg">' + sample('<line x1="0" x2="26" y1="4" y2="4" stroke="#0b8541" stroke-width="2"/><circle cx="13" cy="4" r="3" fill="#0b8541"/>') + ' อุณหภูมิ (แกนซ้าย °C)' +
      (hasH ? ' &nbsp; ' + sample('<line x1="0" x2="26" y1="4" y2="4" stroke="#1d5fbf" stroke-width="1.6" stroke-dasharray="5 3"/><rect x="11" y="2" width="4" height="4" fill="#1d5fbf"/>') + ' ความชื้น (แกนขวา %RH)' : '') +
      ' &nbsp; ' + sample('<line x1="0" x2="26" y1="4" y2="4" stroke="#c62828" stroke-width="1.3" stroke-dasharray="6 4"/>') + ' เกณฑ์' + (rangeTxt ? ' ' + escH(rangeTxt) : '') +
      ' · ' + slotsTxt + ' น. · <span style="color:#c62828">●</span> นอกเกณฑ์' + (n > 124 ? ' · ดูตัวเลขในตารางสรุปรายวัน' : '') + '</div>';
    return '<div class="gc-wrap">' + svg + t + leg + '</div>';
  }

  // ── ตาราง: แกน X = อุณหภูมิ/ความชื้น, แกน Y = วันที่ × รอบ ──
  const showHum = !!p.showHum;
  let colg = '<colgroup><col style="width:5%"><col style="width:6%">' + tCols.map(() => '<col>').join('') + '<col style="width:5%">';
  if (showHum) colg += hCols.map(() => '<col>').join('') + '<col style="width:4.5%">';
  colg += '</colgroup>';
  let head = '<tr><th rowspan="2">วันที่</th><th rowspan="2">เวลา</th>' +
    '<th class="grp" colspan="' + tCols.length + '">อุณหภูมิ (°C)' + (rangeTxt ? ' · เกณฑ์ ' + escH(rangeTxt) : '') + '</th><th rowspan="2">°C</th>';
  if (showHum) head += '<th class="grp" colspan="' + hCols.length + '">ความชื้น (%RH)' + (has(lim.hMax) ? ' · ไม่เกิน ' + lim.hMax + '%' : '') + '</th><th rowspan="2">%RH</th>';
  head += '</tr><tr>' + tCols.map(c => '<th' + (limitCol(c) ? ' class="lim"' : '') + '>' + tLabel(c) + '</th>').join('');
  if (showHum) head += hCols.map(c => '<th>' + c + '</th>').join('');
  head += '</tr>';
  let body = '';
  slots.forEach(x => {
    let row = '<tr' + (x.si === nS - 1 ? ' class="e"' : '') + '>';
    if (x.si === 0) row += '<td class="dt' + (x.we ? ' we' : '') + '" rowspan="' + nS + '">' + dayLabel(x) + '</td>';
    row += '<td class="tm">' + (x.ts && p.fmtTime ? escH(p.fmtTime(x.ts)) : escH(S.slots[x.si].label)) + '</td>';
    const ti = x.t == null ? -1 : idx(tCols, step, x.t);
    row += tCols.map((c, i) => '<td class="' + (x.future ? 'x' : tCls(c)) + '">' +
      (i === ti ? '<span class="pt' + (tBad(x.t) ? ' bad' : '') + '">●</span>' : '') + '</td>').join('');
    row += '<td class="v' + (x.t != null && tBad(x.t) ? ' bad' : '') + '">' + fmt1(x.t) + '</td>';
    if (showHum) {
      const hi2 = x.h == null ? -1 : idx(hCols, hStep, x.h);
      row += hCols.map((c, i) => '<td class="' + (x.future ? 'x' : hCls(c)) + '">' + (i === hi2 ? '<span class="pt hm">●</span>' : '') + '</td>').join('');
      row += '<td class="v">' + (x.h == null ? '' : Math.round(x.h)) + '</td>';
    }
    body += row + '</tr>';
  });
  const legend = '<div class="gc-leg">' + slotsTxt + ' น. (ช่องเวลาแสดงเวลาที่วัดจริง)<b style="background:#ecf9f0"></b>อยู่ในเกณฑ์' +
    (has(lim.tWarn) ? '<b style="background:#fff7dc"></b>เฝ้าระวัง' : '') + '<b style="background:#fdecec"></b>นอกเกณฑ์' +
    ' · <span style="color:#c62828">●</span> ค่านอกเกณฑ์</div>';
  return '<table class="gc">' + colg + head + body + '</table>' + legend;
}
