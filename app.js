/* =====================================================
   Sala-TempGPP — ส่วนการทำงานของหน้าเว็บ (โหลดหลัง config.js)
   ===================================================== */

// ==================== Constants ====================
const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const MOCK = IS_LOCAL && (new URLSearchParams(location.search).has('mock') || !/^https:\/\//.test(APPS_SCRIPT_URL));
const SESSION_KEY = MOCK ? 'gpp_session_mock' : 'gpp_session';
const TZ = 'Asia/Bangkok';
const S = { session: null, user: null, tab: 'overview', ov: null, filter: 'all', q: '', excMode: 'pending', admin: null, timer: null };

const STATE = {
  ok:       { label: 'ปกติ',             icon: 'check' },
  warn:     { label: 'เฝ้าระวัง',         icon: 'alert' },
  alarm:    { label: 'ผิดเกณฑ์',          icon: 'alert' },
  offline:  { label: 'ขาดการเชื่อมต่อ',    icon: 'wifiOff' },
  pending:  { label: 'รอข้อมูล',          icon: 'clock' },
  inactive: { label: 'ปิดใช้งาน',         icon: 'clock' },
};
const RANK = { alarm: 4, offline: 3, warn: 2, pending: 1, ok: 0, inactive: -1 };
const EXC_TYPE = { high: 'สูงกว่าเกณฑ์', low: 'ต่ำกว่าเกณฑ์', offline: 'ขาดการเชื่อมต่อ' };

// ไอคอน (Lucide, ISC License)
const ICONS = {
  thermo: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  battery: '<rect width="16" height="10" x="2" y="7" rx="2"/><line x1="22" x2="22" y1="11" y2="13"/>',
  wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  snow: '<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
};
const icon = (n, cls) => `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

// ==================== Helpers ====================
const $ = id => document.getElementById(id);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const branchCode = b => { const m = /^\s*(\d{1,2})(?!\d)/.exec(String(b || '')); return m ? ('0' + m[1]).slice(-2) : ''; };
const t1 = v => (v == null || v === '' ? '–' : Number(v).toFixed(1));
const isAdmin = () => S.user && S.user.role === 'admin';
const fmtParts = (ms, o) => new Intl.DateTimeFormat('th-TH', Object.assign({ timeZone: TZ }, o)).format(new Date(ms));
const fmtTime = ms => (ms ? fmtParts(ms, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '–');
const fmtDate = ms => (ms ? fmtParts(ms, { day: 'numeric', month: 'short' }) : '–');
const fmtDateTime = ms => (ms ? fmtDate(ms) + ' ' + fmtTime(ms) : '–');
const dayKey = ms => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms));
const monthKey = ms => dayKey(ms).slice(0, 7);
function ago(ms) {
  if (!ms) return 'ยังไม่มีข้อมูล';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return m + ' นาทีที่แล้ว';
  if (m < 1440) return Math.floor(m / 60) + ' ชม.ที่แล้ว';
  return fmtDateTime(ms);
}
function duration(min) {
  min = Math.round(Number(min) || 0);
  if (min < 60) return min + ' นาที';
  const h = Math.floor(min / 60), m = min % 60;
  if (h >= 48) return Math.floor(h / 24) + ' วัน ' + (h % 24) + ' ชม.';
  return h + ' ชม.' + (m ? ' ' + m + ' นาที' : '');
}
function rangeText(l) {
  if (!l) return '–';
  if (l.tMin != null && l.tMax != null) return l.tMin + '–' + l.tMax + '°C';
  if (l.tMax != null) return '≤ ' + l.tMax + '°C';
  if (l.tMin != null) return '≥ ' + l.tMin + '°C';
  return '–';
}
const thaiMonth = m => new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(new Date(m + '-15T00:00:00'));
const branchOptions = (sel, placeholder) => (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') +
  BRANCH_LIST.map(b => `<option${b === sel ? ' selected' : ''}>${esc(b)}</option>`).join('');

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'err' ? ' err' : '');
  el.textContent = msg;
  $('toast-root').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 5000 : 2800);
}

async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.html = btn.innerHTML; btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>'; }
  try { return await fn(); } finally { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.html; } }
}

// ==================== API ====================
async function api(action, payload = {}) {
  const body = Object.assign({ action, session: S.session }, payload);
  let res;
  try {
    if (MOCK) res = await MockAPI.call(body);
    else {
      const r = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
      res = await r.json();
    }
  } catch (e) {
    console.error(e);
    res = { ok: false, error: 'network', message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' };
  }
  if (!res.ok && res.error === 'unauthorized' && action !== 'login') {
    clearSession();
    showLogin('หมดเวลาการเข้าสู่ระบบ กรุณาเข้าสู่ระบบอีกครั้ง');
  }
  return res;
}
const errMsg = r => r.message || ({ forbidden: 'ไม่มีสิทธิ์ทำรายการนี้', network: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' }[r.error]) || r.error || 'เกิดข้อผิดพลาด';

// ==================== Auth ====================
function saveSession(session, expiresAt) { S.session = session; try { localStorage.setItem(SESSION_KEY, JSON.stringify({ session, expiresAt })); } catch (e) {} }
function clearSession() { S.session = null; try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
function loadSession() {
  try { const o = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return o && o.expiresAt > Date.now() + 60000 ? o.session : null; } catch (e) { return null; }
}

function showOnly(id) {
  ['boot', 'login-screen', 'register-screen', 'pending-screen', 'app'].forEach(x => $(x).classList.toggle('hidden', x !== id));
}

function showLogin(message) {
  showOnly('login-screen');
  $('login-checking').classList.add('hidden');
  $('login-msg').textContent = message || '';
  $('login-msg').classList.toggle('hidden', !message);
  if (MOCK) { $('mock-login').classList.remove('hidden'); return; }
  loadScript('https://accounts.google.com/gsi/client').then(() => {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential, auto_select: true });
    google.accounts.id.renderButton($('g-btn'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'th', width: 280 });
  }).catch(() => { $('login-msg').textContent = 'โหลด Google Sign-In ไม่ได้'; $('login-msg').classList.remove('hidden'); });
}

async function onGoogleCredential(resp) {
  $('login-checking').classList.remove('hidden');
  const r = await api('login', { idToken: resp.credential });
  if (!r.ok) return showLogin('เข้าสู่ระบบไม่สำเร็จ: ' + errMsg(r));
  saveSession(r.session, r.expiresAt);
  afterAuth(r.user);
}

async function mockLogin(role) {
  $('login-checking').classList.remove('hidden');
  const r = await api('login', { mockRole: role });
  if (!r.ok) return showLogin(errMsg(r));
  saveSession(r.session, r.expiresAt);
  afterAuth(r.user);
}

function afterAuth(user) {
  S.user = user;
  if (!user.registered) {
    $('reg-email').textContent = user.email;
    $('reg-branch').innerHTML = branchOptions(user.branch, '-- เลือกสาขา --');
    showOnly('register-screen');
  } else if (user.status !== 'approved') {
    $('pending-email').textContent = user.email;
    showOnly('pending-screen');
  } else {
    enterApp();
  }
}

async function submitRegistration(btn) {
  const branch = $('reg-branch').value;
  if (!branch) { $('reg-err').textContent = 'กรุณาเลือกสาขา'; $('reg-err').classList.remove('hidden'); return; }
  await busy(btn, async () => {
    const r = await api('registerUser', { branch });
    if (!r.ok) { $('reg-err').textContent = errMsg(r); $('reg-err').classList.remove('hidden'); return; }
    afterAuth(r.user);
  });
}

async function recheck(btn) {
  await busy(btn, async () => {
    const r = await api('me');
    if (r.ok) { if (r.user.status !== 'approved') toast('ยังไม่ได้รับการอนุมัติ'); afterAuth(r.user); }
  });
}

function signOut(skipConfirm) {
  if (!skipConfirm && !confirm('ต้องการออกจากระบบ?')) return;
  api('logout');
  clearSession();
  try { google.accounts.id.disableAutoSelect(); } catch (e) {}
  location.reload();
}

function mockReset() {
  if (!confirm('ล้างข้อมูลทดสอบทั้งหมดแล้วสร้างใหม่?')) return;
  MockAPI.reset();
  clearSession();
  location.reload();
}

function userMenu() {
  const u = S.user;
  openModal(`
    <div class="modal narrow">
      <div class="modal-head"><div style="flex:1"><h2>${esc(u.name || u.email)}</h2><p>${esc(u.email)}</p></div>${closeBtn()}</div>
      <div class="modal-body">
        <dl class="kv">
          <dt>สิทธิ์</dt><dd>${u.role === 'admin' ? 'แอดมิน (ดูได้ทุกสาขา)' : 'พนักงาน'}</dd>
          <dt>สาขา</dt><dd>${esc(u.branch || '–')}</dd>
          <dt>เวอร์ชัน</dt><dd>v${esc(APP_VERSION)}${MOCK ? ' (ทดสอบ)' : ''}</dd>
        </dl>
      </div>
      <div class="modal-foot"><button class="btn btn-danger" onclick="signOut()">${icon('logout')} ออกจากระบบ</button></div>
    </div>`);
}

// ==================== App shell ====================
function enterApp() {
  showOnly('app');
  $('mock-banner').classList.toggle('hidden', !MOCK);
  const u = S.user;
  $('user-name').textContent = u.name || u.email;
  $('user-avatar').innerHTML = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : esc((u.name || u.email || '?').trim()[0].toUpperCase());
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const fromHash = location.hash.slice(1);
  S.tab = ['overview', 'excursions', 'reports', 'chart', 'settings'].includes(fromHash) && (!['settings', 'chart'].includes(fromHash) || isAdmin()) ? fromHash : 'overview';
  renderTabs();
  go(S.tab);
  clearInterval(S.timer);
  S.timer = setInterval(() => { if (S.tab === 'overview' && !document.hidden && !$('modal-root').firstChild) loadOverview(true); }, 60000);
}

function renderTabs() {
  const pending = S.ov ? S.ov.excursions.filter(e => !e.ackAt).length : 0;
  const tabs = [['overview', 'grid', 'ภาพรวม'], ['excursions', 'bell', 'เหตุการณ์'], ['reports', 'file', 'รายงาน']];
  if (isAdmin()) tabs.push(['chart', 'thermo', 'ปรับกราฟ'], ['settings', 'sliders', 'ตั้งค่า']);
  $('tabs').innerHTML = tabs.map(([k, ic, label]) =>
    `<button class="tab${S.tab === k ? ' active' : ''}" role="tab" aria-selected="${S.tab === k}" onclick="go('${k}')">${icon(ic)}${label}${k === 'excursions' && pending ? `<span class="count">${pending}</span>` : ''}</button>`).join('');
}

function go(tab) {
  S.tab = tab;
  history.replaceState(null, '', '#' + tab);
  renderTabs();
  ({ overview: loadOverview, excursions: loadExcursions, reports: renderReports, chart: loadChartConsole, settings: loadSettings })[tab]();
}

async function refreshNow(btn) {
  await busy(btn, async () => {
    if (S.tab === 'overview') await loadOverview(true);
    else go(S.tab);
  });
}

function setSub() {
  const ov = S.ov;
  if (!ov) return;
  $('sub-status').textContent = ov.lastPollAt
    ? 'อัปเดต ' + fmtTime(ov.lastPollAt) + ' · ดึงค่าทุก ' + ov.pollMinutes + ' นาที'
    : 'ยังไม่มีการดึงค่า';
}

// ==================== Overview ====================
async function loadOverview(quiet) {
  if (!quiet || !S.ov) $('view').innerHTML = skeleton();
  const r = await api('overview');
  if (!r.ok) { if (S.tab === 'overview') $('view').innerHTML = errorBox(r); return; }
  S.ov = r;
  setSub();
  renderTabs();
  if (S.tab === 'overview') renderOverview();
}

function skeleton() {
  return '<div class="branches">' + [1, 2, 3].map(() => '<div class="skeleton" style="height:220px"></div>').join('') + '</div>';
}
function errorBox(r) {
  return `<div class="card empty">${icon('alert')}<div>${esc(errMsg(r))}</div><button class="btn btn-secondary" style="margin-top:12px" onclick="go(S.tab)">ลองใหม่</button></div>`;
}

function groupBranches(sensors) {
  const map = {};
  sensors.forEach(s => { (map[s.branch] = map[s.branch] || []).push(s); });
  return Object.keys(map).map(b => {
    const list = map[b].sort((a, c) => a.sensorId.localeCompare(c.sensorId));
    const worst = list.reduce((w, s) => (RANK[s.state] > RANK[w] ? s.state : w), 'ok');
    return { branch: b, sensors: list, worst };
  }).sort((a, b) => (RANK[b.worst] - RANK[a.worst]) || a.branch.localeCompare(b.branch, 'th'));
}

function renderOverview() {
  const ov = S.ov;
  const counts = { all: ov.sensors.length, alarm: 0, warn: 0, offline: 0, ok: 0 };
  ov.sensors.forEach(s => { if (counts[s.state] !== undefined) counts[s.state]++; });
  const q = S.q.trim().toLowerCase();
  const shown = ov.sensors.filter(s =>
    (S.filter === 'all' || s.state === S.filter) &&
    (!q || (s.branch + ' ' + s.location + ' ' + s.sensorId).toLowerCase().includes(q)));
  const pending = ov.excursions.filter(e => !e.ackAt).length;
  const ongoing = ov.excursions.filter(e => e.status === 'open' && e.type !== 'offline').length;
  const chip = (k, label, dot) => `<button class="chip${S.filter === k ? ' active' : ''}" onclick="S.filter='${k}';renderOverview()">${dot ? `<span class="dot st-${k}"></span>` : ''}${label} <span class="n">${counts[k]}</span></button>`;

  let html = '';
  if (ongoing) html += `<div class="notice">${icon('alert')}<div><b>กำลังผิดเกณฑ์ ${ongoing} จุด</b> — ตรวจสอบและแก้ไขทันที</div></div>`;
  if (pending) html += `<div class="notice info" style="cursor:pointer" onclick="S.excMode='pending';go('excursions')">${icon('pencil')}<div>มี <b>${pending} เหตุการณ์</b> รอบันทึกการแก้ไข (หลักฐานสำหรับการตรวจ GPP)</div></div>`;
  html += `<div class="toolbar">
      <div class="search">${icon('search')}<input class="field" id="ov-q" placeholder="ค้นหาสาขา / จุดติดตั้ง" value="${esc(S.q)}" oninput="S.q=this.value;renderOverviewBody()"></div>
      <div class="chips">${chip('all', 'ทั้งหมด')}${chip('alarm', 'ผิดเกณฑ์', 1)}${chip('offline', 'ขาดการเชื่อมต่อ', 1)}${chip('warn', 'เฝ้าระวัง', 1)}${chip('ok', 'ปกติ', 1)}</div>
    </div><div id="ov-body"></div>`;
  $('view').innerHTML = html;
  renderOverviewBody(shown);
}

function renderOverviewBody(shown) {
  const ov = S.ov;
  if (!shown) {
    const q = S.q.trim().toLowerCase();
    shown = ov.sensors.filter(s => (S.filter === 'all' || s.state === S.filter) && (!q || (s.branch + ' ' + s.location + ' ' + s.sensorId).toLowerCase().includes(q)));
  }
  const body = $('ov-body');
  if (!ov.sensors.length) {
    body.innerHTML = `<div class="card empty">${icon('thermo')}<div>ยังไม่มีเซ็นเซอร์${isAdmin() ? ' — เพิ่มได้ที่เมนู ตั้งค่า' : ' ในสาขาของคุณ'}</div></div>`;
    return;
  }
  if (!shown.length) { body.innerHTML = `<div class="card empty">${icon('search')}<div>ไม่พบรายการที่ตรงกับตัวกรอง</div></div>`; return; }
  body.innerHTML = '<div class="branches">' + groupBranches(shown).map(g => `
    <section class="card">
      <div class="branch-head">${icon('pin')}<b>${esc(g.branch)}</b><span class="pill st-${g.worst}">${STATE[g.worst].label}</span></div>
      <div class="tiles">${g.sensors.map(tile).join('')}</div>
    </section>`).join('') + '</div>';
}

function tile(s) {
  const st = STATE[s.state] || STATE.pending;
  const batt = s.battery != null ? `<span class="${s.battery <= 15 ? 'low-batt' : ''}">${icon('battery')}${s.battery}%</span>` : '';
  const today = s.today ? `<span>วันนี้ ${t1(s.today.min)}–${t1(s.today.max)}</span>` : '';
  return `<button class="tile st-${s.state}" onclick="openSensor('${esc(s.sensorId)}')">
    <div class="tile-top">${icon(s.zoneType === 'fridge' ? 'snow' : 'home')}<span class="loc">${esc(s.location)}</span></div>
    <div class="temp">${s.lastTemp == null ? '–' : t1(s.lastTemp)}<small>°C</small></div>
    <div class="meta"><span class="pill">${icon(st.icon)}${st.label}</span>${s.lastHum != null ? `<span>${icon('drop')}${Math.round(s.lastHum)}%</span>` : ''}</div>
    <div class="foot"><span>เกณฑ์ ${rangeText(s.limits)}</span>${today}</div>
    <div class="foot"><span>${icon('clock')}${ago(s.lastTs)}</span>${batt}</div>
  </button>`;
}

// ==================== Sensor detail ====================
async function openSensor(id) {
  const s = (S.ov && S.ov.sensors.find(x => x.sensorId === id)) || (S.admin && S.admin.sensors.find(x => x.sensorId === id));
  if (!s) return;
  const st = STATE[s.state] || STATE.pending;
  const exc = (S.ov ? S.ov.excursions : []).filter(e => e.sensorId === id);
  openModal(`
    <div class="modal">
      <div class="modal-head">
        <div style="flex:1;min-width:0"><h2>${esc(s.location)} <span class="pill st-${s.state}">${st.label}</span></h2>
        <p>${esc(s.branch)} · ${esc(s.limits.zoneLabel)} · ${esc(s.sensorId)}</p></div>
        ${isAdmin() ? `<button class="btn btn-ghost btn-sm" onclick="closeModal();editSensor('${esc(id)}')">${icon('pencil')}แก้ไข</button>` : ''}
        ${closeBtn()}
      </div>
      <div class="modal-body">
        <div class="stats">
          <div class="stat"><span>ล่าสุด · ${esc(ago(s.lastTs))}</span><b>${t1(s.lastTemp)}°C</b></div>
          <div class="stat"><span>เกณฑ์</span><b style="font-size:15px">${rangeText(s.limits)}</b></div>
          <div class="stat"><span>วันนี้ ต่ำสุด–สูงสุด</span><b>${s.today ? t1(s.today.min) + '–' + t1(s.today.max) : '–'}</b></div>
          <div class="stat"><span>ความชื้น / แบตเตอรี่</span><b style="font-size:15px">${s.lastHum != null ? Math.round(s.lastHum) + '%' : '–'} / ${s.battery != null ? s.battery + '%' : '–'}</b></div>
        </div>
        <div class="row"><div class="seg" id="range-seg">
          <button class="active" onclick="loadChart('${esc(id)}',24,this)">24 ชม.</button>
          <button onclick="loadChart('${esc(id)}',72,this)">3 วัน</button>
          <button onclick="loadChart('${esc(id)}',168,this)">7 วัน</button>
          <button onclick="loadChart('${esc(id)}',720,this)">30 วัน</button>
        </div><span class="spacer"></span>
        <div class="legend"><span><i style="background:var(--brand-600)"></i>อุณหภูมิ</span><span><i style="background:#d7f0df;height:8px"></i>ช่วงเกณฑ์</span>${s.limits.tWarn != null ? '<span><i style="background:#e0a100"></i>เฝ้าระวัง</span>' : ''}</div></div>
        <div class="chart-wrap" id="chart"><div class="skeleton" style="height:240px;margin-top:10px"></div></div>
        ${exc.length ? `<h3 class="section-title" style="margin-top:16px">${icon('bell')}เหตุการณ์ที่ยังต้องดำเนินการ</h3><div class="exc-list">${exc.map(excCard).join('')}</div>` : ''}
      </div>
    </div>`);
  loadChart(id, 24);
}

async function loadChart(id, hours, btn) {
  if (btn) { btn.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn)); }
  const box = $('chart');
  if (!box) return;
  box.innerHTML = '<div class="skeleton" style="height:240px;margin-top:10px"></div>';
  const r = await api('history', { sensorId: id, hours });
  if (!$('chart')) return;
  if (!r.ok) { box.innerHTML = `<div class="err">${esc(errMsg(r))}</div>`; return; }
  const s = (S.ov && S.ov.sensors.find(x => x.sensorId === id)) || (S.admin && S.admin.sensors.find(x => x.sensorId === id));
  drawChart(box, r.points, s.limits, r.from, r.to);
}

function drawChart(box, points, lim, from, to) {
  if (!points.length) { box.innerHTML = `<div class="empty">${icon('thermo')}<div>ไม่มีข้อมูลในช่วงนี้</div></div>`; return; }
  const W = 680, H = 250, L = 38, R = 10, T = 12, B = 26;
  const temps = points.map(p => p[1]).filter(v => v != null);
  let lo = Math.min(...temps), hi = Math.max(...temps);
  [lim.tMin, lim.tMax, lim.tWarn].forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  const pad = Math.max(0.8, (hi - lo) * 0.12);
  lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
  const x = t => L + (t - from) / (to - from) * (W - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟอุณหภูมิ">`;
  // ช่วงเกณฑ์
  const bandTop = lim.tMax != null ? y(lim.tMax) : T, bandBot = lim.tMin != null ? y(lim.tMin) : H - B;
  svg += `<rect x="${L}" y="${bandTop}" width="${W - L - R}" height="${Math.max(0, bandBot - bandTop)}" fill="#e3f6ea"/>`;
  // เส้นแกน Y
  const step = (hi - lo) > 16 ? 4 : (hi - lo) > 8 ? 2 : 1;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e4e8e6"/><text x="${L - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#7b8682">${v}</text>`;
  }
  // แกน X
  const span = to - from;
  const tick = span <= 26 * 3600000 ? 4 * 3600000 : span <= 4 * 86400000 ? 12 * 3600000 : span <= 8 * 86400000 ? 86400000 : 5 * 86400000;
  const off = 7 * 3600000;
  for (let t = Math.ceil((from + off) / tick) * tick - off; t <= to; t += tick) {
    const lbl = tick < 86400000 ? fmtTime(t) : fmtDate(t);
    svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}" stroke="#eef1ef"/><text x="${x(t)}" y="${H - 8}" font-size="11" text-anchor="middle" fill="#7b8682">${esc(lbl)}</text>`;
  }
  const hline = (v, color, dash) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${color}" stroke-width="1.2" ${dash ? 'stroke-dasharray="5 4"' : ''}/>`;
  if (lim.tMax != null) svg += hline(lim.tMax, '#c62828', 1);
  if (lim.tMin != null) svg += hline(lim.tMin, '#1d5fbf', 1);
  if (lim.tWarn != null) svg += hline(lim.tWarn, '#e0a100', 1);
  // เส้นข้อมูล (เว้นช่องว่างเมื่อขาดข้อมูลนานกว่า 45 นาที)
  let d = '', prev = null;
  points.forEach(p => {
    if (p[1] == null) return;
    d += (prev && p[0] - prev < 45 * 60000 ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1);
    prev = p[0];
  });
  svg += `<path d="${d}" fill="none" stroke="#0b8541" stroke-width="2" stroke-linejoin="round"/>`;
  points.forEach(p => {
    const bad = p[1] != null && ((lim.tMax != null && p[1] > lim.tMax) || (lim.tMin != null && p[1] < lim.tMin));
    if (bad) svg += `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="2.6" fill="#c62828"/>`;
  });
  svg += `<line id="cx" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#17201b" stroke-width="1" opacity="0"/><circle id="cdot" r="4" fill="#0b8541" stroke="#fff" stroke-width="2" opacity="0"/></svg>`;
  box.innerHTML = svg + '<div class="chart-tip hidden" id="ctip"></div>';
  const el = box.querySelector('svg');
  const move = ev => {
    const rect = el.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) / rect.width * W;
    const t = from + (px - L) / (W - L - R) * (to - from);
    let best = null;
    points.forEach(p => { if (p[1] != null && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p; });
    if (!best) return;
    const cx = x(best[0]), cy = y(best[1]);
    const ln = el.querySelector('#cx'), dot = el.querySelector('#cdot'), tip = $('ctip');
    ln.setAttribute('x1', cx); ln.setAttribute('x2', cx); ln.setAttribute('opacity', '.25');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('opacity', '1');
    tip.classList.remove('hidden');
    tip.textContent = fmtDateTime(best[0]) + ' · ' + t1(best[1]) + '°C' + (best[2] != null ? ' · ' + Math.round(best[2]) + '%' : '');
    tip.style.left = Math.min(Math.max(cx / W * rect.width, 80), rect.width - 80) + 'px';
  };
  el.addEventListener('mousemove', move);
  el.addEventListener('touchmove', move, { passive: true });
  el.addEventListener('mouseleave', () => { $('ctip').classList.add('hidden'); el.querySelector('#cx').setAttribute('opacity', '0'); el.querySelector('#cdot').setAttribute('opacity', '0'); });
}

// ==================== Excursions ====================
async function loadExcursions() {
  const month = monthKey(Date.now());
  $('view').innerHTML = `
    <div class="toolbar">
      <div class="seg">
        <button class="${S.excMode === 'pending' ? 'active' : ''}" onclick="S.excMode='pending';loadExcursions()">รอดำเนินการ</button>
        <button class="${S.excMode === 'month' ? 'active' : ''}" onclick="S.excMode='month';loadExcursions()">ทั้งหมดเดือนนี้</button>
        <button class="${S.excMode === 'prev' ? 'active' : ''}" onclick="S.excMode='prev';loadExcursions()">เดือนก่อน</button>
      </div>
      <span class="muted small">เหตุการณ์ผิดเกณฑ์ทุกครั้งต้องบันทึกการแก้ไขเพื่อใช้เป็นหลักฐานการตรวจ GPP</span>
    </div>
    <div id="exc-body">${skeleton()}</div>`;
  const prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
  const r = await api('excursions', S.excMode === 'pending' ? { pending: true } : { month: S.excMode === 'month' ? month : monthKey(prev.getTime()) });
  if (S.tab !== 'excursions') return;
  if (!r.ok) { $('exc-body').innerHTML = errorBox(r); return; }
  S.excList = r.excursions;
  $('exc-body').innerHTML = r.excursions.length
    ? '<div class="exc-list">' + r.excursions.map(excCard).join('') + '</div>'
    : `<div class="card empty">${icon('check')}<div>${S.excMode === 'pending' ? 'ไม่มีเหตุการณ์ที่รอดำเนินการ' : 'ไม่มีเหตุการณ์ในช่วงนี้'}</div></div>`;
}

function excCard(e) {
  const ic = e.type === 'offline' ? 'wifiOff' : e.type === 'low' ? 'snow' : 'thermo';
  const ongoing = e.status === 'open';
  const mins = ongoing && e.start ? Math.max(e.durationMin || 0, (Date.now() - e.start) / 60000) : e.durationMin;
  const peak = e.type === 'offline' ? (e.maxTemp != null ? 'ค่าก่อนขาดการเชื่อมต่อ ' + t1(e.maxTemp) + '°C' : '')
    : e.type === 'low' ? 'ต่ำสุด ' + t1(e.minTemp) + '°C' : 'สูงสุด ' + t1(e.maxTemp) + '°C';
  return `<div class="card exc">
    <div class="exc-icon ${e.type}">${icon(ic)}</div>
    <div class="exc-main">
      <div class="row"><span class="t">${esc(e.branch)} · ${esc(e.location)}</span>
        <span class="pill ${ongoing ? 'st-alarm' : 'st-offline'}">${ongoing ? 'ยังเกิดอยู่' : 'สิ้นสุดแล้ว'}</span>
        <span class="pill ${e.ackAt ? 'st-ok' : 'st-warn'}">${e.ackAt ? 'บันทึกแก้ไขแล้ว' : 'รอบันทึกการแก้ไข'}</span></div>
      <div class="s">${esc(EXC_TYPE[e.type] || e.type)} · ${fmtDateTime(e.start)}${e.end ? ' – ' + fmtTime(e.end) : ''} · ${ongoing ? 'ผ่านมาแล้ว' : 'นาน'} ${duration(mins)}${peak ? ' · ' + peak : ''}</div>
      <div class="s muted">${esc(e.id)}</div>
      ${e.ackAt ? `<div class="exc-action"><b>การแก้ไข:</b> ${esc(e.correctiveAction)}${e.note ? '<br><span class="muted">หมายเหตุ: ' + esc(e.note) + '</span>' : ''}<br><span class="muted small">${esc(e.ackBy.replace(/\s*<.*>$/, ''))} · ${fmtDateTime(e.ackAt)}</span></div>` : ''}
    </div>
    <button class="btn ${e.ackAt ? 'btn-ghost' : 'btn-primary'} btn-sm" onclick="ackForm('${esc(e.id)}')">${icon('pencil')}${e.ackAt ? 'แก้ไข' : 'บันทึกการแก้ไข'}</button>
  </div>`;
}

function findExc(id) {
  return (S.excList || []).find(e => e.id === id) || (S.ov ? S.ov.excursions.find(e => e.id === id) : null);
}

function ackForm(id) {
  const e = findExc(id);
  if (!e) return;
  openModal(`
    <div class="modal narrow">
      <div class="modal-head"><div style="flex:1"><h2>บันทึกการแก้ไข</h2><p>${esc(e.branch)} · ${esc(e.location)} · ${esc(EXC_TYPE[e.type])} ${fmtDateTime(e.start)}</p></div>${closeBtn()}</div>
      <div class="modal-body">
        <label class="label" for="ack-action">การแก้ไข / การดำเนินการ <span style="color:var(--alarm)">*</span></label>
        <div class="quick">${QUICK_ACTIONS.map(a => `<button type="button" onclick="addQuick(this)">${esc(a)}</button>`).join('')}</div>
        <textarea id="ack-action" class="field" rows="3" placeholder="เช่น ปิดประตูตู้เย็นให้สนิท ย้ายยาไปตู้สำรอง ตรวจสภาพยาแล้วปกติ">${esc(e.correctiveAction)}</textarea>
        <label class="label" for="ack-note" style="margin-top:12px">หมายเหตุ (ถ้ามี)</label>
        <textarea id="ack-note" class="field" rows="2" placeholder="เช่น รายการยาที่ได้รับผลกระทบ ผลการประเมินของเภสัชกร">${esc(e.note)}</textarea>
        <div id="ack-err" class="err hidden"></div>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button><button class="btn btn-primary" onclick="submitAck('${esc(id)}',this)">บันทึก</button></div>
    </div>`);
  setTimeout(() => $('ack-action').focus(), 50);
}

function addQuick(btn) {
  const ta = $('ack-action');
  ta.value = ta.value.trim() ? ta.value.trim() + ' · ' + btn.textContent : btn.textContent;
}

async function submitAck(id, btn) {
  const correctiveAction = $('ack-action').value.trim();
  if (correctiveAction.length < 3) { $('ack-err').textContent = 'กรุณาระบุการแก้ไข'; $('ack-err').classList.remove('hidden'); return; }
  await busy(btn, async () => {
    const r = await api('ackExcursion', { id, correctiveAction, note: $('ack-note').value.trim() });
    if (!r.ok) { $('ack-err').textContent = errMsg(r); $('ack-err').classList.remove('hidden'); return; }
    closeModal();
    toast('บันทึกการแก้ไขแล้ว');
    const ov = await api('overview');
    if (ov.ok) { S.ov = ov; renderTabs(); }
    if (S.tab === 'excursions') loadExcursions(); else if (S.tab === 'overview') renderOverview();
  });
}

// ==================== Reports ====================
// กราฟรายงาน ใช้โค้ดชุดเดียวกับรายงาน PDF (apps-script/ReportGrid.gs)
let gridReady = null;
function loadGrid() {
  if (!gridReady) {
    gridReady = fetch('apps-script/ReportGrid.gs').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).then(src => {
      window.Grid = new Function(src + '\nreturn { gridChartHtml, normalizeChartSettings, GRID_CSS, DEFAULT_CHART_SETTINGS, MAX_SLOTS, MAX_RANGE_DAYS };')();
      const st = document.createElement('style');
      st.textContent = Grid.GRID_CSS;
      document.head.appendChild(st);
    }).catch(e => { gridReady = null; throw e; });
  }
  return gridReady;
}

const chartDefaults = () => (S.ov && S.ov.chart) || (window.Grid && Grid.DEFAULT_CHART_SETTINGS) || { orient: 'v', slots: [] };
const dateText = d => fmtDate(new Date(d + 'T12:00:00+07:00').getTime());
const addDays = (d, n) => dayKey(new Date(d + 'T12:00:00+07:00').getTime() + n * 86400000);

// แนวกราฟ: 'v' = กราฟเส้น (X = วันที่) · 'h' = ตาราง (X = อุณหภูมิ) — ค่าเริ่มต้นจาก Console, เลือกเองได้ (จำไว้ในเครื่อง)
function reportOrient() {
  let v = null;
  try { v = localStorage.getItem('gpp_orient'); } catch (e) {}
  return v === 'h' || v === 'v' ? v : chartDefaults().orient || 'v';
}
function setOrient(v) {
  try { localStorage.setItem('gpp_orient', v); } catch (e) {}
  document.querySelectorAll('#orient-seg button').forEach(b => b.classList.toggle('active', b.dataset.o === v));
  if (S.report) $('r-body').innerHTML = reportScreen(S.report);
}

function gridFor(r, s, settings, orient) {
  if (!window.Grid) return '';
  return Grid.gridChartHtml({
    settings: settings || r.settings, zoneType: s.zoneType, limits: s.limits, dates: r.dates, values: r.values[s.sensorId] || {},
    today: r.today, fmtTime, showHum: s.limits.hMax != null, orient: orient || reportOrient(),
  });
}

function rangeTitle(r) {
  return r.month ? 'ประจำเดือน ' + thaiMonth(r.month) : 'ช่วงวันที่ ' + dateText(r.from) + ' – ' + dateText(r.to);
}

function renderReports() {
  const branches = isAdmin()
    ? [...new Set((S.ov ? S.ov.sensors : []).map(s => s.branch))].sort()
    : [S.user.branch];
  const today = dayKey(Date.now());
  S.rBranch = S.rBranch && (isAdmin() || branches.includes(S.rBranch)) ? S.rBranch : branches[0] || '';
  S.rMode = S.rMode || 'month';
  S.rMonth = S.rMonth || monthKey(Date.now());
  S.rTo = S.rTo || today;
  S.rFrom = S.rFrom || addDays(today, -6);
  const quick = (n, label) => `<button onclick="S.rFrom='${addDays(today, -(n - 1))}';S.rTo='${today}';renderReports()">${label}</button>`;
  $('view').innerHTML = `
    <div class="card card-pad" style="margin-bottom:14px">
      <div class="row" style="align-items:flex-end">
        <div style="flex:1 1 200px"><label class="label" for="r-branch">สาขา</label>
          <select id="r-branch" class="field" ${isAdmin() ? '' : 'disabled'} onchange="S.rBranch=this.value;loadReport()">
            ${(isAdmin() ? BRANCH_LIST : branches).map(b => `<option${b === S.rBranch ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
        <div><span class="label">ช่วงเวลา</span><div class="seg">
          <button class="${S.rMode === 'month' ? 'active' : ''}" onclick="S.rMode='month';renderReports()">รายเดือน</button>
          <button class="${S.rMode === 'range' ? 'active' : ''}" onclick="S.rMode='range';renderReports()">กำหนดช่วง</button></div></div>
        ${S.rMode === 'month'
          ? `<div style="flex:0 1 170px"><label class="label" for="r-month">เดือน</label>
               <input id="r-month" type="month" class="field" value="${esc(S.rMonth)}" max="${monthKey(Date.now())}" onchange="S.rMonth=this.value;loadReport()"></div>`
          : `<div style="flex:0 1 150px"><label class="label" for="r-from">ตั้งแต่</label><input id="r-from" type="date" class="field" value="${esc(S.rFrom)}" max="${today}" onchange="S.rFrom=this.value;loadReport()"></div>
             <div style="flex:0 1 150px"><label class="label" for="r-to">ถึง</label><input id="r-to" type="date" class="field" value="${esc(S.rTo)}" max="${today}" onchange="S.rTo=this.value;loadReport()"></div>
             <div class="seg">${quick(7, '7 วัน')}${quick(14, '14 วัน')}${quick(30, '30 วัน')}${quick(90, '90 วัน')}</div>`}
      </div>
      <div class="row" style="margin-top:10px">
        <div class="seg" id="orient-seg">
          <button data-o="v" class="${reportOrient() === 'v' ? 'active' : ''}" onclick="setOrient('v')">กราฟเส้น (X = วันที่)</button>
          <button data-o="h" class="${reportOrient() === 'h' ? 'active' : ''}" onclick="setOrient('h')">ตาราง (X = อุณหภูมิ)</button></div>
        <span class="spacer"></span>
        ${isAdmin() ? `<button class="btn btn-ghost btn-sm" onclick="go('chart')">${icon('sliders')}ปรับกราฟ</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="printReport()">${icon('printer')}พิมพ์</button>
        ${isAdmin() ? `<button class="btn btn-primary btn-sm" onclick="buildPdf(this)">${icon('file')}สร้าง PDF ใน Drive</button>` : ''}
      </div>
      <div class="hint">ใช้แทนแบบบันทึกอุณหภูมิ — พิมพ์และให้เภสัชกรลงนามเก็บไว้สำหรับการตรวจ GPP (ระบบส่ง PDF รายเดือนทาง LINE ทุกวันที่ 1 อัตโนมัติ)</div>
    </div>
    <div id="r-body">${skeleton()}</div>`;
  if (!S.ov) api('overview').then(r => { if (r.ok) { S.ov = r; setSub(); renderTabs(); if (S.tab === 'reports') renderReports(); } });
  else loadReport();
}

function reportQuery() {
  if (S.rMode === 'range') return { branch: S.rBranch, from: S.rFrom <= S.rTo ? S.rFrom : S.rTo, to: S.rFrom <= S.rTo ? S.rTo : S.rFrom };
  return { branch: S.rBranch, month: S.rMonth };
}

async function loadReport() {
  if (!S.rBranch) { $('r-body').innerHTML = `<div class="card empty">${icon('file')}<div>ยังไม่มีสาขาที่มีเซ็นเซอร์</div></div>`; return; }
  $('r-body').innerHTML = skeleton();
  const [r] = await Promise.all([api('monthly', reportQuery()), loadGrid().catch(() => null)]);
  if (S.tab !== 'reports') return;
  if (!r.ok) { $('r-body').innerHTML = errorBox(r); return; }
  S.report = r;
  $('r-body').innerHTML = reportScreen(r);
}

// ตารางสรุปรายวัน: ค่าแต่ละรอบเวลา + ต่ำสุด/สูงสุด/เฉลี่ยจากทุกค่าที่วัดได้
function reportHead(r) {
  return '<tr><th class="c">วันที่</th>' + r.settings.slots.map(x => `<th class="n">${esc(x.label)}<br><span class="muted">${x.from}–${x.to}</span></th>`).join('') +
    '<th class="n">ต่ำสุด</th><th class="n">สูงสุด</th><th class="n">เฉลี่ย</th><th class="n">ความชื้น%</th><th class="n">นอกเกณฑ์ (นาที)</th><th>ผล</th></tr>';
}
function reportRows(r, s) {
  const vals = r.values[s.sensorId] || {};
  const nS = r.settings.slots.length;
  return r.dates.filter(d => d <= r.today).map(d => {
    const x = r.days.find(v => v.sensorId === s.sensorId && v.date === d);
    const sv = vals[d] || [];
    if (!x || !x.readings) return `<tr><td class="c nowrap">${dateText(d)}</td><td colspan="${nS + 6}" class="muted c">ไม่มีข้อมูล</td></tr>`;
    const bad = x.excursionMin > 0 || x.state === 'alarm';
    const res = bad ? 'ผิดเกณฑ์' : x.state === 'warn' ? 'เฝ้าระวัง' : 'ปกติ';
    const slotCells = r.settings.slots.map((_, i) => `<td class="n">${sv[i] ? t1(sv[i].t) + ' <span class="muted small">' + fmtTime(sv[i].ts) + '</span>' : '–'}</td>`).join('');
    return `<tr class="${bad ? 'bad' : x.state === 'warn' ? 'warn' : ''}"><td class="c nowrap">${dateText(d)}</td>${slotCells}<td class="n">${t1(x.tMin)}</td><td class="n">${t1(x.tMax)}</td><td class="n">${t1(x.tAvg)}</td><td class="n">${x.hMax == null ? '–' : Math.round(x.hMax)}</td><td class="n">${x.excursionMin || ''}</td><td>${res}${x.partial ? ' <span class="muted">(ระหว่างวัน)</span>' : ''}</td></tr>`;
  }).reverse().join('');
}

function excTable(list) {
  if (!list.length) return '<div class="muted small">ไม่มีเหตุการณ์ผิดเกณฑ์ในช่วงนี้</div>';
  return `<div class="table-wrap"><table class="t"><tr><th>รหัส</th><th>จุด</th><th>ประเภท</th><th>เริ่ม</th><th>นาน</th><th class="n">ค่าสุดขีด</th><th>การแก้ไข</th><th>ผู้บันทึก</th></tr>${list.map(e =>
    `<tr><td class="nowrap">${esc(e.id)}</td><td>${esc(e.location)}</td><td class="nowrap">${esc(EXC_TYPE[e.type])}</td><td class="nowrap">${fmtDateTime(e.start)}</td><td class="nowrap">${duration(e.durationMin)}${e.status === 'open' ? ' (ยังเกิดอยู่)' : ''}</td><td class="n">${e.type === 'offline' ? '–' : t1(e.type === 'low' ? e.minTemp : e.maxTemp)}</td><td>${e.correctiveAction ? esc(e.correctiveAction) : '<span style="color:var(--alarm)">ยังไม่ได้บันทึก</span>'}</td><td>${esc(e.ackBy.replace(/\s*<.*>$/, ''))}</td></tr>`).join('')}</table></div>`;
}

function reportScreen(r) {
  if (!r.sensors.length) return `<div class="card empty">${icon('thermo')}<div>สาขานี้ยังไม่มีเซ็นเซอร์</div></div>`;
  const span = r.month ? 'ของเดือน' : 'ของช่วง';
  return `<div class="muted small" style="margin:-4px 0 10px">${esc(r.branch)} · ${esc(rangeTitle(r))} · รอบเวลา: ${r.settings.slots.map(x => esc(x.label) + ' ' + x.from + '–' + x.to).join(', ')}</div>` +
    '<div class="stack-14">' + r.sensors.map(s => {
    const days = r.days.filter(d => d.sensorId === s.sensorId && d.readings);
    const bad = days.filter(d => d.excursionMin > 0 || d.state === 'alarm').length;
    const mins = days.map(d => d.tMin).filter(v => v != null), maxs = days.map(d => d.tMax).filter(v => v != null);
    return `<section class="card card-pad rpt-sensor">
      <h3 class="section-title">${icon(s.zoneType === 'fridge' ? 'snow' : 'home')}${esc(s.location)} <span class="muted small" style="font-weight:500">${esc(s.limits.zoneLabel)} · เกณฑ์ ${rangeText(s.limits)} · ${esc(s.sensorId)}</span></h3>
      <div class="stats">
        <div class="stat"><span>วันที่มีข้อมูล</span><b>${days.length}</b></div>
        <div class="stat"><span>วันที่ผิดเกณฑ์</span><b style="color:${bad ? 'var(--alarm)' : 'inherit'}">${bad}</b></div>
        <div class="stat"><span>ต่ำสุด${span}</span><b>${mins.length ? t1(Math.min(...mins)) : '–'}°C</b></div>
        <div class="stat"><span>สูงสุด${span}</span><b>${maxs.length ? t1(Math.max(...maxs)) : '–'}°C</b></div>
      </div>
      <div class="table-wrap"><div class="grid-chart ${reportOrient()}">${gridFor(r, s) || '<div class="err">โหลดกราฟไม่ได้</div>'}</div></div>
      <details style="margin-top:10px"><summary class="btn btn-ghost btn-sm">ดูตารางสรุปรายวัน</summary>
        <div class="table-wrap" style="margin-top:8px"><table class="t">${reportHead(r)}${reportRows(r, s)}</table></div>
      </details>
    </section>`;
  }).join('') + `<section class="card card-pad"><h3 class="section-title">${icon('bell')}เหตุการณ์ผิดเกณฑ์และการแก้ไข</h3>${excTable(r.excursions)}</section></div>`;
}

function printReport() {
  const r = S.report;
  if (!r || !r.sensors.length) return toast('ยังไม่มีข้อมูลสำหรับพิมพ์', 'err');
  const head = `<h1>บันทึกการควบคุมอุณหภูมิการเก็บรักษายา</h1><div>สาขา: <b>${esc(r.branch)}</b> · <b>${esc(rangeTitle(r))}</b> · บันทึกอัตโนมัติจากเครื่องวัด</div>`;
  const signs = '<div class="sign"><div><div class="line"></div>ผู้ตรวจสอบบันทึก<br>วันที่ ..................</div><div><div class="line"></div>เภสัชกรผู้มีหน้าที่ปฏิบัติการ<br>วันที่ ..................</div></div>';
  $('print-area').innerHTML = r.sensors.map(s => `<div class="p-page">${head}<h3>${esc(s.location)} (${esc(s.sensorId)}) · ${esc(s.limits.zoneLabel)}</h3>
    ${gridFor(r, s)}${signs}</div>`).join('') +
    `<div class="p-page">${head}<h3>บันทึกเหตุการณ์ผิดเกณฑ์และการแก้ไข</h3><table class="xt"><tr><th>รหัส</th><th>จุด</th><th>ประเภท</th><th>เริ่ม</th><th>นาน</th><th>ค่าสุดขีด</th><th>การแก้ไข</th><th>ผู้บันทึก</th></tr>${
      r.excursions.length ? r.excursions.map(e => `<tr><td>${esc(e.id)}</td><td class="l">${esc(e.location)}</td><td>${esc(EXC_TYPE[e.type])}</td><td>${fmtDateTime(e.start)}</td><td>${duration(e.durationMin)}</td><td>${e.type === 'offline' ? '' : t1(e.type === 'low' ? e.minTemp : e.maxTemp)}</td><td class="l">${esc(e.correctiveAction || '— ยังไม่ได้บันทึก —')}</td><td class="l">${esc(e.ackBy.replace(/\s*<.*>$/, ''))}</td></tr>`).join('')
      : '<tr><td colspan="8">ไม่มีเหตุการณ์ผิดเกณฑ์ในช่วงนี้</td></tr>'}</table>${signs}</div>`;
  let ps = $('page-size');
  if (!ps) { ps = document.createElement('style'); ps.id = 'page-size'; document.head.appendChild(ps); }
  ps.textContent = '@media print { @page { size: A4 ' + (reportOrient() === 'v' ? 'landscape' : 'portrait') + '; margin: 8mm; } }';
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 50);
}

async function buildPdf(btn) {
  await busy(btn, async () => {
    const r = await api('buildReport', Object.assign(reportQuery(), { orient: reportOrient() }));
    if (!r.ok) return toast(errMsg(r), 'err');
    if (MOCK) toast('โหมดทดสอบ: สร้างไฟล์จำลอง ' + r.name);
    else { toast('สร้างแล้ว: ' + r.name); window.open(r.url, '_blank', 'noopener'); }
  });
}

// ==================== Console ปรับกราฟ (admin) ====================
// แก้ค่าในหน้านี้เป็น "ร่าง" (S.cc) → ดูตัวอย่างจากข้อมูลจริงได้ทันที → กดบันทึกจึงมีผลกับทุกคนและรายงาน PDF
async function loadChartConsole() {
  if (!isAdmin()) return go('overview');
  $('view').innerHTML = skeleton();
  const [ov] = await Promise.all([S.ov ? Promise.resolve(S.ov) : api('overview'), loadGrid().catch(() => null)]);
  if (S.tab !== 'chart') return;
  if (!ov.ok) { $('view').innerHTML = errorBox(ov); return; }
  S.ov = ov;
  setSub();
  renderTabs();
  S.cc = JSON.parse(JSON.stringify(ov.chart));
  S.ccPrev = S.ccPrev || { sensorId: (ov.sensors.find(s => s.zoneType === 'fridge') || ov.sensors[0] || {}).sensorId, days: 14, orient: ov.chart.orient };
  renderChartConsole();
}

function renderChartConsole() {
  const c = S.cc, zones = S.ov.zones;
  const max = (window.Grid && Grid.MAX_SLOTS) || 4;
  const scaleRow = (key, label, o, unit) => `<tr><td>${esc(label)}</td>
      <td><input class="field field-sm num" type="number" step="0.5" style="width:84px" value="${o.min}" oninput="ccScale('${key}','min',this.value)"></td>
      <td><input class="field field-sm num" type="number" step="0.5" style="width:84px" value="${o.max}" oninput="ccScale('${key}','max',this.value)"></td>
      <td><input class="field field-sm num" type="number" step="0.1" min="0.1" style="width:84px" value="${o.step}" oninput="ccScale('${key}','step',this.value)"></td>
      <td class="muted small">${unit}</td></tr>`;
  const zoneKeys = zones.map(z => z.zoneType);
  zoneKeys.forEach(k => { if (!c.scales[k]) c.scales[k] = Object.assign({}, c.scales.room); });
  $('view').innerHTML = `<div class="stack-14">
    <div class="notice info">${icon('sliders')}<div>ปรับรอบเวลา สเกลกราฟ และเกณฑ์ แล้วดูตัวอย่างจากข้อมูลจริงด้านล่าง — <b>กด "บันทึกค่าตั้งกราฟ"</b> เพื่อใช้กับทุกคนและรายงาน PDF</div></div>

    <section class="card card-pad">
      <h3 class="section-title">${icon('clock')}รอบเวลาอ่านค่า (${c.slots.length}/${max} รอบต่อวัน)</h3>
      <div class="table-wrap"><table class="t"><tr><th>#</th><th>ชื่อรอบ</th><th>ตัวย่อบนกราฟ</th><th>ตั้งแต่</th><th>ถึง (ไม่รวม)</th><th></th></tr>
      ${c.slots.map((s, i) => `<tr><td>${i + 1}</td>
        <td><input class="field field-sm" style="width:120px" maxlength="20" value="${esc(s.label)}" oninput="ccSlot(${i},'label',this.value)"></td>
        <td><input class="field field-sm" style="width:60px" maxlength="2" value="${esc(s.short)}" oninput="ccSlot(${i},'short',this.value)"></td>
        <td><input class="field field-sm num" style="width:80px" inputmode="numeric" maxlength="5" placeholder="HH:mm" value="${esc(s.from)}" onchange="ccSlot(${i},'from',ccTime(this))"></td>
        <td><input class="field field-sm num" style="width:80px" inputmode="numeric" maxlength="5" placeholder="HH:mm" value="${esc(s.to)}" onchange="ccSlot(${i},'to',ccTime(this))"></td>
        <td>${c.slots.length > 1 ? `<button class="btn btn-ghost btn-sm btn-icon" onclick="ccRemoveSlot(${i})" aria-label="ลบรอบ">${icon('trash')}</button>` : ''}</td></tr>`).join('')}</table></div>
      ${c.slots.length < max ? `<button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="ccAddSlot()">${icon('plus')}เพิ่มรอบ</button>` : ''}
      <div class="hint">ใช้ค่าแรกที่วัดได้ในช่วงเวลานั้น (เครื่องวัดส่งค่าทุก ${S.ov.pollMinutes} นาที — ช่วงควรกว้างอย่างน้อย ${S.ov.pollMinutes} นาที) · ระบบคำนวณจากค่าดิบ เปลี่ยนแล้วมีผลกับข้อมูลย้อนหลังทันที</div>
    </section>

    <section class="card card-pad">
      <h3 class="section-title">${icon('thermo')}สเกลแกนกราฟ</h3>
      <div class="table-wrap"><table class="t"><tr><th>แกน</th><th>ต่ำสุด</th><th>สูงสุด</th><th>ช่องละ</th><th></th></tr>
        ${zones.map(z => scaleRow(z.zoneType, 'อุณหภูมิ · ' + z.label, c.scales[z.zoneType], '°C')).join('')}
        ${scaleRow('hum', 'ความชื้น (แกนขวา)', c.hum, '%RH')}</table></div>
      <div class="row" style="margin-top:10px;gap:18px">
        <label class="row" style="gap:6px"><input type="checkbox" ${c.autoExpand ? 'checked' : ''} onchange="S.cc.autoExpand=this.checked;ccChanged()"> ขยายสเกลอัตโนมัติเมื่อค่าที่วัดได้หรือเกณฑ์อยู่นอกสเกล</label>
        <label class="row" style="gap:6px">รูปแบบเริ่มต้นของรายงาน/PDF
          <select class="field field-sm" style="width:auto" onchange="S.cc.orient=this.value;ccChanged()">
            <option value="v"${c.orient === 'v' ? ' selected' : ''}>กราฟเส้น (X = วันที่) · A4 แนวนอน</option>
            <option value="h"${c.orient === 'h' ? ' selected' : ''}>ตาราง (X = อุณหภูมิ) · A4 แนวตั้ง</option></select></label>
      </div>
    </section>

    <section class="card card-pad">
      <h3 class="section-title">${icon('alert')}เกณฑ์ตามประเภทพื้นที่</h3>
      <div class="table-wrap"><table class="t"><tr><th>ประเภท</th><th class="n">ต่ำสุด °C</th><th class="n">เฝ้าระวัง > °C</th><th class="n">สูงสุด °C</th><th class="n">ความชื้น ≤ %</th><th class="n">ยืนยัน (ครั้ง)</th><th class="n">ขาดการเชื่อมต่อ (นาที)</th><th class="n">เตือนซ้ำ (นาที)</th><th></th></tr>
      ${zones.map(z => `<tr data-zone="${esc(z.zoneType)}"><td>${esc(z.label)}<div class="muted small">${esc(z.zoneType)}</div></td>${['tMin', 'tWarn', 'tMax', 'hMax', 'confirmReadings', 'offlineMinutes', 'realertMinutes'].map(k =>
        `<td><input class="field field-sm num" style="width:76px;text-align:right" data-k="${k}" type="number" step="0.5" value="${z[k] == null ? '' : z[k]}"></td>`).join('')}
        <td><button class="btn btn-secondary btn-sm" onclick="saveZone(this)">บันทึก</button></td></tr>`).join('')}</table></div>
      <div class="hint">เกณฑ์บันทึกแยกทีละแถวและมีผลทันที (ทั้งการแจ้งเตือนและกราฟ) · เว้นว่าง = ไม่ตรวจ · ความชื้นเกินเกณฑ์ = เฝ้าระวัง · "ยืนยัน" = ต้องผิดเกณฑ์ติดกันกี่รอบจึงแจ้ง · กำหนดเกณฑ์เฉพาะจุดได้ที่ ตั้งค่า > เซ็นเซอร์</div>
    </section>

    <section class="card card-pad">
      <div class="row" style="margin-bottom:8px"><h3 class="section-title" style="margin:0">${icon('grid')}ตัวอย่างกราฟ (ค่าร่าง)</h3><span class="spacer"></span>
        <select class="field field-sm" style="width:auto;max-width:240px" onchange="S.ccPrev.sensorId=this.value;ccPreview()">
          ${S.ov.sensors.map(s => `<option value="${esc(s.sensorId)}"${s.sensorId === S.ccPrev.sensorId ? ' selected' : ''}>${esc(branchCode(s.branch) + ' · ' + s.location)}</option>`).join('')}</select>
        <div class="seg">${[7, 14, 31].map(n => `<button class="${S.ccPrev.days === n ? 'active' : ''}" onclick="S.ccPrev.days=${n};renderChartConsole()">${n} วัน</button>`).join('')}</div>
        <div class="seg"><button class="${S.ccPrev.orient === 'v' ? 'active' : ''}" onclick="S.ccPrev.orient='v';renderChartConsole()">กราฟเส้น</button><button class="${S.ccPrev.orient === 'h' ? 'active' : ''}" onclick="S.ccPrev.orient='h';renderChartConsole()">ตาราง</button></div>
      </div>
      <div id="cc-err" class="err hidden"></div>
      <div class="table-wrap"><div class="grid-chart ${S.ccPrev.orient}" id="cc-preview"><div class="skeleton" style="height:260px"></div></div></div>
    </section>

    <div class="card card-pad row" style="position:sticky;bottom:12px;z-index:5">
      <span id="cc-dirty" class="muted small">${ccDirty() ? '● มีการแก้ไขที่ยังไม่บันทึก' : 'ตรงกับค่าที่บันทึกไว้'}</span><span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" onclick="ccReset()">คืนค่าเริ่มต้น</button>
      <button class="btn btn-secondary btn-sm" onclick="S.cc=JSON.parse(JSON.stringify(S.ov.chart));renderChartConsole()">ยกเลิกการแก้ไข</button>
      <button class="btn btn-primary btn-sm" onclick="ccSave(this)">บันทึกค่าตั้งกราฟ</button>
    </div>
  </div>`;
  ccPreview();
}

const ccDirty = () => JSON.stringify(S.cc) !== JSON.stringify(S.ov.chart);
let ccTimer = null;
function ccChanged() {
  const d = $('cc-dirty');
  if (d) d.textContent = ccDirty() ? '● มีการแก้ไขที่ยังไม่บันทึก' : 'ตรงกับค่าที่บันทึกไว้';
  clearTimeout(ccTimer);
  ccTimer = setTimeout(ccPreview, 500);
}
// รับ "830", "8:30", "08.30" → "08:30" (24 ชม.)
function ccTime(input) {
  const m = /^(d{1,2})[:.]?(d{2})$/.exec(input.value.trim());
  if (m) input.value = m[1].padStart(2, '0') + ':' + m[2];
  return input.value.trim();
}
function ccSlot(i, k, v) { S.cc.slots[i][k] = v; ccChanged(); }
function ccScale(key, k, v) { (key === 'hum' ? S.cc.hum : S.cc.scales[key])[k] = v === '' ? '' : Number(v); ccChanged(); }
function ccAddSlot() {
  const last = S.cc.slots[S.cc.slots.length - 1];
  const start = last ? Math.min(23 * 60, (Number(last.to.slice(0, 2)) + 2) * 60) : 8 * 60;
  const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  S.cc.slots.push({ label: 'รอบ ' + (S.cc.slots.length + 1), short: String(S.cc.slots.length + 1), from: hm(start), to: hm(Math.min(1440, start + 60)) });
  renderChartConsole();
}
function ccRemoveSlot(i) { S.cc.slots.splice(i, 1); renderChartConsole(); }
function ccReset() {
  if (!confirm('คืนรอบเวลาและสเกลกราฟเป็นค่าเริ่มต้น? (ยังไม่บันทึกจนกว่าจะกด "บันทึกค่าตั้งกราฟ")')) return;
  S.cc = JSON.parse(JSON.stringify(Grid.DEFAULT_CHART_SETTINGS));
  renderChartConsole();
}

async function ccPreview() {
  const box = $('cc-preview');
  if (!box) return;
  const err = $('cc-err');
  let draft;
  try { draft = Grid.normalizeChartSettings(S.cc, true); err.classList.add('hidden'); }
  catch (e) { err.textContent = e.message; err.classList.remove('hidden'); return; }
  const s = S.ov.sensors.find(x => x.sensorId === S.ccPrev.sensorId);
  if (!s) { box.innerHTML = '<div class="muted small">ยังไม่มีเซ็นเซอร์ให้แสดงตัวอย่าง</div>'; return; }
  const to = dayKey(Date.now()), from = addDays(to, -(S.ccPrev.days - 1));
  const r = await api('monthly', { branch: s.branch, from, to, settings: draft });
  if (!$('cc-preview')) return;
  if (!r.ok) { err.textContent = errMsg(r); err.classList.remove('hidden'); return; }
  $('cc-preview').innerHTML = gridFor(r, s, draft, S.ccPrev.orient);
}

async function ccSave(btn) {
  let draft;
  try { draft = Grid.normalizeChartSettings(S.cc, true); }
  catch (e) { return toast(e.message, 'err'); }
  await busy(btn, async () => {
    const r = await api('saveChartSettings', { settings: draft });
    if (!r.ok) return toast(errMsg(r), 'err');
    S.ov.chart = r.settings;
    S.cc = JSON.parse(JSON.stringify(r.settings));
    S.report = null;
    toast('บันทึกค่าตั้งกราฟแล้ว — ใช้กับรายงานและ PDF ทันที');
    renderChartConsole();
  });
}

// ==================== Settings (admin) ====================
async function loadSettings() {
  if (!isAdmin()) return go('overview');
  $('view').innerHTML = skeleton();
  const r = await api('adminConfig');
  if (S.tab !== 'settings') return;
  if (!r.ok) { $('view').innerHTML = errorBox(r); return; }
  S.admin = r;
  renderSettings();
}

function renderSettings() {
  const a = S.admin;
  const trig = ['pollTrigger', 'dailySummaryTrigger', 'monthlyReportTrigger'].every(t => a.triggers.includes(t));
  $('view').innerHTML = `<div class="stack-14">
    <section class="card card-pad">
      <h3 class="section-title">${icon('refresh')}การทำงานของระบบ</h3>
      <dl class="kv">
        <dt>ดึงค่าล่าสุด</dt><dd>${a.lastPollAt ? fmtDateTime(a.lastPollAt) + ' (' + ago(a.lastPollAt) + ')' : 'ยังไม่เคย'} · ทุก ${a.pollMinutes} นาที</dd>
        <dt>Trigger อัตโนมัติ</dt><dd>${trig ? '<span class="pill st-ok">ตั้งค่าแล้ว</span>' : '<span class="pill st-alarm">ยังไม่ได้ตั้ง — รันฟังก์ชัน setup() ใน Apps Script</span>'}</dd>
        <dt>LINE</dt><dd>${a.lineReady ? '<span class="pill st-ok">มี Channel token</span>' : '<span class="pill st-warn">ยังไม่ได้ใส่ LINE_CHANNEL_TOKEN</span>'} <span id="quota" class="muted small"></span></dd>
        <dt>อีเมลสำรอง</dt><dd>${esc(a.alertEmails || '– (ตั้งที่ Script Property ALERT_EMAILS)')}</dd>
        <dt>เวอร์ชัน backend</dt><dd>${esc(a.version)}</dd>
      </dl>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary btn-sm" onclick="pollNow(this)">${icon('refresh')}ดึงค่าเดี๋ยวนี้</button>
        <button class="btn btn-secondary btn-sm" onclick="dailyNow(this)">${icon('send')}ส่งสรุปเมื่อวานทาง LINE</button>
        <button class="btn btn-secondary btn-sm" onclick="showQuota(this)">ดูโควตา LINE เดือนนี้</button>
      </div>
    </section>

    <section class="card card-pad">
      <div class="row" style="margin-bottom:12px"><h3 class="section-title" style="margin:0">${icon('thermo')}เซ็นเซอร์ (${a.sensors.length})</h3><span class="spacer"></span>
        <button class="btn btn-primary btn-sm" onclick="editSensor()">${icon('plus')}เพิ่มเซ็นเซอร์</button></div>
      ${a.sensors.length ? `<div class="table-wrap"><table class="t"><tr><th>รหัส</th><th>สาขา</th><th>จุดติดตั้ง</th><th>ประเภท</th><th>เกณฑ์</th><th>อุปกรณ์</th><th>สถานะ</th><th></th></tr>${a.sensors.map(s => `
        <tr><td class="nowrap">${esc(s.sensorId)}</td><td>${esc(s.branch)}</td><td>${esc(s.location)}</td><td class="nowrap">${esc(s.limits.zoneLabel)}</td><td class="nowrap">${rangeText(s.limits)}</td>
        <td><span class="mono">${esc(s.accountId)} · ${esc(s.deviceId)}</span></td><td><span class="pill st-${s.state}">${(STATE[s.state] || STATE.pending).label}</span></td>
        <td><button class="btn btn-ghost btn-sm btn-icon" onclick="editSensor('${esc(s.sensorId)}')" aria-label="แก้ไข">${icon('pencil')}</button></td></tr>`).join('')}</table></div>`
        : '<div class="muted small">ยังไม่มีเซ็นเซอร์ — กด "เพิ่มเซ็นเซอร์" แล้วค้นหาอุปกรณ์จากบัญชี SwitchBot/Tuya</div>'}
      <div class="hint" style="margin-top:10px">บัญชี API: ${a.accounts.map(x => `<b>${esc(x.accountId)}</b> (${esc(x.provider)}${x.active ? '' : ', ปิดอยู่'}${x.hasCredential ? '' : ', <span style="color:var(--alarm)">ไม่มี CRED_' + esc(x.accountId) + '</span>'}${x.lastError ? ', <span style="color:var(--alarm)">' + esc(x.lastError) + '</span>' : ''})`).join(' · ') || '–'} — เพิ่ม/แก้ที่ชีต Accounts</div>
    </section>

    <div class="notice info" style="cursor:pointer;margin:0" onclick="go('chart')">${icon('sliders')}<div>เกณฑ์อุณหภูมิ รอบเวลาอ่านค่า และสเกลกราฟ ย้ายไปที่เมนู <b>ปรับกราฟ</b></div></div>

    <section class="card card-pad">
      <h3 class="section-title">${icon('send')}กลุ่ม LINE ที่รับแจ้งเตือน</h3>
      ${a.lineTargets.length ? `<div class="table-wrap"><table class="t"><tr><th>ชื่อ</th><th>สาขา</th><th>groupId</th><th>สถานะ</th><th></th></tr>${a.lineTargets.map(t => `
        <tr><td>${esc(t.label)}</td><td>${t.branch === '*' ? '<b>ทุกสาขา (ส่วนกลาง)</b>' : esc(t.branch)}</td><td><span class="mono">${esc(t.groupId.slice(0, 12))}…</span></td>
        <td>${t.active ? '<span class="pill st-ok">ใช้งาน</span>' : '<span class="pill st-offline">ปิด</span>'}</td>
        <td class="nowrap"><button class="btn btn-ghost btn-sm" onclick="lineTest('${esc(t.branch)}',this)">ทดสอบ</button>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="delTarget('${esc(t.groupId)}','${esc(t.branch)}',this)" aria-label="ลบ">${icon('trash')}</button></td></tr>`).join('')}</table></div>`
        : '<div class="muted small">ยังไม่มีกลุ่ม</div>'}
      <h4 style="margin:16px 0 6px;font-size:14px">กลุ่มที่เพิ่งเชิญบอทเข้า (รอผูกสาขา)</h4>
      ${a.linePending.length ? a.linePending.map(p => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">
        <span class="mono" style="flex:1 1 200px">${esc(p.groupId)}</span><span class="muted small">${fmtDateTime(p.ts)}</span>
        <select class="field field-sm" style="width:auto;max-width:200px" id="pb-${esc(p.groupId)}"><option value="">-- เลือกสาขา --</option><option value="*">ทุกสาขา (ส่วนกลาง)</option>${branchOptions()}</select>
        <button class="btn btn-secondary btn-sm" onclick="bindGroup('${esc(p.groupId)}',this)">ผูก</button></div>`).join('')
        : '<div class="muted small">เชิญบัญชี LINE OA เข้ากลุ่ม (หรือพิมพ์ <b>#ลงทะเบียน</b> ในกลุ่ม) แล้วกลุ่มจะมาแสดงที่นี่</div>'}
    </section>

    <section class="card card-pad">
      <div class="row" style="margin-bottom:8px"><h3 class="section-title" style="margin:0">${icon('bell')}บันทึกการแจ้งเตือน</h3><span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" onclick="loadLog(this)">${icon('refresh')}โหลด</button></div>
      <div id="log-body" class="muted small">กด "โหลด" เพื่อดูข้อความที่ส่งล่าสุด</div>
    </section>
  </div>`;
}

async function pollNow(btn) {
  await busy(btn, async () => {
    const r = await api('pollNow');
    if (!r.ok) return toast(errMsg(r), 'err');
    toast(`อ่านค่าได้ ${r.read}/${r.sensors} จุด · เหตุการณ์ ${r.events.length}` + (r.accountErrors.length ? ' · บัญชีผิดพลาด ' + r.accountErrors.length : ''));
    S.ov = null;
    loadSettings();
  });
}

async function dailyNow(btn) {
  if (!confirm('ส่งสรุปของเมื่อวานไปทุกกลุ่ม LINE ตอนนี้?')) return;
  await busy(btn, async () => {
    const r = await api('dailySummary');
    if (!r.ok) return toast(errMsg(r), 'err');
    toast('ส่งแล้ว ' + r.sent.filter(x => x.ok).length + '/' + r.sent.length + ' กลุ่ม');
  });
}

async function showQuota(btn) {
  await busy(btn, async () => {
    const r = await api('lineQuota');
    $('quota').textContent = r.ok && r.quota ? `ใช้ไป ${r.quota.used ?? '?'} / ${r.quota.limit ?? 'ไม่จำกัด'} ข้อความ` : 'ดูโควตาไม่ได้';
  });
}

async function saveZone(btn) {
  const tr = btn.closest('tr');
  const zone = { zoneType: tr.dataset.zone };
  tr.querySelectorAll('input[data-k]').forEach(i => { zone[i.dataset.k] = i.value === '' ? '' : Number(i.value); });
  await busy(btn, async () => {
    const r = await api('saveZone', { zone });
    if (!r.ok) return toast(errMsg(r), 'err');
    toast('บันทึกเกณฑ์แล้ว — การแจ้งเตือนใช้เกณฑ์ใหม่ในรอบดึงค่าถัดไป');
    const ov = await api('overview');
    if (ov.ok) { ov.chart = S.ov ? S.ov.chart : ov.chart; S.ov = ov; }
    S.report = null;
    if (S.tab === 'chart') ccPreview();
  });
}

async function lineTest(branch, btn) {
  await busy(btn, async () => {
    const r = await api('lineTest', { branch });
    if (!r.ok) return toast(errMsg(r), 'err');
    const bad = r.results.filter(x => !x.ok);
    toast(bad.length ? 'ส่งไม่สำเร็จ: ' + bad.map(x => x.error).join(', ') : 'ส่งข้อความทดสอบแล้ว', bad.length ? 'err' : '');
  });
}

async function bindGroup(groupId, btn) {
  const branch = $('pb-' + groupId).value;
  if (!branch) return toast('กรุณาเลือกสาขา', 'err');
  const label = prompt('ตั้งชื่อกลุ่ม (เช่น กลุ่ม LINE สาขา ' + branchCode(branch) + ')', branch === '*' ? 'กลุ่มส่วนกลาง' : 'กลุ่ม ' + branch);
  if (label === null) return;
  await busy(btn, async () => {
    const r = await api('saveLineTarget', { target: { groupId, branch, label, active: true } });
    if (!r.ok) return toast(errMsg(r), 'err');
    toast('ผูกกลุ่มแล้ว');
    loadSettings();
  });
}

async function delTarget(groupId, branch, btn) {
  if (!confirm('ลบกลุ่มนี้ออกจากการแจ้งเตือน?')) return;
  await busy(btn, async () => {
    const r = await api('deleteLineTarget', { groupId, branch });
    if (!r.ok) return toast(errMsg(r), 'err');
    loadSettings();
  });
}

async function loadLog(btn) {
  await busy(btn, async () => {
    const r = await api('alertLog', { limit: 60 });
    if (!r.ok) return toast(errMsg(r), 'err');
    $('log-body').classList.remove('muted', 'small');
    $('log-body').innerHTML = r.log.length ? r.log.map(l => `<details style="border-bottom:1px solid var(--line);padding:8px 0">
      <summary class="row"><span class="pill ${l.result === 'ok' ? 'st-ok' : 'st-alarm'}">${l.result === 'ok' ? 'ส่งแล้ว' : esc(l.result)}</span>
      <span class="small">${fmtDateTime(l.ts)} · ${esc(l.channel === 'line' ? 'LINE' : 'อีเมล')} → ${esc(l.target)}</span></summary>
      <div class="log-msg">${esc(l.message)}</div></details>`).join('') : '<div class="muted small">ยังไม่มีการแจ้งเตือน</div>';
  });
}

// ── ฟอร์มเซ็นเซอร์ ──
function editSensor(id) {
  const a = S.admin;
  if (!a) { api('adminConfig').then(r => { if (r.ok) { S.admin = r; editSensor(id); } }); return; }
  const s = id ? a.sensors.find(x => x.sensorId === id) : { active: true, zoneType: 'room', accountId: (a.accounts.find(x => x.active) || a.accounts[0] || {}).accountId };
  const zone = z => a.zones.find(x => x.zoneType === z) || {};
  const num = (k, label, step) => `<div><label class="label" for="sf-${k}">${label}</label><input id="sf-${k}" class="field" type="number" step="${step || 0.5}" value="${s[k] == null ? '' : s[k]}" placeholder="ตามประเภท: ${zone(s.zoneType)[k] ?? '–'}"></div>`;
  openModal(`
    <div class="modal">
      <div class="modal-head"><div style="flex:1"><h2>${id ? 'แก้ไขเซ็นเซอร์ ' + esc(id) : 'เพิ่มเซ็นเซอร์'}</h2><p>ผูกอุปกรณ์จากบัญชี SwitchBot/Tuya เข้ากับสาขาและจุดติดตั้ง</p></div>${closeBtn()}</div>
      <div class="modal-body"><div class="form-grid">
        <div><label class="label" for="sf-accountId">บัญชี API</label><select id="sf-accountId" class="field">${a.accounts.map(x => `<option value="${esc(x.accountId)}"${x.accountId === s.accountId ? ' selected' : ''}>${esc(x.accountId)} · ${esc(x.label || x.provider)}</option>`).join('')}</select></div>
        <div><label class="label" for="sf-deviceId">รหัสอุปกรณ์ (deviceId)</label><div class="row" style="flex-wrap:nowrap"><input id="sf-deviceId" class="field" value="${esc(s.deviceId || '')}"><button class="btn btn-secondary" onclick="discover(this)">${icon('search')}ค้นหา</button></div></div>
        <div class="full" id="sf-devices"></div>
        <div><label class="label" for="sf-branch">สาขา</label><select id="sf-branch" class="field">${branchOptions(s.branch, '-- เลือกสาขา --')}</select></div>
        <div><label class="label" for="sf-location">จุดติดตั้ง</label><input id="sf-location" class="field" value="${esc(s.location || '')}" placeholder="เช่น ห้องขายยา, ห้องเก็บยา, ตู้เย็นยา"></div>
        <div><label class="label" for="sf-zoneType">ประเภทพื้นที่</label><select id="sf-zoneType" class="field">${a.zones.map(z => `<option value="${esc(z.zoneType)}"${z.zoneType === s.zoneType ? ' selected' : ''}>${esc(z.label)} (${rangeText(z)})</option>`).join('')}</select></div>
        ${num('calOffset', 'ค่าชดเชยการสอบเทียบ (°C)', 0.1)}
        <div class="full hint" style="margin:-4px 0 0">เกณฑ์เฉพาะจุดนี้ (เว้นว่าง = ใช้ค่าตามประเภทพื้นที่) · ค่าชดเชย: เทียบกับเทอร์โมมิเตอร์ที่สอบเทียบแล้ว เช่น เครื่องอ่านสูงไป 0.5 ให้ใส่ -0.5</div>
        ${num('tMin', 'ต่ำสุด °C')}${num('tMax', 'สูงสุด °C')}${num('tWarn', 'เฝ้าระวังเมื่อเกิน °C')}${num('hMax', 'ความชื้นไม่เกิน %', 1)}
        <div class="full"><label class="label" for="sf-note">หมายเหตุ</label><input id="sf-note" class="field" value="${esc(s.note || '')}"></div>
        <label class="full row" style="gap:8px"><input type="checkbox" id="sf-active" ${s.active ? 'checked' : ''}> เปิดใช้งาน (ดึงค่าและแจ้งเตือน)</label>
      </div><div id="sf-err" class="err hidden"></div></div>
      <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button><button class="btn btn-primary" onclick="submitSensor('${esc(id || '')}',this)">บันทึก</button></div>
    </div>`);
}

async function discover(btn) {
  const accountId = $('sf-accountId').value;
  await busy(btn, async () => {
    const r = await api('discover', { accountId });
    const box = $('sf-devices');
    if (!r.ok) { box.innerHTML = `<div class="err">${esc(errMsg(r))}</div>`; return; }
    const list = r.devices.sort((a, b) => (b.isSensor - a.isSensor));
    box.innerHTML = `<div class="label">อุปกรณ์ในบัญชี ${esc(accountId)} (${list.length}) — กดเพื่อเลือก</div><div class="dev-list">${list.map(d => `
      <button type="button" class="dev${d.sensorId ? ' used' : ''}" onclick="pickDevice('${esc(d.deviceId)}','${esc(d.name)}')">
        ${icon(d.isSensor ? 'thermo' : 'x')}<span class="grow"><b>${esc(d.name)}</b> <span class="muted">${esc(d.type)}</span><br><span class="mono">${esc(d.deviceId)}</span>${d.note ? ' · <span class="muted">' + esc(d.note) + '</span>' : ''}</span>
        ${d.sensorId ? `<span class="pill st-offline">ใช้แล้ว ${esc(d.sensorId)}</span>` : d.online ? '' : '<span class="pill st-offline">ออฟไลน์</span>'}</button>`).join('')}</div>`;
  });
}

function pickDevice(id, name) {
  $('sf-deviceId').value = id;
  if (!$('sf-location').value) $('sf-location').value = name.replace(/^จำลอง:\s*/, '').replace(/\s+[A-Z]$/, '');
  if (/fridge|ตู้เย็น/i.test(id + name)) $('sf-zoneType').value = 'fridge';
}

async function submitSensor(id, btn) {
  const sensor = { sensorId: id || undefined, active: $('sf-active').checked };
  ['accountId', 'deviceId', 'branch', 'location', 'zoneType', 'note'].forEach(k => { sensor[k] = $('sf-' + k).value.trim(); });
  ['tMin', 'tWarn', 'tMax', 'hMax', 'calOffset'].forEach(k => { const v = $('sf-' + k).value; sensor[k] = v === '' ? '' : Number(v); });
  if (!sensor.deviceId) { $('sf-err').textContent = 'กรุณาระบุรหัสอุปกรณ์'; $('sf-err').classList.remove('hidden'); return; }
  await busy(btn, async () => {
    const r = await api('saveSensor', { sensor });
    if (!r.ok) { $('sf-err').textContent = errMsg(r); $('sf-err').classList.remove('hidden'); return; }
    closeModal();
    toast((id ? 'บันทึก ' : 'เพิ่ม ') + r.sensor.sensorId + ' แล้ว' + (id ? '' : ' — จะเริ่มอ่านค่าในรอบถัดไป'));
    S.ov = null;
    if (S.tab === 'settings') loadSettings();
  });
}

// ==================== Modal ====================
const closeBtn = () => `<button class="btn btn-ghost btn-icon btn-sm" onclick="closeModal()" aria-label="ปิด">${icon('x')}</button>`;
function openModal(html) {
  $('modal-root').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()">${html}</div>`;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('modal-root').innerHTML = '';
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('modal-root').firstChild) closeModal(); });

// ==================== Boot ====================
(async function boot() {
  if (MOCK) {
    try { await loadScript('dev/gas-fakes.js'); await loadScript('mock-api.js'); }
    catch (e) { document.body.innerHTML = '<p style="padding:24px">โหลดโหมดทดสอบไม่ได้</p>'; return; }
  }
  if ('serviceWorker' in navigator && !MOCK && !IS_LOCAL) navigator.serviceWorker.register('sw.js').catch(() => {});
  const sess = loadSession();
  if (sess) {
    S.session = sess;
    const r = await api('me');
    if (r.ok) return afterAuth(r.user);
  }
  showLogin();
})();
