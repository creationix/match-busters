// Compact islands keep the outer border and a connected playable area open.
export function createIcePlan(rows, cols, scenario) {
  const ice = Array.from({ length: rows }, () => Array(cols).fill(0));
  const powers = new Map();
  const addGroup = (ry, cx, width = 2, layers = 1) => {
    const r = Math.max(1, Math.min(rows - 3, Math.floor(rows * ry) - 1));
    const c = Math.max(1, Math.min(cols - width - 1, Math.floor(cols * cx) - 1));
    for (let y = r; y < r + 2; y++) for (let x = c; x < c + width; x++) ice[y][x] = layers;
  };
  if (scenario === 0) addGroup(0.5, 0.5, 3);
  if (scenario === 1) { addGroup(0.3, 0.3); addGroup(0.72, 0.72); }
  if (scenario === 2) { addGroup(0.3, 0.3, 2, 2); addGroup(0.52, 0.72, 2, 2); addGroup(0.8, 0.3, 2, 2); }
  if (scenario === 3) {
    addGroup(0.3, 0.3, 2, 2); addGroup(0.3, 0.72);
    addGroup(0.72, 0.3); addGroup(0.72, 0.72, 2, 2);
  }
  const power = (r, c, sp, t = (r + c) % 5, dir = 'h') => {
    if (r >= 0 && c >= 0 && r < rows && c < cols && !ice[r][c]) powers.set(r * cols + c, { r, c, sp, t, dir });
  };
  // Small optional starter pairs, away from the ice. Ordinary matching must
  // remain useful after these fall, fire, or are ignored entirely.
  const middle = Math.floor(cols / 2) - 1;
  if (scenario === 1) { power(rows - 1, middle, 'bomb'); power(rows - 1, middle + 1, 'line'); }
  if (scenario === 2) { power(rows - 1, middle, 'bomb'); power(rows - 1, middle + 1, 'bomb'); }
  if (scenario === 3) {
    const c = Math.floor(cols / 2) - 1;
    power(rows - 1, c, 'color', 4); power(rows - 1, c + 1, 'bomb', 1);
  }
  return { ice, powers: [...powers.values()], total: ice.flat().filter(Boolean).length };
}

// Transparent centers preserve piece colors, including under Extreme bloom.
export function drawIceFrame(ctx, size, layers, cracked = false) {
  const pad = size * 0.055, edge = size - pad * 2;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(100,185,240,0.12)'; ctx.fillRect(pad, pad, edge, edge);
  ctx.strokeStyle = '#b7e5ff'; ctx.lineWidth = Math.max(1.5, size * 0.025);
  ctx.strokeRect(pad, pad, edge, edge);
  if (layers === 2) {
    ctx.strokeStyle = '#75b5e1'; ctx.lineWidth = Math.max(1, size * 0.018);
    ctx.strokeRect(pad * 2, pad * 2, size - pad * 4, size - pad * 4);
  }
  const x = size * 0.23, y = size * 0.23, radius = size * 0.105;
  ctx.strokeStyle = '#d4f0ff'; ctx.lineWidth = Math.max(1, size * 0.018);
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI / 3;
    ctx.beginPath(); ctx.moveTo(x - Math.cos(angle) * radius, y - Math.sin(angle) * radius);
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius); ctx.stroke();
  }
  if (cracked) {
    ctx.strokeStyle = '#edfaff'; ctx.beginPath(); ctx.moveTo(pad, size * 0.7);
    ctx.lineTo(size * 0.23, size * 0.78); ctx.lineTo(size * 0.17, size * 0.88); ctx.lineTo(size * 0.35, size - pad); ctx.stroke();
  }
}
