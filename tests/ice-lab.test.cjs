const assert = require('node:assert/strict');
const { readFile, stat } = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let browser, server, origin;
const mainSave = JSON.stringify({ stars: [3, 2, 1], smooth: true, music: false, sound: false, boardLayout: 'classic' });

before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const file = path.join(root, url.pathname, url.pathname.endsWith('/') ? 'index.html' : '');
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store'); res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--enable-unsafe-swiftshader'] });
});
after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function open(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ...options });
  t.after(() => context.close());
  await context.addInitScript(value => {
    if (!localStorage.getItem('matchbusters')) localStorage.setItem('matchbusters', value);
  }, mainSave);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, errors };
}
async function ready(page) { await page.goto(origin + '/ice-lab/'); await page.waitForFunction(() => !!window.__mb); }
async function tapCell(page, r, c, times = 1) {
  const point = await page.evaluate(({ r, c }) => __mb.renderer.project(c, r), { r, c });
  const box = await page.locator('#board').boundingBox();
  for (let i = 0; i < times; i++) await page.mouse.click(box.x + point.x * box.width, box.y + point.y * box.height);
}

test('ice islands and starter powers remain reachable on every board shape', async () => {
  const { createIcePlan } = await import('../ice-lab/ice.js');
  for (const [rows, cols] of [[8, 8], [12, 8], [8, 12], [16, 8], [8, 16]]) for (let scenario = 0; scenario < 4; scenario++) {
    const plan = createIcePlan(rows, cols, scenario);
    assert.equal(plan.total, [6, 8, 12, 16][scenario]);
    for (const power of plan.powers) assert.equal(plan.ice[power.r][power.c], 0);
    const queue = [[0, 0]], seen = new Set(['0,0']);
    while (queue.length) {
      const [r, c] = queue.shift();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const row = r + dr, col = c + dc, key = `${row},${col}`;
        if (row >= 0 && col >= 0 && row < rows && col < cols && !plan.ice[row][col] && !seen.has(key)) { seen.add(key); queue.push([row, col]); }
      }
    }
    assert.equal(seen.size, rows * cols - plan.total);
  }
});

test('the lab precaches its complete import graph without sharing the main cache namespace', async () => {
  const sw = await readFile(path.join(root, 'ice-lab/sw.js'), 'utf8');
  const scope = { self: { addEventListener() {} } };
  vm.runInNewContext(sw + '\nglobalThis.assets = ASSETS; globalThis.cacheName = CACHE;', scope);
  assert.ok(!scope.cacheName.startsWith('match-busters-'));
  const cached = new Set(scope.assets.map(file => path.resolve(root, 'ice-lab', file))), seen = new Set();
  for (const file of cached) await stat(file);
  async function imports(file) {
    const source = await readFile(file, 'utf8');
    for (const [, spec] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g)) {
      assert.ok(spec.startsWith('.'));
      const target = path.resolve(path.dirname(file), spec);
      assert.ok(cached.has(target), `Uncached import: ${target}`);
      if (!seen.has(target)) { seen.add(target); await imports(target); }
    }
  }
  await imports(path.join(root, 'ice-lab/index.html')); assert.equal(seen.size, 19);
});

test('a new player can thaw the first board through real taps; lab saves and offline cache stay isolated', { timeout: 60000 }, async t => {
  const { context, page, errors } = await open(t);
  await page.goto(origin + '/'); await page.waitForFunction(() => !!window.__mb);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ready(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL.endsWith('/ice-lab/sw.js'));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  assert.equal(await page.locator('.lvBtn:enabled').count(), 4);
  await page.locator('.lvBtn').first().click();
  assert.equal(await page.evaluate(() => __mb.G.iceTotal), 6);
  const ice = await page.evaluate(() => {
    const g = __mb.G; for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (g.ice[r][c]) return { r, c };
  });
  await tapCell(page, ice.r, ice.c);
  assert.equal(await page.evaluate(() => __mb.G.moves), 12);
  assert.equal(await page.evaluate(() => __mb.G.sel), null);
  for (let i = 0; i < 4; i++) {
    if (await page.evaluate(() => __mb.G.ended)) break;
    const bomb = await page.evaluate(() => { const p = __mb.G.grid.flat().find(p => p && p.sp === 'bomb'); return p && { r: p.r, c: p.c }; });
    assert.ok(bomb, 'Tutorial must retain a usable bomb');
    await tapCell(page, bomb.r, bomb.c, 2);
    await page.waitForFunction(() => !__mb.G.busy);
  }
  assert.equal(await page.evaluate(() => __mb.G.thawed), 6);
  assert.equal(await page.evaluate(() => __mb.G.ended), true);
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('matchbusters-ice-lab')).stars[0] > 0));
  assert.equal(await page.evaluate(() => localStorage.getItem('matchbusters')), mainSave);
  const caches = await page.evaluate(() => window.caches.keys());
  assert.ok(caches.includes('match-busters-v12') && caches.includes('ice-lab-v1'));
  await context.setOffline(true); await page.reload(); await page.waitForFunction(() => !!window.__mb);
  assert.ok(await page.evaluate(() => __mb.save.stars[0] > 0));
  assert.equal(await page.evaluate(() => localStorage.getItem('matchbusters')), mainSave);
  assert.deepEqual(errors, []);
});

test('ordinary matches and beams cannot thaw ice; two distinct bombs crack then thaw thick ice', { timeout: 60000 }, async t => {
  const { page, errors } = await open(t); await ready(page);
  const result = await page.evaluate(() => {
    const mb = __mb, g = mb.G; mb.startLevel(0); mb.setPaused(true);
    g.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => mb.mk((r + c) % 5, r, c)));
    g.ice = Array.from({ length: 8 }, () => Array(8).fill(0)); g.iceInitial = g.ice.map(row => row.slice());
    g.ice[3][3] = g.iceInitial[3][3] = 2; g.thawed = 0; g.iceTotal = 1;
    const anchor = g.grid[3][3];
    g.grid[3][2].t = anchor.t = g.grid[3][4].t = 0;
    const normalBlocked = !mb.formsMatch(g.grid, 3, 3) && !mb.findMatches().some(group => group.cells.includes(27));
    g.grid[3][2].sp = 'bomb';
    mb.clearStep([], [], 1, { seeds: [3 * 8 + 2] });
    const cracked = g.ice[3][3] === 1 && g.thawed === 0 && g.grid[3][3] === anchor;
    g.grid[0][3].sp = 'line'; g.grid[0][3].dir = 'v';
    mb.clearStep([], [], 1, { seeds: [3] });
    const beamProtected = g.ice[3][3] === 1 && g.grid[3][3] === anchor;
    mb.gravity(); const pinned = g.grid[3][3] === anchor && anchor.r === 3 && anchor.c === 3;
    g.grid[3][4].sp = 'bomb';
    mb.clearStep([], [], 1, { seeds: [3 * 8 + 4] });
    return { normalBlocked, cracked, beamProtected, pinned, thawed: g.thawed, layers: g.ice[3][3], keptPiece: g.grid[3][3] === anchor };
  });
  assert.deepEqual(result, { normalBlocked: true, cracked: true, beamProtected: true, pinned: true, thawed: 1, layers: 0, keptPiece: true });
  assert.deepEqual(errors, []);
});

test('all power-up pairs activate on swaps without requiring a normal match', { timeout: 60000 }, async t => {
  const { page, errors } = await open(t); await ready(page);
  for (const [a, b, kind] of [['bomb', 'bomb', 'mega'], ['bomb', 'line', 'cross3'], ['line', 'line', 'cross'], ['color', 'bomb', 'color-bomb'], ['bomb', 'color', 'color-bomb'], ['color', 'line', 'color-line'], ['line', 'color', 'color-line'], ['color', 'color', 'all']]) {
    await page.evaluate(({ a, b }) => {
      const mb = __mb, g = mb.G; mb.startLevel(0);
      g.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => mb.mk((r + c) % 5, r, c)));
      g.ice = Array.from({ length: 8 }, () => Array(8).fill(0)); g.iceInitial = g.ice.map(row => row.slice());
      g.ice[7][7] = g.iceInitial[7][7] = 2; g.iceTotal = 1; g.thawed = 0; g.iceVersion++;
      g.grid[3][3] = mb.mk(0, 3, 3, a, 'h'); g.grid[3][4] = mb.mk(1, 3, 4, b, 'v');
      mb.render(0);
    }, { a, b });
    await tapCell(page, 3, 3); await tapCell(page, 3, 4);
    await page.waitForFunction(() => !__mb.G.busy);
    assert.equal(await page.evaluate(() => __mb.G.lastCombo), kind);
    assert.equal(await page.evaluate(() => __mb.G.moves), 11);
  }
  assert.deepEqual(errors, []);
});

test('mega blasts melt two layers while a bomb/line overlap is only one blast', { timeout: 60000 }, async t => {
  const { page, errors } = await open(t); await ready(page);
  for (const [kind, layers] of [['mega', 0], ['cross3', 1]]) {
    const result = await page.evaluate(kind => {
      const mb = __mb, g = mb.G; mb.startLevel(0); mb.setPaused(true);
      g.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => mb.mk((r + c) % 5, r, c)));
      g.ice = Array.from({ length: 8 }, () => Array(8).fill(0)); g.iceInitial = g.ice.map(row => row.slice());
      g.ice[3][5] = g.iceInitial[3][5] = 2; g.iceTotal = 1; g.thawed = 0;
      g.grid[3][3].sp = 'bomb'; g.grid[3][4].sp = kind === 'mega' ? 'bomb' : 'line';
      mb.clearStep([], [], 1, { seeds: [27, 28], center: 28, combination: { kind } });
      return g.ice[3][5];
    }, kind);
    assert.equal(result, layers);
  }
  assert.deepEqual(errors, []);
});

test('gravity and shuffling preserve anchors and never move existing pieces across ice', { timeout: 60000 }, async t => {
  const { page, errors } = await open(t); await ready(page);
  const result = await page.evaluate(() => {
    const mb = __mb, g = mb.G; mb.startLevel(0); mb.setPaused(true);
    g.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => mb.mk((r + c) % 5, r, c)));
    g.ice = Array.from({ length: 8 }, () => Array(8).fill(0)); g.iceInitial = g.ice.map(row => row.slice());
    g.ice[3][3] = g.iceInitial[3][3] = 1; g.iceTotal = 1;
    const anchor = g.grid[3][3], above = g.grid[2][3], below = g.grid[5][3];
    g.grid[1][3] = null; g.grid[7][3] = null; mb.gravity();
    const segmented = above.r < 3 && below.r > 3 && g.grid[3][3] === anchor;
    mb.shuffleBoard();
    return { segmented, anchorKept: g.grid[3][3] === anchor, layers: g.ice[3][3], cells: g.grid.flat().filter(Boolean).length, moves: !!mb.findMove() };
  });
  assert.deepEqual(result, { segmented: true, anchorKept: true, layers: 1, cells: 64, moves: true });
  assert.deepEqual(errors, []);
});

test('frozen cells and cracks render in Fancy and Extreme on tall and wide boards', { timeout: 60000 }, async t => {
  for (const [quality, layout, width, height] of [['fancy', 'tall', 390, 844], ['extreme', 'wide', 844, 390]]) {
    const { page, errors } = await open(t, { viewport: { width, height } });
    const shaderErrors = [];
    page.on('console', message => { if (message.type() === 'error' && /Shader Error|VALIDATE_STATUS|GL_INVALID/i.test(message.text())) shaderErrors.push(message.text()); });
    await ready(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Board', { exact: true }).selectOption(layout);
    await page.getByLabel('Graphics', { exact: true }).selectOption(quality);
    await page.waitForFunction(quality => __mb.renderer.quality === quality, quality);
    await page.evaluate(() => { __mb.save.keep3D = true; __mb.startLevel(2); });
    await page.evaluate(() => {
      __mb.setPaused(true); __mb.show(null);
      const g = __mb.G; outer: for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (g.ice[r][c] === 2) { g.ice[r][c] = 1; g.iceVersion++; break outer; }
      __mb.render(0);
    });
    await page.screenshot({ path: `/tmp/ice-lab-${quality}.png` });
    assert.equal(await page.evaluate(() => __mb.G.ice.flat().filter(Boolean).length), 12);
    assert.deepEqual(shaderErrors, []); assert.deepEqual(errors, []);
    await page.close();
  }
});
