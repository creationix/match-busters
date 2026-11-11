import { BOARD_PADDING } from './board-layout.js';
import { getIceSurface, getIceSprite } from './ice.js';

// Cached sprites keep the touch-device renderer independent of WebGL and Three.js.
export function createCanvasRenderer(canvas, { G, SHAPES, drawIcon }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const background = document.createElement('canvas');
  let width = 0, height = 0, rows = 0, cols = 0, cell = 0, insetX = 0, insetY = 0, frames = 0, sprites = [];
  let lastGrid = null, lastSelection = null, lastHint = null, hadEffects = false;
  const previous = [];
  let lastIceVersion = -1;
  const at = (col, row) => ({ x: insetX + (col + 0.5) * cell, y: insetY + (row + 0.5) * cell });
  const sameCell = (a, b) => a && a.r === b.r && a.c === b.c;

  function resize(pxWidth, pxHeight) {
    if (width === pxWidth && height === pxHeight && rows === G.rows && cols === G.cols) return;
    width = pxWidth; height = pxHeight; rows = G.rows; cols = G.cols;
    cell = Math.min(width / (cols + BOARD_PADDING), height / (rows + BOARD_PADDING));
    insetX = (width - cell * cols) / 2; insetY = (height - cell * rows) / 2;
    canvas.width = background.width = width; canvas.height = background.height = height;
    const bg = background.getContext('2d');
    bg.fillStyle = '#140a2e'; bg.fillRect(0, 0, width, height);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      bg.fillStyle = (r + c) % 2 ? '#211541' : '#2a1c50';
      bg.beginPath();
      const x = insetX + c * cell + 2, y = insetY + r * cell + 2, side = cell - 4;
      if (bg.roundRect) bg.roundRect(x, y, side, side, cell * 0.12);
      else bg.rect(x, y, side, side);
      bg.fill();
    }
    sprites = SHAPES.map((shape, type) => {
      const variants = {};
      for (const special of ['normal', 'h', 'v', 'bomb', 'color']) {
        const sprite = document.createElement('canvas');
        const px = Math.ceil(cell * 1.25); sprite.width = sprite.height = px;
        const c = sprite.getContext('2d'), mid = px / 2;
        drawIcon(c, type, mid, mid, px * 0.95);
        c.save(); c.translate(mid, mid);
        if (special === 'h' || special === 'v') {
          if (special === 'v') c.rotate(Math.PI / 2);
          c.strokeStyle = '#fff'; c.lineWidth = px * 0.055; c.lineCap = 'round';
          c.beginPath(); c.moveTo(-px * 0.23, 0); c.lineTo(px * 0.23, 0); c.stroke();
          c.fillStyle = '#fff';
          for (const dir of [-1, 1]) {
            c.beginPath(); c.moveTo(dir * px * 0.32, 0);
            c.lineTo(dir * px * 0.2, -px * 0.09); c.lineTo(dir * px * 0.2, px * 0.09); c.fill();
          }
        } else if (special === 'bomb') {
          c.fillStyle = '#120820'; c.beginPath(); c.arc(0, 0, px * 0.14, 0, Math.PI * 2); c.fill();
          c.strokeStyle = '#ffd84a'; c.lineWidth = px * 0.035;
          c.beginPath(); c.moveTo(px * 0.06, -px * 0.1); c.lineTo(px * 0.14, -px * 0.2); c.stroke();
          c.fillStyle = '#fff3b0'; c.beginPath(); c.arc(px * 0.14, -px * 0.2, px * 0.04, 0, Math.PI * 2); c.fill();
        } else if (special === 'color') {
          c.lineWidth = px * 0.045;
          for (let i = 0; i < 12; i++) {
            c.strokeStyle = `hsl(${i * 30},100%,65%)`; c.beginPath();
            c.arc(0, 0, px * 0.37, i * Math.PI / 6, (i + 1) * Math.PI / 6); c.stroke();
          }
        }
        c.restore(); variants[special] = sprite;
      }
      return variants;
    });
    lastGrid = null;
  }

  function piece(p, scale = 1, alpha = 1) {
    const point = at(p.x, p.y), sprite = sprites[p.t][p.sp === 'line' ? p.dir : p.sp || 'normal'];
    const width = sprite.width * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, point.x - width / 2, point.y - width / 2, width, width);
  }

  function render(time) {
    const effects = !!(G.dying.length || G.parts.length || G.beams.length || G.blasts.length || G.flash || G.shake);
    let changed = lastGrid !== G.grid || lastIceVersion !== G.iceVersion || lastSelection !== G.sel || lastHint !== G.hint || effects || hadEffects || G.sel || G.hint;
    let i = 0;
    if (G.grid) for (const row of G.grid) for (const p of row) {
      const old = previous[i++];
      if (!old || old.p !== p || (p && (old.x !== p.x || old.y !== p.y || old.born !== p.born))) changed = true;
    }
    if (!changed) return; // A settled board needs no redraws until something changes.
    frames++;
    lastGrid = G.grid; lastSelection = G.sel; lastHint = G.hint; hadEffects = effects;
    lastIceVersion = G.iceVersion;
    ctx.globalAlpha = 1; ctx.drawImage(background, 0, 0);
    ctx.save();
    if (G.shake) ctx.translate((Math.random() - 0.5) * G.shake * cell * 0.15, (Math.random() - 0.5) * G.shake * cell * 0.15);
    const pulse = Math.sin(time * 8);
    i = 0;
    if (G.grid) for (const row of G.grid) for (const p of row) {
      previous[i++] = p ? { p, x: p.x, y: p.y, born: p.born } : { p };
      if (!p) continue;
      const b = p.born - 1;
      let scale = p.born < 1 ? 0.2 + 0.8 * (1 + 2.7 * b * b * b + 1.7 * b * b) : 1;
      if (sameCell(G.sel, p)) scale *= 1.15;
      else if (G.hint && G.hint.some(h => sameCell(h, p))) scale *= 1 + 0.08 * pulse;
      piece(p, scale);
    }
    for (const d of G.dying) piece(d.p, 0.5 + d.life * 0.7, Math.max(0, d.life));
    ctx.globalAlpha = 1;
    if (G.ice && G.ice.length && G.iceTotal > G.thawed) {
      const surface = getIceSurface(G);
      if (surface.visible) ctx.drawImage(getIceSprite(surface,G.iceInitial),insetX,insetY,cols*cell,rows*cell);
    }
    if (G.sel) {
      const point = at(G.sel.c, G.sel.r);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect(point.x - cell * 0.44, point.y - cell * 0.44, cell * 0.88, cell * 0.88);
    }
    for (const b of G.beams) {
      const point = at(b.c, b.r); ctx.fillStyle = b.color; ctx.globalAlpha = b.life;
      const thickness = cell * (0.1 + b.life * 0.3);
      if (b.dir === 'h') ctx.fillRect(0, point.y - thickness / 2, width, thickness);
      else ctx.fillRect(point.x - thickness / 2, 0, thickness, height);
    }
    for (const b of G.blasts) {
      const point = at(b.c, b.r); ctx.strokeStyle = b.color; ctx.globalAlpha = b.life;
      ctx.lineWidth = Math.max(1, cell * 0.07 * b.life); ctx.beginPath();
      ctx.arc(point.x, point.y, b.size * cell * (0.2 + 0.8 * (1 - b.life * b.life)), 0, Math.PI * 2); ctx.stroke();
    }
    for (const q of G.parts) {
      const point = at(q.x + (cols - 1) / 2, (rows - 1) / 2 - q.y), side = Math.max(1, cell * 0.055 * q.life);
      ctx.fillStyle = q.color; ctx.globalAlpha = Math.max(0, q.life);
      ctx.fillRect(point.x - side / 2, point.y - side / 2, side, side);
    }
    ctx.restore();
    if (G.flash) { ctx.fillStyle = G.flashColor; ctx.globalAlpha = G.flash * 0.4; ctx.fillRect(0, 0, width, height); }
    ctx.globalAlpha = 1;
  }

  return {
    kind: 'canvas', quality: 'smooth', get frames() { return frames; }, resize, render,
    project(col, row) { const point = at(col, row); return { x: point.x / width, y: point.y / height }; },
    cellAt(e) {
      const box = canvas.getBoundingClientRect();
      const c = Math.floor(((e.clientX - box.left) * width / box.width - insetX) / cell);
      const r = Math.floor(((e.clientY - box.top) * height / box.height - insetY) / cell);
      return r >= 0 && c >= 0 && r < rows && c < cols ? { r, c } : null;
    },
    dispose() { sprites = []; previous.length = 0; background.width = background.height = 0; },
  };
}
