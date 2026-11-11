const assert = require('node:assert/strict');
const { readFile, stat } = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { test, before, after } = require('node:test');
const vm = require('node:vm');
const playwright = require('playwright');

const root = path.resolve(__dirname, '..');
const prefix = '/match-busters/';
let browser, server, origin, legacy = false;

// An installed v3 worker and shell, for testing the update path.
const legacyWorker = `
const CACHE = 'match-busters-v3';
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(['./', './index.html'])).then(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => e.respondWith(
  fetch(e.request).catch(() => caches.match(e.request))
));
`;
const legacyHTML = '<!doctype html><title>Old game</title><script>navigator.serviceWorker.register("./sw.js")</script>';

before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
      const file = url.pathname.slice(prefix.length) || 'index.html';
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      if (legacy && file === 'sw.js') res.end(legacyWorker);
      else if (legacy && file === 'index.html') res.end(legacyHTML);
      else res.end(await readFile(path.join(root, file)));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const engine = process.env.TEST_BROWSER || 'chromium';
  browser = await playwright[engine].launch(engine === 'chromium' ? {
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--enable-unsafe-swiftshader'],
  } : {});
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

test('all imports resolve locally and are precached without import maps', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /type=["']importmap["']/);
  const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
  const sandbox = { self: { addEventListener() {} } };
  vm.runInNewContext(sw + '\nglobalThis.assets = ASSETS;', sandbox);
  const cached = new Set(sandbox.assets.map(p => path.resolve(root, p)));
  for (const asset of cached) assert.ok(await stat(asset), `Missing cached asset: ${asset}`);
  const visited = new Set();
  async function checkImports(text, parent) {
    for (const [, spec] of text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      assert.ok(spec.startsWith('.'), `Non-relative import: ${spec}`);
      const file = path.resolve(path.dirname(parent), spec);
      assert.ok(cached.has(file), `Not precached: ${spec}`);
      if (visited.has(file)) continue;
      visited.add(file);
      await checkImports(await readFile(file, 'utf8'), file);
    }
  }
  await checkImports(html, path.join(root, 'index.html'));
  assert.equal(visited.size, 13);
});

async function newPage(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ...options });
  t.after(() => context.close());
  const external = [], errors = [];
  context.on('request', req => {
    if (new URL(req.url()).origin !== origin) external.push(req.url());
  });
  // A fresh visit must work with every third-party host blocked.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', err => errors.push(err.message));
  return { context, page, external, errors };
}

async function play(page) {
  await page.waitForFunction(() => !!window.__mb);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('.lvBtn').first().click();
  await page.waitForFunction(() => __mb.G.grid.flat().every(p => p.y === p.r));
  assert.equal(await page.evaluate(() => __mb.G.grid.flat().length), 64);
  // Use the normal pointer input to make a legal match.
  const move = await page.evaluate(() => __mb.findMove());
  const box = await page.locator('#board').boundingBox();
  for (const cell of move) {
    await page.mouse.click(box.x + box.width * (cell.c + 0.5) / 8, box.y + box.height * (cell.r + 0.5) / 8);
  }
  await page.waitForFunction(() => __mb.G.score > 0 && !__mb.G.busy);
  assert.equal(await page.locator('#sLeft').textContent(), '19');
}

test('cold load, a match, and offline reload work under a GitHub Pages subpath', { timeout: 60000 }, async t => {
  const { context, page, external, errors } = await newPage(t);
  await page.goto(origin + prefix);
  await play(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['match-busters-v4']);
  await context.setOffline(true);
  await page.reload();
  await play(page);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('#loadErr').isVisible(), false);
});

test('an existing v3 installation updates and then works offline', { timeout: 60000 }, async t => {
  legacy = true;
  t.after(() => { legacy = false; });
  const { context, page, external, errors } = await newPage(t);
  await page.goto(origin + prefix);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['match-busters-v3']);
  legacy = false;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    await registration.update();
    await changed;
  });
  await page.waitForFunction(async () => (await caches.keys()).join() === 'match-busters-v4');
  await context.setOffline(true);
  await page.reload();
  await play(page);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
});

test('smooth graphics reduce Retina rendering cost and persist without changing progress', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t, { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    // Existing progress from before the graphics setting was introduced.
    if (!localStorage.getItem('matchbusters')) localStorage.setItem('matchbusters', JSON.stringify({ stars: [2], sound: false, music: false }));
  });
  await page.goto(origin + prefix);
  await play(page);
  assert.equal(await page.evaluate(() => __mb.save.smooth), true);
  await page.evaluate(() => { __mb.setPaused(true); __mb.show('settings'); });
  const board = await page.evaluate(() => __mb.G.grid.map(row => row.map(p => p.t)));
  async function measure() {
    return page.evaluate(() => {
      const renderer = __mb.renderer;
      renderer.info.autoReset = false;
      renderer.info.reset();
      __mb.render(0);
      const stats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        pixels: renderer.domElement.width * renderer.domElement.height,
        material: __mb.G.grid[0][0].mesh.userData.mat.type };
      renderer.info.autoReset = true;
      return stats;
    });
  }
  const smooth = await measure();
  assert.equal(smooth.material, 'MeshPhongMaterial');
  await page.getByRole('switch', { name: 'Smooth graphics' }).click();
  const detailed = await measure();
  assert.equal(detailed.material, 'MeshStandardMaterial');
  assert.equal(detailed.pixels, smooth.pixels * 4);
  assert.ok(smooth.triangles < detailed.triangles / 2, JSON.stringify({ smooth, detailed }));
  assert.ok(smooth.calls < detailed.calls, JSON.stringify({ smooth, detailed }));
  assert.deepEqual(await page.evaluate(() => __mb.G.grid.map(row => row.map(p => p.t))), board);
  // Pausing must stop submitting frames to the GPU.
  await page.evaluate(() => { __mb.renderer.info.autoReset = false; __mb.renderer.info.reset(); });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => __mb.renderer.info.render.calls), 0);
  await page.reload();
  await page.waitForFunction(() => !!window.__mb);
  assert.equal(await page.evaluate(() => __mb.save.smooth), false);
  assert.deepEqual(await page.evaluate(() => __mb.save.stars), [2]);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Smooth graphics' }).click();
  await page.reload();
  await play(page);
  assert.equal(await page.evaluate(() => __mb.save.smooth), true);
  assert.deepEqual(errors, []);
  t.diagnostic(JSON.stringify({ smooth, detailed }));
});
