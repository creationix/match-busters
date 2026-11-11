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

// An installed v11 worker and shell, for testing the update path.
const legacyWorker = `
const CACHE = 'match-busters-v11';
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
    for (const [, spec] of text.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g)) {
      assert.ok(spec.startsWith('.'), `Non-relative import: ${spec}`);
      const file = path.resolve(path.dirname(parent), spec);
      assert.ok(cached.has(file), `Not precached: ${spec}`);
      if (visited.has(file)) continue;
      visited.add(file);
      await checkImports(await readFile(file, 'utf8'), file);
    }
  }
  await checkImports(html, path.join(root, 'index.html'));
  assert.equal(visited.size, 21);
});

async function newPage(t, options = {}) {
  const { smooth = true, layout = 'classic', ...browserOptions } = options;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ...browserOptions });
  await context.addInitScript(({ smooth, layout }) => {
    const save = JSON.parse(localStorage.getItem('matchbusters') || '{}');
    if (smooth !== null && !('smooth' in save)) save.smooth = smooth;
    if (layout !== null && !('boardLayout' in save)) save.boardLayout = layout;
    localStorage.setItem('matchbusters', JSON.stringify(save));
  }, { smooth, layout });
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
  const points = await page.evaluate(cells => cells.map(cell => __mb.renderer.project(cell.c, cell.r)), move);
  for (const point of points) {
    await page.mouse.click(box.x + box.width * point.x, box.y + box.height * point.y);
  }
  await page.waitForFunction(() => __mb.G.score > 0 && !__mb.G.busy);
  assert.equal(await page.locator('#sLeft').textContent(), '19');
}

async function makeBoardMove(page, drag = false) {
  const move = await page.evaluate(() => __mb.findMove());
  const points = await page.evaluate(cells => cells.map(cell => __mb.renderer.project(cell.c, cell.r)), move);
  const box = await page.locator('#board').boundingBox();
  const [from, to] = points.map(point => ({ x: box.x + box.width * point.x, y: box.y + box.height * point.y }));
  const before = await page.evaluate(() => ({ score: __mb.G.score, moves: __mb.G.moves }));
  if (drag) {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
  } else { await page.mouse.click(from.x, from.y); await page.mouse.click(to.x, to.y); }
  await page.waitForFunction(score => __mb.G.score > score && !__mb.G.busy, before.score);
  assert.equal(await page.evaluate(() => __mb.G.moves), before.moves - 1);
}

test('cold load, a match, and offline reload work under a GitHub Pages subpath', { timeout: 60000 }, async t => {
  const { context, page, external, errors } = await newPage(t);
  await page.goto(origin + prefix);
  await play(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['match-busters-v15']);
  await context.setOffline(true);
  await page.reload();
  await play(page);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('#loadErr').isVisible(), false);
});

test('level types select distinct music playlists and music toggles preserve sound settings', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t);
  await page.goto(origin + prefix);
  await page.waitForFunction(() => !!window.__mb);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForFunction(() => !!__mb.music && __mb.music.state.enabled);
  const result = await page.evaluate(() => {
    const snapshots = [];
    for (const level of [0, 3, 1, 4, 2, 5]) {
      __mb.startLevel(level);
      snapshots.push({ level, ...__mb.music.state });
    }
    __mb.quit(); __mb.show('settings');
    return { snapshots, menu: __mb.music.state.category };
  });
  assert.deepEqual(result.snapshots.map(s => s.category), ['score', 'score', 'collect', 'collect', 'timed', 'timed']);
  for (let i = 0; i < 6; i += 2) assert.notEqual(result.snapshots[i].title, result.snapshots[i + 1].title);
  assert.equal(result.menu, 'menu');
  const sound = await page.evaluate(() => __mb.save.sound);
  await page.locator('#tMusic').click();
  assert.equal(await page.evaluate(() => __mb.music.state.enabled), false);
  assert.equal(await page.evaluate(() => __mb.save.sound), sound);
  await page.reload();
  await page.waitForFunction(() => !!window.__mb);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await page.evaluate(() => __mb.music.state.enabled), false);
  await page.locator('#tMusic').click();
  assert.equal(await page.evaluate(() => __mb.music.state.enabled), true);
  assert.deepEqual(errors, []);
});

test('all nine songs render audible, unclipped audio through real Web Audio nodes', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t);
  await page.goto(origin + prefix);
  const results = await page.evaluate(async () => {
    const { SONGS, createMusicPlayer } = await import('./music.js');
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const results = [];
    for (const song of SONGS) {
      const context = new Offline(1, 22050 * 6, 22050);
      // Schedule ahead before OfflineAudioContext starts its accelerated render.
      const clock = { state: 'running', currentTime: 0,
        createGain: () => context.createGain(), createOscillator: () => context.createOscillator() };
      const player = createMusicPlayer(clock, context.destination);
      const position = SONGS.filter(s => s.category === song.category).indexOf(song);
      for (let i = 0; i <= position; i++) player.setCategory(song.category);
      player.setEnabled(true);
      for (let time = 0; time < 6; time += 0.1) player.tick(time);
      const buffer = await context.startRendering(), samples = buffer.getChannelData(0);
      let sum = 0, peak = 0;
      for (const sample of samples) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      results.push({ title: song.title, rms: Math.sqrt(sum / samples.length), peak });
    }
    return results;
  });
  assert.equal(results.length, 9);
  for (const song of results) {
    assert.ok(song.rms > 0.002, `Silent song: ${JSON.stringify(song)}`);
    assert.ok(song.peak < 0.8, `Clipping song: ${JSON.stringify(song)}`);
  }
  assert.deepEqual(errors, []);
  t.diagnostic(JSON.stringify(results));
});

test('music follows pause, resume, and tab visibility without changing the Music preference', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t);
  await page.goto(origin + prefix);
  await play(page);
  await page.locator('#pauseBtn').click();
  const paused = await page.evaluate(() => __mb.music.state);
  assert.equal(paused.paused, true);
  assert.equal(paused.enabled, true);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => __mb.music.state.step), paused.step);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  assert.equal(await page.evaluate(() => __mb.music.state.paused), false);
  assert.equal(await page.evaluate(() => __mb.music.state.title), paused.title);
  await page.waitForFunction(step => __mb.music.state.step !== step, paused.step);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.evaluate(() => __mb.G.paused && __mb.music.state.paused), true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.evaluate(() => __mb.music.state.paused), true);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  assert.equal(await page.evaluate(() => __mb.music.state.paused), false);
  assert.equal(await page.evaluate(() => __mb.save.music), true);
  assert.deepEqual(errors, []);
});

test('an existing v11 installation updates and then works offline', { timeout: 60000 }, async t => {
  legacy = true;
  t.after(() => { legacy = false; });
  const { context, page, external, errors } = await newPage(t);
  await page.goto(origin + prefix);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['match-busters-v11']);
  legacy = false;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    await registration.update();
    await changed;
  });
  await page.waitForFunction(async () => (await caches.keys()).join() === 'match-busters-v15');
  await context.setOffline(true);
  await page.reload();
  await play(page);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
});

test('smooth graphics use cached 2D sprites with no WebGL or 3D imports', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t, { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await page.addInitScript(() => {
    window.webglAttempts = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type.includes('webgl')) { window.webglAttempts++; return null; }
      return getContext.call(this, type, ...args);
    };
    // This API is also absent on the affected iOS version.
    CanvasRenderingContext2D.prototype.roundRect = undefined;
  });
  await page.goto(origin + prefix);
  await play(page);
  assert.equal(await page.evaluate(() => __mb.renderer.kind), 'canvas');
  assert.equal(await page.evaluate(() => window.webglAttempts), 0);
  assert.deepEqual(await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(url => /vendor|render-3d/.test(url))), []);
  await page.waitForFunction(() => !__mb.G.parts.length && !__mb.G.blasts.length && !__mb.G.dying.length && !__mb.G.shake);
  await page.evaluate(() => { __mb.G.idle = 0; __mb.G.hint = null; __mb.render(performance.now() / 1000); });
  const frames = await page.evaluate(() => __mb.renderer.frames);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => __mb.renderer.frames), frames);
  // Pointer coordinates remain correct after resizing the cached board.
  await page.setViewportSize({ width: 1024, height: 768 });
  const move = await page.evaluate(() => __mb.findMove());
  const box = await page.locator('#board').boundingBox();
  for (const cell of move) await page.mouse.click(box.x + box.width * (cell.c + 0.5) / 8, box.y + box.height * (cell.r + 0.5) / 8);
  await page.waitForFunction(() => __mb.G.moves === 18 && !__mb.G.busy);
  assert.deepEqual(errors, []);
});

test('2D and 3D modes switch, persist, and preserve progress and controls', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    const save = JSON.parse(localStorage.getItem('matchbusters') || '{}');
    // Keep software-renderer performance separate from the mode-switch regression.
    localStorage.setItem('matchbusters', JSON.stringify({ ...save, stars: save.stars || [2], sound: false, music: false, keep3D: true }));
  });
  await page.goto(origin + prefix);
  await play(page);
  await page.evaluate(() => { __mb.setPaused(true); __mb.show('settings'); });
  const board = await page.evaluate(() => __mb.G.grid.map(row => row.map(p => p.t)));
  const pixels = await page.locator('#board').evaluate(c => c.width * c.height);
  await page.getByLabel('Graphics', { exact: true }).selectOption('fancy');
  await page.waitForFunction(() => __mb.renderer.kind === 'webgl' && !document.getElementById('graphicsMode').disabled);
  await page.evaluate(() => __mb.render(0));
  assert.equal(await page.locator('#board').evaluate(c => c.width * c.height), pixels * 4);
  assert.deepEqual(await page.evaluate(() => __mb.G.grid.map(row => row.map(p => p.t))), board);
  const frames = await page.evaluate(() => __mb.renderer.frames);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => __mb.renderer.frames), frames);
  await page.reload();
  await play(page);
  assert.equal(await page.evaluate(() => __mb.renderer.kind), 'webgl');
  assert.deepEqual(await page.evaluate(() => __mb.save.stars), [2]);
  await page.evaluate(() => { __mb.quit(); __mb.show('settings'); });
  await page.getByLabel('Graphics', { exact: true }).selectOption('smooth');
  await page.waitForFunction(() => __mb.renderer.kind === 'canvas');
  await page.reload();
  await play(page);
  assert.equal(await page.evaluate(() => __mb.renderer.kind), 'canvas');
  assert.deepEqual(errors, []);
});

test('2D power-ups, chained blasts, refills, and collection goals render without WebGL', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t);
  await page.goto(origin + prefix);
  await page.waitForFunction(() => !!window.__mb);
  const result = await page.evaluate(() => {
    const mb = __mb, g = mb.G;
    mb.startLevel(1); mb.setPaused(true);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) g.grid[r][c] = mb.mk((r + c) % 5, r, c);
    g.grid[0][0].sp = 'line'; g.grid[0][0].dir = 'h';
    g.grid[0][1].sp = 'bomb';
    g.grid[0][2].sp = 'color';
    g.grid[1][0].sp = 'line'; g.grid[1][0].dir = 'v';
    mb.render(0);
    const fired = mb.clearStep([{ cells: [0, 1, 2], special: null }], [], 1);
    mb.render(0.1);
    const effects = { fired, particles: g.parts.length, collected: g.collected[0], score: g.score };
    mb.gravity();
    for (let i = 0; i < 60; i++) { mb.update(1 / 60); mb.render(i / 60); }
    return { ...effects, cells: g.grid.flat().filter(Boolean).length, settled: g.grid.flat().every(p => p.y === p.r) };
  });
  assert.ok(result.fired.line && result.fired.bomb && result.fired.color);
  assert.ok(result.particles > 0 && result.particles <= 250);
  assert.ok(result.collected > 0 && result.score > 0);
  assert.equal(result.cells, 64);
  assert.equal(result.settled, true);
  assert.deepEqual(errors, []);
});

test('frame-rate detection ignores startup and brief stalls, and detects sustained slowness', async () => {
  const { createFrameRateMonitor } = await import('../frame-rate.js');
  const monitor = createFrameRateMonitor();
  const feed = (delta, count) => {
    let offered = false;
    for (let i = 0; i < count; i++) offered = monitor.sample(delta) || offered;
    return offered;
  };
  assert.equal(feed(100, 15), false); // Startup work alone must not trigger an offer.
  monitor.reset();
  assert.equal(feed(1000 / 60, 600), false);
  assert.equal(feed(100, 25), false);
  assert.equal(feed(1000 / 60, 300), false);
  for (const fps of [30, 24, 20]) {
    monitor.reset();
    assert.equal(feed(1000 / fps, fps * 30), false, `Playable ${fps} FPS must not prompt`);
  }
  monitor.reset();
  let offeredForStalls = false;
  for (let i = 0; i < 200; i++) {
    offeredForStalls = feed(1000 / 60, 9) || offeredForStalls;
    offeredForStalls = monitor.sample(200) || offeredForStalls;
  }
  assert.equal(offeredForStalls, false);
  monitor.reset();
  assert.equal(feed(100, 160), true);
  monitor.reset();
  assert.equal(feed(1500, 12), true); // Even devices below one FPS must get the offer.
});

test('3D is the default; slow play pauses for a choice and remembers either choice', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t, { smooth: null, viewport: { width: 320, height: 640 }, hasTouch: false });
  await page.addInitScript(() => {
    if (!localStorage.getItem('matchbusters')) localStorage.setItem('matchbusters', JSON.stringify({ sound: false, music: true }));
    // Feed slow frame timestamps without depending on the test host's GPU speed.
    const raf = window.requestAnimationFrame;
    let timestamp = performance.now();
    window.requestAnimationFrame = callback => raf.call(window, () => { timestamp += 100; callback(timestamp); });
  });
  await page.goto(origin + prefix);
  await page.waitForFunction(() => !!window.__mb);
  assert.equal(await page.evaluate(() => __mb.renderer.kind), 'webgl');
  await page.locator('#logo').click(); // Unlock real music playback before the automatic pause.
  await page.evaluate(() => __mb.startLevel(2));
  await page.getByRole('dialog', { name: 'Prefer smoother play?' }).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => __mb.G.paused), true);
  assert.equal(await page.evaluate(() => __mb.music.state.enabled && __mb.music.state.paused), true);
  const timeLeft = await page.evaluate(() => __mb.G.timeLeft);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => __mb.G.timeLeft), timeLeft);
  await page.getByRole('button', { name: 'Use smooth graphics', exact: true }).click();
  await page.waitForFunction(() => __mb.renderer.kind === 'canvas' && !__mb.G.paused);
  assert.equal(await page.evaluate(() => __mb.music.state.paused), false);
  await page.reload();
  await page.waitForFunction(() => !!window.__mb);
  assert.equal(await page.evaluate(() => __mb.renderer.kind), 'canvas');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Graphics', { exact: true }).selectOption('fancy');
  await page.waitForFunction(() => __mb.renderer.kind === 'webgl');
  await page.evaluate(() => __mb.startLevel(0));
  await page.getByRole('dialog', { name: 'Prefer smoother play?' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Keep Fancy', exact: true }).click();
  assert.equal(await page.evaluate(() => __mb.save.keep3D && !__mb.G.paused), true);
  assert.equal(await page.evaluate(() => __mb.music.state.paused), false);
  await page.reload();
  await page.waitForFunction(() => !!window.__mb);
  assert.equal(await page.evaluate(() => __mb.renderer.kind), 'webgl');
  assert.equal(await page.evaluate(() => __mb.save.keep3D), true);
  assert.deepEqual(errors, []);
});

test('unavailable WebGL falls back to the playable 2D renderer', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t, { smooth: false });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.includes('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await page.goto(origin + prefix);
  await play(page);
  assert.equal(await page.evaluate(() => __mb.renderer.kind), 'canvas');
  assert.equal(await page.evaluate(() => __mb.save.smooth), true);
  assert.deepEqual(errors, []);
});

test('slow Extreme offers Fancy first, and only offers Smooth after a fresh check in Fancy', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t, { smooth: false, viewport: { width: 320, height: 640 } });
  await page.addInitScript(() => {
    const save = JSON.parse(localStorage.getItem('matchbusters') || '{}');
    if (!('extreme' in save)) localStorage.setItem('matchbusters', JSON.stringify({ ...save, smooth: false, extreme: true, sound: false, music: false }));
    const raf = window.requestAnimationFrame;
    let timestamp = performance.now();
    window.testFocused = true; window.testFrames = 0;
    document.hasFocus = () => window.testFocused;
    window.requestAnimationFrame = callback => raf.call(window, () => { timestamp += 100; window.testFrames++; callback(timestamp); });
  });
  await page.goto(origin + prefix);
  await page.waitForFunction(() => !!window.__mb);
  await page.evaluate(() => { window.testFocused = false; __mb.startLevel(0); });
  const unfocusedStart = await page.evaluate(() => window.testFrames);
  await page.waitForFunction(start => window.testFrames > start + 180, unfocusedStart);
  assert.equal(await page.getByRole('dialog', { name: 'Prefer smoother play?' }).isVisible(), false);
  await page.evaluate(() => { window.testFocused = true; __mb.startLevel(2); });
  await page.getByRole('button', { name: 'Use Fancy graphics', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Use smooth graphics', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Keep Extreme', exact: true }).isVisible(), true);
  const board = await page.evaluate(() => __mb.G.grid.map(row => row.map(p => p.t)));
  await page.getByRole('button', { name: 'Use Fancy graphics', exact: true }).click();
  await page.waitForFunction(() => __mb.renderer.quality === 'fancy' && !__mb.G.paused);
  assert.equal(await page.getByRole('dialog', { name: 'Prefer smoother play?' }).isVisible(), false);
  assert.deepEqual(await page.evaluate(() => __mb.G.grid.map(row => row.map(p => p.t))), board);
  await page.reload();
  await page.waitForFunction(() => !!window.__mb);
  assert.equal(await page.evaluate(() => __mb.renderer.quality), 'fancy');
  await page.evaluate(() => __mb.startLevel(0));
  await page.getByRole('button', { name: 'Use smooth graphics', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Keep Fancy', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: 'Use smooth graphics', exact: true }).click();
  await page.waitForFunction(() => __mb.renderer.quality === 'smooth' && !__mb.G.paused);
  assert.deepEqual(errors, []);
});

test('Extreme graphics render, persist, and switch back to the original Fancy mode', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t, { viewport: { width: 360, height: 740 } });
  const shaderErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && /Shader Error|VALIDATE_STATUS|GL_INVALID/i.test(msg.text())) shaderErrors.push(msg.text());
  });
  await page.goto(origin + prefix);
  await page.waitForFunction(() => !!window.__mb);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Graphics', { exact: true }).selectOption('extreme');
  await page.waitForFunction(() => __mb.renderer.quality === 'extreme');
  await page.evaluate(() => { __mb.save.keep3D = true; __mb.startLevel(0); });
  await page.waitForFunction(() => __mb.G.grid.flat().every(p => p.y === p.r));
  await page.evaluate(() => {
    // Review both line-clear directions in every shape color at peak glow.
    __mb.setPaused(true); __mb.show(null);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) __mb.G.grid[r][c] = __mb.mk((r + c) % 5, r, c);
    for (let t = 0; t < 5; t++) {
      __mb.G.grid[t + 1][2] = __mb.mk(t, t + 1, 2, 'line', 'h');
      __mb.G.grid[t + 1][5] = __mb.mk(t, t + 1, 5, 'line', 'v');
    }
    __mb.render(Math.PI / 10);
  });
  await page.screenshot({ path: '/tmp/match-busters-extreme.png' });
  assert.equal(await page.evaluate(() => __mb.save.extreme && !__mb.save.smooth), true);
  await page.reload();
  await page.waitForFunction(() => !!window.__mb);
  assert.equal(await page.evaluate(() => __mb.renderer.quality), 'extreme');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Graphics', { exact: true }).selectOption('fancy');
  await page.waitForFunction(() => __mb.renderer.quality === 'fancy');
  assert.equal(await page.evaluate(() => __mb.save.extreme), false);
  assert.deepEqual(shaderErrors, []);
  assert.deepEqual(errors, []);
});

test('auto-fit fills phone, tablet, and laptop screens with larger square-tile boards', { timeout: 60000 }, async t => {
  for (const [name, width, height] of [['phone portrait', 390, 844], ['phone landscape', 844, 390], ['tablet portrait', 768, 1024], ['laptop', 1366, 768]]) {
    await t.test(name, async t => {
      const { page, errors } = await newPage(t, { layout: null, viewport: { width, height } });
      await page.goto(origin + prefix);
      await page.waitForFunction(() => !!window.__mb);
      await page.getByRole('button', { name: 'Play', exact: true }).click(); await page.locator('.lvBtn').first().click();
      await page.waitForFunction(() => __mb.G.grid.flat().every(p => p.y === p.r));
      const layout = await page.evaluate(() => {
        const canvas = document.getElementById('board').getBoundingClientRect();
        const wrap = document.getElementById('boardWrap').getBoundingClientRect();
        const a = __mb.renderer.project(0, 0), b = __mb.renderer.project(1, 0), c = __mb.renderer.project(0, 1);
        return { rows: __mb.G.rows, cols: __mb.G.cols, cells: __mb.G.grid.flat().length,
          coverage: [canvas.width / wrap.width, canvas.height / wrap.height],
          xStep: (b.x - a.x) * canvas.width, yStep: (c.y - a.y) * canvas.height,
          inside: canvas.left >= wrap.left - 1 && canvas.right <= wrap.right + 1 && canvas.top >= wrap.top - 1 && canvas.bottom <= wrap.bottom + 1 };
      });
      assert.ok(layout.cells > 64, JSON.stringify(layout));
      assert.ok(layout.coverage.every(value => value > 0.88), JSON.stringify(layout));
      assert.ok(layout.inside);
      assert.ok(Math.abs(layout.xStep - layout.yStep) < 1);
      await makeBoardMove(page);
      assert.deepEqual(errors, []);
    });
  }
});

test('rotating preserves an active board, and retrying auto-fits the new orientation', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t, { layout: 'auto' });
  await page.goto(origin + prefix); await page.waitForFunction(() => !!window.__mb);
  await page.getByRole('button', { name: 'Play', exact: true }).click(); await page.locator('.lvBtn').first().click();
  await page.waitForFunction(() => __mb.G.grid.flat().every(p => p.y === p.r));
  await makeBoardMove(page);
  const before = await page.evaluate(() => ({ rows: __mb.G.rows, cols: __mb.G.cols, grid: __mb.G.grid.map(row => row.map(p => p.t)), score: __mb.G.score }));
  await page.setViewportSize({ width: 844, height: 390 });
  assert.deepEqual(await page.evaluate(() => ({ rows: __mb.G.rows, cols: __mb.G.cols, grid: __mb.G.grid.map(row => row.map(p => p.t)), score: __mb.G.score })), before);
  await makeBoardMove(page, true);
  await page.locator('#pauseBtn').click(); await page.getByRole('button', { name: 'Restart', exact: true }).click();
  assert.equal(await page.evaluate(() => __mb.G.rows), 8);
  assert.ok(await page.evaluate(() => __mb.G.cols > 8));
  assert.deepEqual(errors, []);
});

test('rectangular boards clear full edge rows and columns, forge specials, and refill correctly', { timeout: 60000 }, async t => {
  const { page, errors } = await newPage(t);
  await page.goto(origin + prefix); await page.waitForFunction(() => !!window.__mb);
  for (const layout of ['tall', 'wide']) {
    const result = await page.evaluate(layout => {
      const mb = __mb, g = mb.G; mb.save.boardLayout = layout; mb.startLevel(0); mb.setPaused(true);
      const reset = () => {
        g.collected.fill(0); g.dying = []; g.parts = []; g.beams = []; g.blasts = [];
        g.grid = Array.from({ length: g.rows }, (_, r) => Array.from({ length: g.cols }, (_, c) => mb.mk((r + c) % 5, r, c)));
      };
      reset(); const bottom = g.rows - 1, right = g.cols - 1;
      for (let c = g.cols - 4; c < g.cols; c++) g.grid[bottom][c].t = 0;
      g.grid[bottom][g.cols - 5].t = 1;
      const matches = mb.findMatches(), spawn = bottom * g.cols + right;
      mb.clearStep(matches, [spawn], 1);
      const forged = g.grid[bottom][right] && g.grid[bottom][right].sp === 'line';
      mb.gravity(); for (let i = 0; i < 120; i++) mb.update(1 / 60);
      mb.render(0);
      const refilled = g.grid.every((row, r) => row.length === g.cols && row.every((p, c) => p && p.r === r && p.c === c && p.y === r));
      reset(); g.grid[bottom][right].sp = 'line'; g.grid[bottom][right].dir = 'h';
      mb.clearStep([{ cells: [spawn], special: null }], [], 1); mb.render(0);
      const rowCleared = g.grid[bottom].every(p => p === null), rowCount = g.collected.reduce((a, b) => a + b, 0);
      reset(); g.grid[bottom][right].sp = 'line'; g.grid[bottom][right].dir = 'v';
      mb.clearStep([{ cells: [spawn], special: null }], [], 1); mb.render(0);
      const columnCleared = g.grid.every(row => row[right] === null), columnCount = g.collected.reduce((a, b) => a + b, 0);
      reset(); g.grid[bottom][right].t = 2; g.grid[bottom][right].sp = 'color';
      const colorCount = g.grid.flat().filter(p => p.t === 2).length;
      mb.clearStep([{ cells: [spawn], special: null }], [], 1); mb.render(0);
      return { rows: g.rows, cols: g.cols, forged, refilled, rowCleared, rowCount, columnCleared, columnCount,
        colorCount, colorsCleared: g.collected[2], colorRemains: g.grid.flat().some(p => p && p.t === 2) };
    }, layout);
    assert.ok(result.forged && result.refilled && result.rowCleared && result.columnCleared, JSON.stringify(result));
    assert.equal(result.rowCount, result.cols); assert.equal(result.columnCount, result.rows);
    assert.equal(result.colorsCleared, result.colorCount); assert.equal(result.colorRemains, false);
  }
  assert.deepEqual(errors, []);
});

test('Tall and Wide preferences persist, and both 3D modes fit and hit-test rectangular edges', { timeout: 60000 }, async t => {
  for (const [layout, quality, width, height, rows, cols] of [['tall', 'fancy', 390, 844, 12, 8], ['wide', 'extreme', 844, 390, 8, 12]]) {
    await t.test(`${quality} ${layout}`, async t => {
      const { page, errors } = await newPage(t, { viewport: { width, height } });
      const shaderErrors = [];
      page.on('console', msg => { if (msg.type() === 'error' && /Shader Error|VALIDATE_STATUS|GL_INVALID/i.test(msg.text())) shaderErrors.push(msg.text()); });
      await page.goto(origin + prefix); await page.waitForFunction(() => !!window.__mb);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByLabel('Board', { exact: true }).selectOption(layout);
      await page.getByLabel('Graphics', { exact: true }).selectOption(quality);
      await page.waitForFunction(quality => __mb.renderer.quality === quality, quality);
      await page.evaluate(() => { __mb.save.keep3D = true; });
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: 'Play', exact: true }).click(); await page.locator('.lvBtn').first().click();
      await page.waitForFunction(() => __mb.G.grid.flat().every(p => p.y === p.r));
      assert.deepEqual(await page.evaluate(() => [__mb.G.rows, __mb.G.cols]), [rows, cols]);
      const hits = await page.evaluate(() => {
        const g = __mb.G, canvas = document.getElementById('board').getBoundingClientRect();
        return [[0, 0], [0, g.cols - 1], [g.rows - 1, 0], [g.rows - 1, g.cols - 1]].map(([r, c]) => {
          const point = __mb.renderer.project(c, r);
          const hit = __mb.renderer.cellAt({ clientX: canvas.left + point.x * canvas.width, clientY: canvas.top + point.y * canvas.height });
          return { expected: { r, c }, hit, inside: point.x > 0 && point.x < 1 && point.y > 0 && point.y < 1 };
        });
      });
      for (const result of hits) { assert.ok(result.inside); assert.deepEqual(result.hit, result.expected); }
      await makeBoardMove(page);
      await page.screenshot({ path: `/tmp/match-${quality}-${layout}.png` });
      await page.reload(); await page.waitForFunction(() => !!window.__mb);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      assert.equal(await page.getByLabel('Board', { exact: true }).inputValue(), layout);
      assert.deepEqual(shaderErrors, []); assert.deepEqual(errors, []);
    });
  }
});
