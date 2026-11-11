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

// Rank only ordinary swaps, favoring matches that touch remaining ice.
function ordinaryIceMove() {
  const mb = __mb, g = mb.G;
  let best = null;
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const y = r + dr, x = c + dc;
    if (y >= g.rows || x >= g.cols || mb.frozen(r, c) || mb.frozen(y, x)) continue;
    const a = g.grid[r][c], b = g.grid[y][x];
    if (a.sp || b.sp) continue;
    g.grid[r][c] = b; g.grid[y][x] = a;
    const groups = mb.findMatches(), ice = new Set();
    let value = 0;
    for (const group of groups) for (const k of group.cells) {
      const row = k / g.cols | 0, col = k % g.cols; value += 0.02;
      for (const [dy, dx] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (mb.frozen(row + dy, col + dx)) ice.add((row + dy) * g.cols + col + dx);
      }
    }
    value += ice.size * 10;
    g.grid[r][c] = a; g.grid[y][x] = b;
    if (groups.length && (!best || value > best.value)) best = { a: { r, c }, b: { r: y, c: x }, value };
  }
  return best;
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

test('frost growth counts quiet moves, resets on damage, and preserves thawed cells, power-ups, and connectivity', async () => {
  const { createIcePlan, createFrostGrowth, advanceFrost } = await import('../ice-lab/ice.js');
  const { ice } = createIcePlan(8, 8, 2), grid = ice.map((row, r) => row.map((_, c) => ({ r, c, sp: null })));
  assert.equal(createFrostGrowth(ice), null);
  const state = createFrostGrowth(ice, { after: 3, limit: 4 });
  assert.equal(advanceFrost(ice, grid, state, false), null); assert.equal(state.quiet, 1);
  assert.equal(advanceFrost(ice, grid, state, true), null); assert.equal(state.quiet, 0);
  // This formerly frozen cell can never refreeze, even beside a remaining island.
  const old = ice.flat().findIndex(Boolean), r = old / 8 | 0, c = old % 8;
  ice[r][c] = 0;
  grid[r - 1][c].sp = 'bomb';
  let grown = 0;
  for (let turn = 0; turn < 30; turn++) {
    const before = ice.map(row => row.slice()), cell = advanceFrost(ice, grid, state, false, () => 0);
    if (cell) {
      grown++; assert.equal(ice[cell.r][cell.c], 1);
      assert.ok(before[cell.r - 1][cell.c] || before[cell.r + 1][cell.c] || before[cell.r][cell.c - 1] || before[cell.r][cell.c + 1]);
      assert.equal(grid[cell.r][cell.c].sp, null);
    }
  }
  assert.equal(grown, 4); assert.equal(state.remaining, 0);
  assert.equal(ice[r][c], 0); assert.equal(ice[r - 1][c], 0);
  assert.ok(ice[0].every(n => !n) && ice[7].every(n => !n));
  // Only eligible candidate is a doorway: freezing it would trap the center.
  const tight = Array.from({ length: 5 }, () => Array(5).fill(0));
  tight[2][1] = tight[2][3] = tight[3][2] = 1;
  const pieces = tight.map(row => row.map(() => ({ sp: 'line' }))); pieces[1][2].sp = null;
  const blocked = createFrostGrowth(tight, { after: 1, limit: 1 });
  assert.equal(advanceFrost(tight, pieces, blocked, false), null);
  assert.equal(tight[1][2], 0); assert.equal(blocked.remaining, 1);
  for (const row of tight) row.fill(0);
  assert.equal(advanceFrost(tight, pieces, blocked, false), null);
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
  await imports(path.join(root, 'ice-lab/index.html')); assert.equal(seen.size, 23);
});

test('a new player thaws the first board through ordinary swaps; saves and offline cache stay isolated', { timeout: 60000 }, async t => {
  const { context, page, errors } = await open(t);
  await page.goto(origin + '/'); await page.waitForFunction(() => !!window.__mb);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(async () => { const old = await caches.open('ice-lab-v4'); await old.put('/ice-lab/index.html', new Response('Old lab')); });
  await ready(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL.endsWith('/ice-lab/sw.js'));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  assert.equal(await page.locator('.lvBtn:enabled').count(), 4);
  await page.evaluate(() => { let seed = 1001; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; });
  await page.locator('.lvBtn').first().click();
  assert.equal(await page.evaluate(() => __mb.G.grid.flat().filter(p => p.sp).length), 0);
  assert.equal(await page.evaluate(() => __mb.G.iceTotal), 6);
  const ice = await page.evaluate(() => {
    const g = __mb.G; for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (g.ice[r][c]) return { r, c };
  });
  await tapCell(page, ice.r, ice.c);
  assert.equal(await page.evaluate(() => __mb.G.moves), 22);
  assert.equal(await page.evaluate(() => __mb.G.sel), null);
  for (let i = 0; i < 22; i++) {
    if (await page.evaluate(() => __mb.G.ended)) break;
    const move = await page.evaluate(ordinaryIceMove);
    assert.ok(move, 'Tutorial retains an ordinary match');
    await tapCell(page, move.a.r, move.a.c); await tapCell(page, move.b.r, move.b.c);
    await page.waitForFunction(() => !__mb.G.busy);
  }
  assert.equal(await page.evaluate(() => __mb.G.thawed), 6);
  assert.equal(await page.evaluate(() => __mb.G.ended), true);
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('matchbusters-ice-lab')).stars[0] > 0));
  assert.equal(await page.evaluate(() => localStorage.getItem('matchbusters')), mainSave);
  const caches = await page.evaluate(() => window.caches.keys());
  assert.ok(caches.includes('match-busters-v13') && caches.includes('ice-lab-v5'));
  assert.ok(!caches.includes('ice-lab-v4'));
  await context.setOffline(true); await page.reload(); await page.waitForFunction(() => !!window.__mb);
  assert.ok(await page.evaluate(() => __mb.save.stars[0] > 0));
  assert.equal(await page.evaluate(() => localStorage.getItem('matchbusters')), mainSave);
  assert.deepEqual(errors, []);
});

test('hard-board growth follows real moves, warns before spreading, resets on chips, and restarts cleanly', { timeout: 60000 }, async t => {
  const { page, errors } = await open(t); await ready(page);
  await page.evaluate(() => {
    const mb = __mb, g = mb.G; mb.startLevel(3);
    g.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => mb.mk((r + c * 2) % 5, r, c)));
    g.ice = Array.from({ length: 8 }, () => Array(8).fill(0)); g.ice[4][4] = 2; g.ice[6][6] = 1;
    g.iceInitial = g.ice.map(row => row.slice()); g.frost.ever = g.ice.map(row => row.map(Boolean));
    g.thawed = 0; g.iceTotal = 2; g.iceVersion++;
    mb.setPaused(true); mb.update(10);
  });
  assert.equal(await page.evaluate(() => __mb.G.frost.quiet), 0);
  await page.evaluate(() => __mb.setPaused(false));
  async function move(a, b) {
    await page.evaluate(async ({ a, b }) => {
      const driving = setInterval(() => __mb.update(0.1), 1);
      try { await __mb.trySwap(a, b); } finally { clearInterval(driving); }
    }, { a, b });
  }
  const corner = { r: 0, c: 0 };
  await move(corner, { r: 0, c: 1 }); // No match: no move spent and no frost tick.
  assert.equal(await page.evaluate(() => __mb.G.moves), 36);
  assert.equal(await page.evaluate(() => __mb.G.frost.quiet), 0);
  async function quietMove() {
    await page.evaluate(() => { __mb.G.grid[0][0].sp = 'bomb'; });
    await move(corner, corner);
  }
  await quietMove(); await quietMove();
  assert.equal(await page.evaluate(() => __mb.G.frost.quiet), 2);
  assert.ok(await page.locator('#iceWarning').evaluate(el => el.classList.contains('urgent')));
  await page.evaluate(() => {
    const g = __mb.G;
    g.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => __mb.mk((r + c * 2) % 5, r, c)));
    g.grid[3][3].t = g.grid[3][4].t = g.grid[2][5].t = 1; g.grid[3][5].t = 2;
  });
  await move({ r: 2, c: 5 }, { r: 3, c: 5 });
  assert.equal(await page.evaluate(() => __mb.G.frost.quiet), 0);
  assert.equal(await page.evaluate(() => __mb.G.iceTotal), 2);
  await quietMove(); await quietMove(); await quietMove();
  assert.equal(await page.evaluate(() => __mb.G.iceTotal), 3);
  assert.equal(await page.evaluate(() => __mb.G.frost.remaining), 7);
  assert.equal(await page.evaluate(() => __mb.G.frost.quiet), 0);
  assert.equal(await page.evaluate(() => __mb.G.ice.flat().filter(Boolean).length + __mb.G.thawed), 3);
  await page.evaluate(() => __mb.startLevel(3));
  assert.deepEqual(await page.evaluate(() => [__mb.G.frost.quiet, __mb.G.frost.remaining, __mb.G.iceTotal]), [0, 8, 16]);
  await page.evaluate(() => __mb.startLevel(0));
  assert.equal(await page.evaluate(() => __mb.G.frost), null);
  assert.equal(await page.locator('#iceWarning').isVisible(), false);
  assert.deepEqual(errors, []);
});

test('all four experiments remain winnable after removing starter powers on square, tall, and wide boards', { timeout: 60000 }, async t => {
  const { page, errors } = await open(t); await ready(page);
  await page.evaluate('window.ordinaryIceMove = ' + ordinaryIceMove.toString());
  const results = await page.evaluate(async () => {
    const mb = __mb, g = mb.G, results = [], originalRandom = Math.random;
    try {
      for (const layout of ['classic', 'tall', 'wide']) for (let level = 0; level < 4; level++) for (let attempt = 0; attempt < 3; attempt++) {
        let seed = 1001 + attempt; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        mb.save.boardLayout = layout; mb.startLevel(level);
        for (const p of g.grid.flat()) p.sp = null;
        let turns = 0;
        while (!g.ended && turns < g.lv.moves) {
          const move = window.ordinaryIceMove();
          if (!move) break;
          // Drive the real swap/cascade/goal path faster than display refresh.
          const driving = setInterval(() => mb.update(0.1), 1);
          try { await mb.trySwap(move.a, move.b); } finally { clearInterval(driving); }
          turns++;
        }
        if (g.thawed === g.iceTotal || attempt === 2) {
          results.push({ layout, level, turns, thawed: g.thawed, total: g.iceTotal, ended: g.ended });
          break;
        }
      }
    } finally { Math.random = originalRandom; }
    return results;
  });
  for (const result of results) {
    assert.equal(result.thawed, result.total, JSON.stringify(result));
    assert.equal(result.ended, true, JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
});

test('matches include anchored colors; nearby matches chip only one layer and lines can finish the thaw', async t => {
  const { page, errors } = await open(t); await ready(page);
  const result = await page.evaluate(() => {
    const mb = __mb, g = mb.G; mb.startLevel(0); mb.setPaused(true);
    g.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => mb.mk((r + c) % 5, r, c)));
    g.ice = Array.from({ length: 8 }, () => Array(8).fill(0)); g.iceInitial = g.ice.map(row => row.slice());
    g.ice[3][3] = g.iceInitial[3][3] = 2; g.thawed = 0; g.iceTotal = 1;
    const anchor = g.grid[3][3];
    g.grid[3][2].t = anchor.t = g.grid[3][4].t = 0;
    const matchesThrough = mb.formsMatch(g.grid, 3, 3) && mb.findMatches().some(group => group.cells.includes(27));
    // The same thick cell touches two matched cells and is in the match itself.
    mb.clearStep(mb.findMatches(), [], 1);
    const crackedOnce = g.ice[3][3] === 1 && g.thawed === 0 && g.grid[3][3] === anchor;
    mb.gravity(); const pinned = g.grid[3][3] === anchor && anchor.r === 3 && anchor.c === 3;
    g.grid[0][3].sp = 'line'; g.grid[0][3].dir = 'v';
    mb.clearStep([], [], 1, { seeds: [3] });
    return { matchesThrough, crackedOnce, pinned, thawed: g.thawed, layers: g.ice[3][3], keptPiece: g.grid[3][3] === anchor };
  });
  assert.deepEqual(result, { matchesThrough: true, crackedOnce: true, pinned: true, thawed: 1, layers: 0, keptPiece: true });
  assert.deepEqual(errors, []);
});

test('adjacent matches thaw ice without matching its color; diagonal matches do not', async t => {
  const { page } = await open(t); await ready(page);
  const result = await page.evaluate(() => {
    const mb = __mb, g = mb.G; mb.startLevel(0); mb.setPaused(true);
    g.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => mb.mk((r + c) % 5, r, c)));
    g.ice = Array.from({ length: 8 }, () => Array(8).fill(0)); g.iceInitial = g.ice.map(row => row.slice());
    g.ice[3][3] = g.iceInitial[3][3] = 2; g.ice[3][5] = g.iceInitial[3][5] = 1; g.thawed = 0; g.iceTotal = 2;
    for (let c = 2; c <= 4; c++) g.grid[2][c].t = 4;
    const groups = mb.findMatches(); mb.clearStep(groups, [], 1);
    const adjacent = g.ice[3][3], diagonal = g.ice[3][5];
    mb.gravity();
    // A later separate match makes another hit, without needing any power-up.
    for (let c = 2; c <= 4; c++) g.grid[2][c].t = 4;
    mb.clearStep(mb.findMatches(), [], 1);
    return { adjacent, diagonal, layers: g.ice[3][3], thawed: g.thawed };
  });
  assert.deepEqual(result, { adjacent: 1, diagonal: 1, layers: 0, thawed: 1 });
});

test('a power-up swapped with a normal neighbor fires at its new position, in either order', async t => {
  const { page, errors } = await open(t); await ready(page);
  for (const reverse of [false, true]) {
    await page.evaluate(() => {
      const mb = __mb, g = mb.G; mb.startLevel(0);
      g.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => mb.mk((r + c) % 5, r, c)));
      g.ice = Array.from({ length: 8 }, () => Array(8).fill(0)); g.iceInitial = g.ice.map(row => row.slice());
      g.ice[3][5] = g.iceInitial[3][5] = 1; g.ice[7][7] = g.iceInitial[7][7] = 2;
      g.iceTotal = 2; g.thawed = 0; g.iceVersion++; g.grid[3][3].sp = 'bomb';
      mb.render(0);
    });
    const [a, b] = reverse ? [[3, 4], [3, 3]] : [[3, 3], [3, 4]];
    await tapCell(page, ...a); await tapCell(page, ...b);
    await page.waitForFunction(() => !__mb.G.busy);
    assert.equal(await page.evaluate(() => __mb.G.moves), 21);
    assert.equal(await page.evaluate(() => __mb.G.ice[3][5]), 0);
  }
  assert.deepEqual(errors, []);
});

test('a color bomb uses its swapped neighbor color and can thaw matching frozen pieces', async t => {
  const { page } = await open(t); await ready(page);
  const result = await page.evaluate(() => {
    const mb = __mb, g = mb.G; mb.startLevel(0); mb.setPaused(true);
    g.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => mb.mk((r + c) % 5, r, c)));
    g.ice = Array.from({ length: 8 }, () => Array(8).fill(0)); g.iceInitial = g.ice.map(row => row.slice());
    g.ice[4][4] = g.iceInitial[4][4] = 1; g.grid[4][4].t = 2; g.iceTotal = 1; g.thawed = 0;
    g.grid[2][2].sp = 'color'; g.grid[2][2].t = 4;
    mb.clearStep([], [], 1, { seeds: [18], target: 2 });
    return { thawed: g.thawed, layers: g.ice[4][4], ownColorKept: !!g.grid[0][4], targetCleared: !g.grid[0][2] };
  });
  assert.deepEqual(result, { thawed: 1, layers: 0, ownColorKept: true, targetCleared: true });
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
    assert.equal(await page.evaluate(() => __mb.G.moves), 21);
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

test('continuous frost contours preserve L/T shapes, holes, diagonal separation, and smoothly blended thickness', async t => {
  const { page, errors } = await open(t); await ready(page);
  const result = await page.evaluate(async () => {
    const { getIceSurface } = await import('/ice-lab/ice.js'), g = __mb.G;
    __mb.startLevel(0); __mb.setPaused(true);
    const set = cells => {
      g.ice = Array.from({ length: 8 }, () => Array(8).fill(0));
      for (const [r,c,layer=1] of cells) g.ice[r][c] = layer;
      g.iceInitial = g.ice.map(row => row.slice()); g.iceVersion++;
      return getIceSurface(g);
    };
    const at = (s,r,c,array='distance') => s[array][Math.floor(r*s.unit)*s.width+Math.floor(c*s.unit)];
    const rotations = [];
    for (let missing = 0; missing < 4; missing++) {
      const cells = [[2,2],[2,3],[3,2],[3,3]].filter((_,i) => i !== missing), s = set(cells);
      const empty = [[2,2],[2,3],[3,2],[3,3]][missing];
      const seams = [];
      for (const [r,c] of cells) for (const [dr,dc] of [[0,1],[1,0]]) {
        if (cells.some(([y,x]) => y === r+dr && x === c+dc)) seams.push(at(s,r+0.5+dr/2,c+0.5+dc/2));
      }
      rotations.push({ loops:s.loops.length, centers:cells.map(([r,c]) => at(s,r+0.5,c+0.5)), empty:at(s,empty[0]+0.5,empty[1]+0.5), seams });
    }
    const tee = set([[2,2],[2,3],[2,4],[3,3],[4,3]]);
    const tShape = tee.loops.length === 1 && at(tee,3.5,2.5) < 0 && at(tee,3.5,3.5) > 0;
    const ring = []; for (let r=2;r<=4;r++) for (let c=2;c<=4;c++) if (r!==3||c!==3) ring.push([r,c]);
    const hole = set(ring), holeKept = hole.loops.length === 2 && at(hole,3.5,3.5) < -0.2;
    const diagonal = set([[2,2],[3,3]]), separate = diagonal.loops.length === 2 && at(diagonal,3,3) < 0;
    const mixed = set([[2,2,2],[2,3],[3,2],[3,3]]);
    const profile = [];
    for (let x=2.5; x<3.5; x+=1/mixed.unit) profile.push(at(mixed,2.5,x,'density'));
    const blend = { thick:profile[0], thin:profile[profile.length-1], middle:at(mixed,2.5,3,'density'), maxStep:Math.max(...profile.slice(1).map((v,i) => Math.abs(v-profile[i]))) };
    const idleCached = getIceSurface(g) === mixed;
    g.ice[2][2] = 1; g.iceVersion++;
    const cracked = getIceSurface(g), reusedContour = cracked.distance === mixed.distance;
    g.ice[2][2] = 0; g.iceVersion++;
    const thawed = getIceSurface(g), removedCorner = at(thawed,2.5,2.5) < 0 && thawed.distance !== cracked.distance;
    return { rotations, tShape, holeKept, separate, blend, idleCached, reusedContour, removedCorner };
  });
  for (const shape of result.rotations) {
    assert.equal(shape.loops,1); assert.ok(shape.centers.every(d=>d>0.3)); assert.ok(shape.empty < -0.2); assert.ok(shape.seams.every(d=>d>0.3));
  }
  for (const key of ['tShape','holeKept','separate','idleCached','reusedContour','removedCorner']) assert.equal(result[key],true,key);
  assert.ok(result.blend.thick>0.95 && result.blend.thin<0.05);
  assert.ok(result.blend.middle>0.4 && result.blend.middle<0.6);
  assert.ok(result.blend.maxStep<0.06);
  assert.deepEqual(errors,[]);
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
