// =====================================================
// Providers.gs — ตัวเชื่อม Cloud API ของเครื่องวัดแต่ละยี่ห้อ (ทุกตัวมี interface เดียวกัน)
//   list(account)                → [{ deviceId, name, type, isSensor, online }]
//   read(account, deviceIds, now) → { [deviceId]: { online, temp, hum, battery, ts, error } }
//
// รหัสลับของแต่ละบัญชีเก็บใน Script Properties ชื่อ CRED_<accountId> (ห้ามใส่ในชีตหรือ repo)
//   SwitchBot: {"token":"...","secret":"..."}
//   Tuya:      {"clientId":"...","secret":"...","baseUrl":"https://openapi.tuyaus.com","tempDiv":10}
// =====================================================

const PROVIDERS = {};

function providerFor(acc) {
  const p = PROVIDERS[lower(acc.provider)];
  if (!p) throw fail('bad_provider', 'ไม่รู้จักผู้ให้บริการ: ' + acc.provider);
  return p;
}

function accountCred(acc) {
  const raw = PropertiesService.getScriptProperties().getProperty('CRED_' + str(acc.accountId));
  if (!raw) throw fail('no_credential', 'ยังไม่ได้ใส่ Script Property CRED_' + str(acc.accountId));
  try { return JSON.parse(raw); } catch (e) { throw fail('bad_credential', 'CRED_' + str(acc.accountId) + ' ไม่ใช่ JSON ที่ถูกต้อง'); }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

function bytesToHex(bytes) {
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function hmacSha256(value, key) {
  return Utilities.computeHmacSha256Signature(value, key, Utilities.Charset.UTF_8);
}

function sha256Hex(value) {
  return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
}

// ── SwitchBot (API v1.1) ──────────────────────────────
// ใช้ได้กับ Meter / Meter Plus / Outdoor Meter / Meter Pro / Hub 2 (ต้องมี Hub และเปิด Cloud Service ในแอป)
// โควตา 10,000 ครั้ง/วัน/บัญชี — อ่านทีละเครื่อง
const SWITCHBOT_BASE = 'https://api.switch-bot.com';

function switchbotSign(token, secret, t, nonce) {
  return Utilities.base64Encode(hmacSha256(token + t + nonce, secret));
}

function switchbotHeaders(c) {
  const t = String(Date.now());
  const nonce = Utilities.getUuid();
  return { Authorization: c.token, sign: switchbotSign(c.token, c.secret, t, nonce), t, nonce };
}

function switchbotCheckAuth(res) {
  if (res.getResponseCode() === 401) throw fail('provider_auth', 'SwitchBot ปฏิเสธ token (token/secret ผิด หรือใช้เกินโควตา 10,000 ครั้ง/วัน)');
}

PROVIDERS.switchbot = {
  list(acc) {
    const c = accountCred(acc);
    const res = UrlFetchApp.fetch(SWITCHBOT_BASE + '/v1.1/devices', { headers: switchbotHeaders(c), muteHttpExceptions: true });
    switchbotCheckAuth(res);
    const j = parseJson(res.getContentText());
    if (!j || j.statusCode !== 100) throw fail('provider', 'SwitchBot: ' + (j && j.message || res.getResponseCode()));
    return (j.body.deviceList || []).map(d => ({
      deviceId: str(d.deviceId), name: str(d.deviceName), type: str(d.deviceType),
      isSensor: /meter|hub ?[23]|thermo|woiosensor/i.test(str(d.deviceType)),
      online: d.enableCloudService !== false,
      note: d.enableCloudService === false ? 'ยังไม่ได้เปิด Cloud Service ในแอป SwitchBot' : '',
    }));
  },
  read(acc, ids, now) {
    const c = accountCred(acc);
    const reqs = ids.map(id => ({
      url: SWITCHBOT_BASE + '/v1.1/devices/' + encodeURIComponent(id) + '/status',
      headers: switchbotHeaders(c), muteHttpExceptions: true,
    }));
    const out = {};
    UrlFetchApp.fetchAll(reqs).forEach((res, i) => {
      switchbotCheckAuth(res);
      const j = parseJson(res.getContentText());
      const b = j && j.body;
      if (j && j.statusCode === 100 && b && isFinite(b.temperature) && b.temperature !== null) {
        out[ids[i]] = { online: true, temp: Number(b.temperature), hum: num(b.humidity), battery: num(b.battery), ts: now };
      } else {
        // 161 = เครื่องออฟไลน์ · 171 = Hub ออฟไลน์ · 190 = ข้อมูลยังไม่ซิงก์
        out[ids[i]] = { online: false, error: 'switchbot_' + (j && j.statusCode || res.getResponseCode()) };
      }
    });
    return out;
  },
};

// ── Tuya / Smart Life (Tuya IoT Platform OpenAPI) ─────
// ต้องสร้าง Cloud Project ที่ iot.tuya.com แล้ว Link บัญชีแอป Smart Life/Tuya Smart เข้ากับโปรเจกต์
// baseUrl ต้องตรงกับ Data Center ของบัญชีแอป เช่น https://openapi.tuyaus.com (Western America),
// https://openapi.tuyaeu.com (Central Europe), https://openapi.tuyain.com (India), https://openapi.tuyacn.com (China)
function tuyaStringToSign(method, body, pathWithQuery) {
  return method + '\n' + sha256Hex(body || '') + '\n' + '' + '\n' + pathWithQuery;
}

function tuyaSign(text, secret) {
  return bytesToHex(hmacSha256(text, secret)).toUpperCase();
}

function tuyaPath(path, query) {
  const keys = Object.keys(query || {}).filter(k => query[k] !== '' && query[k] != null).sort();
  return keys.length ? path + '?' + keys.map(k => k + '=' + query[k]).join('&') : path;
}

function tuyaBase(c) {
  return String(c.baseUrl || 'https://openapi.tuyaus.com').replace(/\/+$/, '');
}

function tuyaToken(c, forceNew) {
  const cache = CacheService.getScriptCache();
  const key = 'tuya:' + c.clientId;
  if (!forceNew) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const path = '/v1.0/token?grant_type=1';
  const t = String(Date.now());
  const nonce = Utilities.getUuid();
  const sign = tuyaSign(c.clientId + t + nonce + tuyaStringToSign('GET', '', path), c.secret);
  const res = UrlFetchApp.fetch(tuyaBase(c) + path, {
    headers: { client_id: c.clientId, sign, t, nonce, sign_method: 'HMAC-SHA256' }, muteHttpExceptions: true,
  });
  const j = parseJson(res.getContentText());
  if (!j || !j.success) throw fail('provider_auth', 'Tuya token: ' + (j && (j.code + ' ' + j.msg) || res.getResponseCode()));
  const ttl = Math.max(60, Math.min(21600, Number(j.result.expire_time || 7200) - 120));
  cache.put(key, j.result.access_token, ttl);
  return j.result.access_token;
}

function tuyaGet(c, path, query, retried) {
  const token = tuyaToken(c, retried);
  const pq = tuyaPath(path, query);
  const t = String(Date.now());
  const nonce = Utilities.getUuid();
  const sign = tuyaSign(c.clientId + token + t + nonce + tuyaStringToSign('GET', '', pq), c.secret);
  const res = UrlFetchApp.fetch(tuyaBase(c) + pq, {
    headers: { client_id: c.clientId, access_token: token, sign, t, nonce, sign_method: 'HMAC-SHA256' }, muteHttpExceptions: true,
  });
  const j = parseJson(res.getContentText());
  if (j && j.success) return j.result;
  if (!retried && j && (j.code === 1010 || j.code === 1011)) return tuyaGet(c, path, query, true);   // token หมดอายุ
  throw fail('provider', 'Tuya ' + path + ': ' + (j && (j.code + ' ' + j.msg) || res.getResponseCode()));
}

// รายการอุปกรณ์ทั้งหมดของบัญชีแอปที่ link ไว้ (ได้ทั้งสถานะ online และค่าล่าสุดในการเรียกเดียว · ทีละ 100 เครื่อง)
function tuyaDevices(c) {
  const all = [];
  let rowKey = '';
  for (let page = 0; page < 20; page++) {
    const r = tuyaGet(c, '/v1.0/iot-01/associated-users/devices', { size: 100, last_row_key: rowKey });
    (r.devices || []).forEach(d => all.push(d));
    rowKey = r.last_row_key || '';
    if (!r.has_more || !rowKey) break;
  }
  return all;
}

function tuyaValues(d, c) {
  const st = {};
  (d.status || []).forEach(x => { st[x.code] = x.value; });
  const div = Number(c.tempDiv) || 10;
  const tRaw = ['va_temperature', 'temp_current', 'temp_indoor'].map(k => st[k]).find(v => v !== undefined);
  const hRaw = ['va_humidity', 'humidity_value', 'humidity_indoor'].map(k => st[k]).find(v => v !== undefined);
  let battery = num(st.battery_percentage);
  if (battery == null && st.battery_state) battery = { low: 10, middle: 50, high: 100 }[st.battery_state] || null;
  return {
    temp: tRaw === undefined ? null : Number(tRaw) / div,
    hum: hRaw === undefined ? null : Number(hRaw),
    battery,
  };
}

PROVIDERS.tuya = {
  list(acc) {
    const c = accountCred(acc);
    return tuyaDevices(c).map(d => {
      const v = tuyaValues(d, c);
      return {
        deviceId: str(d.id), name: str(d.name), type: str(d.product_name || d.category),
        isSensor: v.temp !== null || /wsdcg|wkcz/.test(str(d.category)), online: !!d.online,
        note: v.temp !== null ? 'ค่าล่าสุด ' + round1(v.temp) + '°C' : '',
      };
    });
  },
  read(acc, ids, now) {
    const c = accountCred(acc);
    const byId = {};
    tuyaDevices(c).forEach(d => { byId[str(d.id)] = d; });
    const out = {};
    ids.forEach(id => {
      const d = byId[id];
      if (!d) { out[id] = { online: false, error: 'tuya_not_found' }; return; }
      const v = tuyaValues(d, c);
      if (!d.online || v.temp === null || !isFinite(v.temp)) { out[id] = { online: false, error: d.online ? 'tuya_no_temp' : 'tuya_offline' }; return; }
      out[id] = { online: true, temp: v.temp, hum: v.hum, battery: v.battery, ts: now };
    });
    return out;
  },
};

// ── Mock (ทดสอบระบบโดยไม่ต้องมีเครื่องจริง) ───────────
// บังคับค่าได้ด้วย Script Property MOCK_FORCE เช่น {"mock-fridge-1": 11.5, "mock-room-2": "offline"}
const MOCK_DEVICES = [
  { deviceId: 'mock-room-1',    name: 'จำลอง: ห้องขายยา A',  type: 'Mock Meter' },
  { deviceId: 'mock-store-1',   name: 'จำลอง: ห้องเก็บยา A',  type: 'Mock Meter' },
  { deviceId: 'mock-fridge-1',  name: 'จำลอง: ตู้เย็น A',     type: 'Mock Outdoor Meter' },
  { deviceId: 'mock-room-2',    name: 'จำลอง: ห้องขายยา B',  type: 'Mock Meter' },
  { deviceId: 'mock-fridge-2x', name: 'จำลอง: ตู้เย็น B (ผิดเกณฑ์บ่ายวันเว้นสองวัน)', type: 'Mock Outdoor Meter' },
  { deviceId: 'mock-room-3',    name: 'จำลอง: ห้องขายยา C',  type: 'Mock Meter' },
  { deviceId: 'mock-fridge-3',  name: 'จำลอง: ตู้เย็น C',     type: 'Mock Outdoor Meter' },
];

function mockHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mockNoise(seed, slot) {
  return ((mockHash(seed + ':' + slot) % 1000) / 1000 - 0.5);   // -0.5..0.5
}

function mockReading(id, now) {
  const slot = Math.floor(now / 900000);                  // ช่วงละ 15 นาที
  const h = ((now / 3600000) + 7) % 24;                    // ชั่วโมงตามเวลาไทย
  const day = Math.floor((now / 3600000 + 7) / 24);
  const seed = mockHash(id);
  const n = mockNoise(id, slot);
  if (/fridge/.test(id)) {
    let temp = 4.8 + 1.1 * Math.sin(2 * Math.PI * (h - 10) / 24) + (seed % 5) * 0.2 + n * 0.6;
    if (/x$/.test(id) && day % 3 === 1 && h >= 14 && h < 15.75) temp = 9.2 + n;   // ประตูตู้เย็นปิดไม่สนิท
    return { temp: round1(temp), hum: round1(45 + n * 6), battery: 100 - (day % 90) };
  }
  let temp = 24.6 + 2.6 * Math.sin(2 * Math.PI * (h - 9) / 24) + (seed % 4) * 0.5 + n * 0.5;
  if (/3$/.test(id) && day % 4 === 2 && h >= 13 && h < 16) temp = 30.8 + n;      // แอร์เสียช่วงบ่าย
  return { temp: round1(temp), hum: round1(60 + 8 * Math.sin(2 * Math.PI * (h - 4) / 24) + n * 4), battery: 80 - (day % 70) };
}

PROVIDERS.mock = {
  list() {
    return MOCK_DEVICES.map(d => Object.assign({ isSensor: true, online: true, note: '' }, d));
  },
  read(acc, ids, now) {
    let force = {};
    try { force = JSON.parse(PropertiesService.getScriptProperties().getProperty('MOCK_FORCE') || '{}'); } catch (e) {}
    const out = {};
    ids.forEach(id => {
      const f = force[id];
      if (f === 'offline') { out[id] = { online: false, error: 'mock_offline' }; return; }
      const r = mockReading(id, now);
      if (typeof f === 'number') r.temp = f;
      out[id] = { online: true, temp: r.temp, hum: r.hum, battery: r.battery, ts: now };
    });
    return out;
  },
};
