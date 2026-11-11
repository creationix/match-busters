const assert = require('node:assert/strict');
const { test } = require('node:test');

test('auto-fit grows along the available screen axis while Classic remains 8×8', async () => {
  const { chooseBoardShape } = await import('../board-layout.js');
  const tall = chooseBoardShape('auto', 370, 680), wide = chooseBoardShape('auto', 680, 370);
  assert.equal(tall.cols, 8); assert.ok(tall.rows > 8);
  assert.equal(wide.rows, 8); assert.ok(wide.cols > 8);
  assert.deepEqual(tall, { rows: wide.cols, cols: wide.rows });
  assert.deepEqual(chooseBoardShape('classic', 370, 680), { rows: 8, cols: 8 });
  assert.deepEqual(chooseBoardShape('tall', 1200, 600), { rows: 12, cols: 8 });
  assert.deepEqual(chooseBoardShape('wide', 370, 680), { rows: 8, cols: 12 });
  assert.deepEqual(chooseBoardShape('auto', 400, 400), { rows: 8, cols: 8 });
  assert.ok(chooseBoardShape('auto', 100, 10000).rows <= 16);
});

test('every board fits the available rectangle with square cells and no cropping', async () => {
  const { fitBoard, BOARD_PADDING } = await import('../board-layout.js');
  for (const [rows, cols] of [[8, 8], [12, 8], [8, 12], [16, 8], [8, 16]]) {
    for (const [width, height] of [[300, 440], [740, 900], [630, 366], [1200, 760]]) {
      const fit = fitBoard(rows, cols, width, height);
      assert.ok(fit.width <= width && fit.height <= height);
      assert.ok(Math.abs(fit.width / (cols + BOARD_PADDING) - fit.height / (rows + BOARD_PADDING)) < 0.2);
      assert.ok(width - fit.width < 2 || height - fit.height < 2);
    }
  }
});
