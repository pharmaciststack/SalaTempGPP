/* =====================================================
   gas-fakes.js — จำลองบริการ Google Apps Script (Sheets/Drive/Properties/Cache/UrlFetch ฯลฯ) ในหน่วยความจำ
   ใช้ได้ทั้งใน Node (tests/run.mjs) และในเบราว์เซอร์ (mock-api.js โหมด ?mock)
   ===================================================== */
(function (root) {
  'use strict';

  function createGasFakes(opts) {
    opts = opts || {};
    const state = opts.state || { files: {}, props: {}, seq: 1, activeId: null, folders: {} };
    const cache = opts.cache || {};
    const sent = { http: [], mail: [] };
    let httpHandler = opts.http || (() => ({ code: 200, body: '{}' }));
    let triggers = [];

    const newId = p => (p || 'id') + '_' + (state.seq++);

    // ── Sheets ──
    function Range(sheet, r, c, nr, nc) {
      this.getValues = () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = sheet._d[r - 1 + i] || [];
          const o = [];
          for (let j = 0; j < nc; j++) {
            const v = row[c - 1 + j];
            o.push(v === undefined || v === null ? '' : revive(v));
          }
          out.push(o);
        }
        return out;
      };
      this.getValue = () => this.getValues()[0][0];
      this.setValues = vals => {
        if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('setValues: size mismatch ' + nr + 'x' + nc);
        for (let i = 0; i < nr; i++) {
          const ri = r - 1 + i;
          while (sheet._d.length <= ri) sheet._d.push([]);
          for (let j = 0; j < nc; j++) sheet._d[ri][c - 1 + j] = store(vals[i][j]);
        }
        return this;
      };
      this.setValue = v => this.setValues([[v]]);
    }
    // Sheets เก็บ Date เป็นวันที่, ตัด ' นำหน้าข้อความ
    function store(v) {
      if (v instanceof Date) return { $d: v.getTime() };
      if (typeof v === 'string' && v[0] === "'") return v.slice(1);
      return v;
    }
    function revive(v) { return v && typeof v === 'object' && '$d' in v ? new Date(v.$d) : v; }

    function Sheet(file, name) {
      const data = file.sheets.find(s => s.name === name);
      this._d = data.data;
      this.getName = () => name;
      this.getLastRow = () => {
        for (let i = this._d.length - 1; i >= 0; i--) if ((this._d[i] || []).some(v => v !== '' && v != null)) return i + 1;
        return 0;
      };
      this.getLastColumn = () => this._d.reduce((m, r) => Math.max(m, (r || []).length), 0);
      this.getRange = (r, c, nr, nc) => new Range(this, r, c, nr || 1, nc || 1);
      this.getDataRange = () => new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
      this.appendRow = row => { this._d.splice(this.getLastRow(), 0, row.map(store)); return this; };
      this.setFrozenRows = () => this;
      this.deleteRows = (r, n) => { this._d.splice(r - 1, n || 1); };
    }

    function Spreadsheet(id) {
      const f = state.files[id];
      this.getId = () => id;
      this.getName = () => f.name;
      this.getUrl = () => 'https://docs.google.com/spreadsheets/d/' + id;
      this.getSheetByName = n => (f.sheets.some(s => s.name === n) ? new Sheet(f, n) : null);
      this.getSheets = () => f.sheets.map(s => new Sheet(f, s.name));
      this.insertSheet = n => { f.sheets.push({ name: n, data: [] }); return new Sheet(f, n); };
    }

    function createSpreadsheet(name) {
      const id = newId('ss');
      state.files[id] = { kind: 'ss', name, sheets: [{ name: 'Sheet1', data: [] }], folder: null };
      return new Spreadsheet(id);
    }

    const SpreadsheetApp = {
      getActiveSpreadsheet() {
        if (!state.activeId) state.activeId = createSpreadsheet('SalaTemp (main)').getId();
        return new Spreadsheet(state.activeId);
      },
      openById(id) {
        if (!state.files[id] || state.files[id].kind !== 'ss') throw new Error('not found ' + id);
        return new Spreadsheet(id);
      },
      create: createSpreadsheet,
    };

    // ── Drive ──
    function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
    function Folder(id) {
      const f = state.folders[id];
      this.getId = () => id;
      this.getName = () => f.name;
      this.getFoldersByName = n => iter(Object.keys(state.folders).filter(k => state.folders[k].parent === id && state.folders[k].name === n).map(k => new Folder(k)));
      this.createFolder = n => { const k = newId('fd'); state.folders[k] = { name: n, parent: id }; return new Folder(k); };
      this.getFilesByName = n => iter(Object.keys(state.files).filter(k => state.files[k].folder === id && state.files[k].name === n && !state.files[k].trashed).map(k => new File(k)));
      this.createFile = blob => {
        const k = newId('file');
        state.files[k] = { kind: 'blob', name: blob.getName(), folder: id, size: (blob._content || '').length, content: opts.keepBlobs ? blob._content : '' };
        return new File(k);
      };
    }
    function File(id) {
      this.getId = () => id;
      this.getName = () => state.files[id].name;
      this.getUrl = () => 'https://drive.google.com/file/d/' + id + '/view';
      this.moveTo = folder => { state.files[id].folder = folder.getId(); return this; };
      this.setTrashed = v => { state.files[id].trashed = !!v; return this; };
    }
    const DriveApp = {
      getFoldersByName: n => iter(Object.keys(state.folders).filter(k => !state.folders[k].parent && state.folders[k].name === n).map(k => new Folder(k))),
      createFolder: n => { const k = newId('fd'); state.folders[k] = { name: n, parent: null }; return new Folder(k); },
      getFileById: id => { if (!state.files[id]) throw new Error('no file'); return new File(id); },
    };

    // ── Properties / Cache / Lock ──
    const PropertiesService = {
      getScriptProperties: () => ({
        getProperty: k => (k in state.props ? state.props[k] : null),
        setProperty: (k, v) => { state.props[k] = String(v); },
        deleteProperty: k => { delete state.props[k]; },
        getProperties: () => Object.assign({}, state.props),
      }),
    };
    const CacheService = {
      getScriptCache: () => ({
        get: k => { const e = cache[k]; return e && e.exp > Date.now() ? e.v : null; },
        put: (k, v, ttl) => { cache[k] = { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }; },
        remove: k => { delete cache[k]; },
      }),
    };
    const LockService = { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) };

    // ── Utilities ──
    const fmtCache = {};
    function parts(d, tz) {
      const key = tz;
      const f = fmtCache[key] || (fmtCache[key] = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }));
      const o = {};
      f.formatToParts(d).forEach(p => { o[p.type] = p.value; });
      return o;
    }
    const Utilities = {
      Charset: { UTF_8: 'utf8' },
      DigestAlgorithm: { SHA_256: 'sha256' },
      getUuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      }),
      formatDate(d, tz, pattern) {
        const p = parts(d, tz);
        const map = { yyyy: p.year, yy: p.year.slice(2), MM: p.month, M: String(Number(p.month)), dd: p.day, d: String(Number(p.day)),
                      HH: p.hour, H: String(Number(p.hour)), mm: p.minute, ss: p.second };
        return pattern.replace(/yyyy|yy|MM|M|dd|d|HH|H|mm|ss/g, t => map[t]);
      },
      parseDate(s, tz) {
        const [y, m, d] = s.split('-').map(Number);
        const guess = Date.UTC(y, m - 1, d);
        const p = parts(new Date(guess), tz);
        const off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess;
        return new Date(guess - off);
      },
      base64Encode(v) {
        const bytes = typeof v === 'string' ? Array.from(new TextEncoder().encode(v)) : v.map(b => b & 0xff);
        if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
        return btoa(String.fromCharCode.apply(null, bytes));
      },
      computeHmacSha256Signature(value, key) {
        if (!opts.crypto) throw new Error('HMAC ใช้ได้เฉพาะตอนทดสอบใน Node');
        return Array.from(opts.crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(Buffer.from(value, 'utf8')).digest()).map(b => (b > 127 ? b - 256 : b));
      },
      computeDigest(alg, value) {
        if (!opts.crypto) throw new Error('digest ใช้ได้เฉพาะตอนทดสอบใน Node');
        return Array.from(opts.crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest()).map(b => (b > 127 ? b - 256 : b));
      },
      sleep() {},
    };

    // ── UrlFetch / Mail / Html / Script ──
    function Resp(r) {
      this.getResponseCode = () => r.code;
      this.getContentText = () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    }
    const UrlFetchApp = {
      fetch(url, o) {
        const req = Object.assign({ url, method: 'get' }, o || {});
        sent.http.push(req);
        return new Resp(httpHandler(req));
      },
      fetchAll(reqs) { return reqs.map(r => UrlFetchApp.fetch(r.url, r)); },
    };
    const MailApp = { sendEmail(o) { sent.mail.push(o); } };
    function Blob(content, name) {
      this._content = content;
      this.getName = () => name;
      this.setName = n => { name = n; return this; };
      this.getAs = () => new Blob(content, name);
    }
    const HtmlService = { createHtmlOutput: html => ({ getContent: () => html, getBlob: () => new Blob(html, 'report.html') }) };
    function Builder(fn) {
      const t = { fn, spec: {} };
      const b = {
        timeBased: () => b, everyMinutes: n => { t.spec.minutes = n; return b; }, everyHours: n => { t.spec.hours = n; return b; },
        everyDays: n => { t.spec.days = n; return b; }, atHour: h => { t.spec.hour = h; return b; }, nearMinute: () => b,
        onMonthDay: d => { t.spec.monthDay = d; return b; },
        create: () => { triggers.push(t); return { getHandlerFunction: () => fn }; },
      };
      return b;
    }
    const ScriptApp = {
      getProjectTriggers: () => triggers.map(t => ({ getHandlerFunction: () => t.fn, _t: t })),
      deleteTrigger: x => { triggers = triggers.filter(t => t !== x._t); },
      newTrigger: fn => Builder(fn),
    };
    const ContentService = {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }),
    };
    const Session = { getScriptTimeZone: () => 'Asia/Bangkok' };

    const globals = { SpreadsheetApp, DriveApp, PropertiesService, CacheService, LockService, Utilities, UrlFetchApp, MailApp,
                      HtmlService, ScriptApp, ContentService, Session };
    return {
      globals, state, sent,
      setHttp(fn) { httpHandler = fn; },
      triggers: () => triggers.map(t => ({ fn: t.fn, spec: t.spec })),
      clearCache() { Object.keys(cache).forEach(k => delete cache[k]); },
    };
  }

  // โหลดไฟล์ .gs ทั้งหมดเป็นโมดูลเดียว — คืนฟังก์ชันระดับบนทั้งหมด
  function loadGas(sources, fakes) {
    const src = sources.join('\n;\n');
    const names = [];
    src.replace(/^function\s+([A-Za-z_$][\w$]*)/gm, (m, n) => { names.push(n); return m; });
    src.replace(/^const\s+([A-Z_][A-Z0-9_]*)\s*=/gm, (m, n) => { names.push(n); return m; });
    const keys = Object.keys(fakes.globals);
    const fn = new Function(keys.join(','), src + '\nreturn {' + names.join(',') + '};');
    return fn.apply(null, keys.map(k => fakes.globals[k]));
  }

  const api = { createGasFakes, loadGas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GasFakes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
