// Offline support: everything the game needs is cached on first visit.
// Bump CACHE when the list of files changes.
const CACHE = 'match-busters-v13';
const THREE = './vendor/three-0.160.0/';
const JSM = THREE + 'examples/jsm/';
const ASSETS = [
  './',
  './index.html',
  './render-2d.js',
  './render-3d.js',
  './frame-rate.js',
  './music.js',
  './board-layout.js',
  './ice.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  THREE + 'build/three.module.js',
  JSM + 'postprocessing/EffectComposer.js',
  JSM + 'postprocessing/RenderPass.js',
  JSM + 'postprocessing/UnrealBloomPass.js',
  JSM + 'postprocessing/OutputPass.js',
  JSM + 'postprocessing/ShaderPass.js',
  JSM + 'postprocessing/MaskPass.js',
  JSM + 'postprocessing/Pass.js',
  JSM + 'shaders/CopyShader.js',
  JSM + 'shaders/LuminosityHighPassShader.js',
  JSM + 'shaders/OutputShader.js',
  JSM + 'environments/RoomEnvironment.js',
  JSM + 'geometries/RoundedBoxGeometry.js',
];

const cached = (request, options) => caches.open(CACHE).then(cache => cache.match(request, options));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('match-busters-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  if (sameOrigin) {
    // The game's own files: try the network so updates arrive, fall back to the cache offline.
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => cached(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? cached('./index.html') : Response.error())))
    );
  }
});
