// Service Worker — ติดตั้งเป็นแอปบนมือถือได้ และเปิดได้แม้เน็ตช้า
// - ไฟล์ของเว็บ: ใช้จากเน็ตก่อน (รอไม่เกิน 3 วินาที) ถ้าช้า/ออฟไลน์ใช้ของที่แคชไว้ → แก้ไฟล์บน GitHub แล้วมีผลทันที
// - ฟอนต์ Google: ใช้จากแคชก่อน
// - ไม่แคช API (Apps Script) และ Google Sign-In (ข้อมูลอุณหภูมิต้องเป็นค่าล่าสุดเสมอ)
const CACHE = 'sala-temp-gpp-v2';
const SHELL = ['./', './index.html', './app.css', './app.js', './config.js', './logo.png', './icon-192.png', './icon-512.png', './manifest.webmanifest', './apps-script/ReportGrid.gs'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('sala-temp-gpp-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const put = (req, res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const network = fetch(req).then(res => put(req, res));
    const fallback = () => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'));
    const timeout = new Promise(resolve => setTimeout(resolve, 3000));
    e.respondWith(Promise.race([network, timeout]).then(res => res || fallback()).catch(fallback));
    return;
  }
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => put(req, res))));
  }
});
