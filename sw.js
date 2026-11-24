/* Itaporã Food+ — service worker. Para publicar uma atualização, troque VERSION (v10, v11...). */
const VERSION = "v15";
const CORE = "itapora-core-" + VERSION, RUNTIME = "itapora-rt-" + VERSION, IMGS = "itapora-img-" + VERSION;
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const CDN = ["cdn.tailwindcss.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
const MAX_IMGS = 150;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CORE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![CORE, RUNTIME, IMGS].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* Página inicial: rede primeiro; sem internet ou com conexão lenta (4 s) abre a cópia salva */
async function pageFirst(req, ev) {
  const cache = await caches.open(CORE);
  const net = fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); return r; });
  const saved = async () => (await cache.match(req)) || (await cache.match("index.html")) || (await cache.match("./"));
  try {
    const r = await Promise.race([net, new Promise(res => setTimeout(() => res(null), 4000))]);
    if (r) return r;
    const c = await saved();
    if (c) { ev.waitUntil(net.catch(() => {})); return c; }
    return await net;
  } catch (e) {
    const c = await saved();
    if (c) return c;
    throw e;
  }
}
/* Mostra a cópia salva na hora e atualiza em segundo plano */
async function swr(req, name, ev) {
  const cache = await caches.open(name), hit = await cache.match(req);
  const net = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) cache.put(req, r.clone()); return r; }).catch(() => hit);
  if (hit) { ev.waitUntil(net); return hit; }
  return net;
}
async function imgCache(req) {
  const cache = await caches.open(IMGS), hit = await cache.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r && r.ok) {
    cache.put(req, r.clone());
    cache.keys().then(ks => { if (ks.length > MAX_IMGS) ks.slice(0, ks.length - MAX_IMGS).forEach(k => cache.delete(k)); });
  }
  return r;
}

self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.headers.has("range") || req.destination === "video" || req.destination === "audio" || /\.(mp4|webm|mov|m4v)$/i.test(url.pathname)) return; /* vídeos: sempre rede */
  if (url.searchParams.has("ping")) return;                                                                                              /* teste de conexão */
  if (url.origin === location.origin) {
    if (/admin\.html$/i.test(url.pathname)) return;                                                                                      /* painel nunca passa pelo cache */
    if (req.mode === "navigate" || /\/(index\.html)?$/.test(url.pathname)) return ev.respondWith(pageFirst(req, ev));
    return ev.respondWith(swr(req, CORE, ev));
  }
  if (/\.supabase\.co$/.test(url.hostname)) {
    if (url.pathname.startsWith("/storage/v1/object/public/") && req.destination === "image") return ev.respondWith(imgCache(req));
    return;                                                                                                                              /* dados e login: sempre rede */
  }
  if (CDN.includes(url.hostname)) return ev.respondWith(swr(req, RUNTIME, ev));
});
