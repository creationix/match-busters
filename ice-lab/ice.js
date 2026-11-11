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

// Advance only after a completed move; pausing or thinking never grows ice.
export function createFrostGrowth(ice, config) {
  return config ? { after: config.after, remaining: config.limit, quiet: 0, ever: ice.map(row => row.map(Boolean)) } : null;
}

export function advanceFrost(ice, grid, state, damaged, random = Math.random) {
  if (!state) return null;
  if (damaged) { state.quiet = 0; return null; }
  if (!state.remaining || !ice.some(row => row.some(Boolean))) return null;
  if (++state.quiet < state.after) return null;
  state.quiet = 0;
  const rows = ice.length, cols = ice[0].length, candidates = [];
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
    if (!ice[r][c] && !state.ever[r][c] && grid[r][c] && !grid[r][c].sp &&
        (ice[r - 1][c] || ice[r + 1][c] || ice[r][c - 1] || ice[r][c + 1])) candidates.push({ r, c });
  }
  // A growing island must not split the remaining play area into trapped pockets.
  const connected = () => {
    const open = ice.flat().filter(n => !n).length, first = ice.flat().findIndex(n => !n);
    if (first < 0) return false;
    const queue = [first], seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i] / cols | 0, c = queue[i] % cols;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const y = r + dr, x = c + dc, k = y * cols + x;
        if (y >= 0 && x >= 0 && y < rows && x < cols && !ice[y][x] && !seen.has(k)) { seen.add(k); queue.push(k); }
      }
    }
    return seen.size === open;
  };
  const start = Math.floor(random() * candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    const cell = candidates[(start + i) % candidates.length], { r, c } = cell;
    ice[r][c] = 1;
    if (connected()) { state.ever[r][c] = true; state.remaining--; return cell; }
    ice[r][c] = 0;
  }
  return null;
}

export function iceNeighbors(ice, r, c) {
  return (ice[r] && ice[r][c - 1] ? 1 : 0) | (ice[r - 1] && ice[r - 1][c] ? 2 : 0) |
    (ice[r] && ice[r][c + 1] ? 4 : 0) | (ice[r + 1] && ice[r + 1][c] ? 8 : 0);
}

export const iceCrackVariant = (r, c) => (r + c * 3) % 4;

// Shared art direction: a clear window surrounded by a rounded, beveled ice shell.
// Smooth bakes this once per tile size; 3D shades the same silhouette per pixel.
export function drawIceFrame(ctx, size, layers, cracked = false, neighbors = 0, variant = 0) {
  ctx.clearRect(0, 0, size, size);
  ctx.save(); ctx.scale(size, size);
  const thick = layers === 2, bevel = thick ? 0.15 : 0.085, inset = thick ? 0.01 : 0.045;
  const roundBox = (inset, radius) => {
    const left = neighbors & 1 ? -0.2 : inset, top = neighbors & 2 ? -0.2 : inset;
    const right = neighbors & 4 ? 1.2 : 1 - inset, bottom = neighbors & 8 ? 1.2 : 1 - inset;
    ctx.beginPath(); ctx.moveTo(left + radius, top); ctx.lineTo(right - radius, top);
    ctx.quadraticCurveTo(right, top, right, top + radius); ctx.lineTo(right, bottom - radius);
    ctx.quadraticCurveTo(right, bottom, right - radius, bottom); ctx.lineTo(left + radius, bottom);
    ctx.quadraticCurveTo(left, bottom, left, bottom - radius); ctx.lineTo(left, top + radius);
    ctx.quadraticCurveTo(left, top, left + radius, top); ctx.closePath();
  };
  roundBox(inset, 0.12);
  ctx.shadowColor = 'rgba(3,12,36,0.7)'; ctx.shadowBlur = size * 0.035; ctx.shadowOffsetY = size * 0.025;
  ctx.fillStyle = thick ? 'rgba(102,200,236,0.27)' : 'rgba(96,191,229,0.055)'; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowOffsetY = 0;
  // Broad glossy edges, rather than a wire frame or an icon over the piece.
  const rim = ctx.createLinearGradient(0.1, 0, 0.8, 1);
  rim.addColorStop(0, 'rgba(217,250,255,0.85)'); rim.addColorStop(0.24, 'rgba(126,219,245,0.52)');
  rim.addColorStop(0.5, 'rgba(63,151,206,0.3)'); rim.addColorStop(0.8, 'rgba(36,97,157,0.76)');
  rim.addColorStop(1, 'rgba(114,210,242,0.7)');
  roundBox(inset + bevel / 2, 0.11); ctx.strokeStyle = rim; ctx.lineWidth = bevel; ctx.stroke();
  const lip = ctx.createLinearGradient(0, 0, 1, 1);
  lip.addColorStop(0, 'rgba(234,253,255,0.65)'); lip.addColorStop(0.5, 'rgba(147,226,255,0.08)'); lip.addColorStop(1, 'rgba(157,229,255,0.36)');
  roundBox(inset + bevel, 0.09); ctx.strokeStyle = lip; ctx.lineWidth = 0.018; ctx.stroke();
  // Small upper-left reflection; keep the central color window clear.
  ctx.strokeStyle = 'rgba(243,254,255,0.82)'; ctx.lineWidth = 0.025; ctx.lineCap = 'round';
  if (!(neighbors & 2)) { ctx.beginPath(); ctx.moveTo(0.17, 0.085); ctx.lineTo(0.37, 0.085); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(190,241,255,0.4)'; ctx.lineWidth = 0.015;
  if (!(neighbors & 1)) { ctx.beginPath(); ctx.moveTo(0.085, 0.22); ctx.lineTo(0.085, 0.4); ctx.stroke(); }
  ctx.fillStyle = thick ? 'rgba(180,237,255,0.10)' : 'rgba(180,237,255,0.06)';
  ctx.beginPath(); ctx.moveTo(0.1,0.1); ctx.lineTo(0.65,0.1); ctx.lineTo(0.15,0.85); ctx.closePath(); ctx.fill();
  if (cracked) {
    ctx.save(); ctx.translate(0.5,0.5); ctx.rotate(variant * Math.PI / 2); ctx.translate(-0.5,-0.5);
    const fissures = [
      [[0.08,0.36],[0.34,0.44],[0.27,0.62],[0.52,0.52],[0.61,0.73],[0.89,0.83]],
      [[0.27,0.62],[0.18,0.83]], [[0.34,0.44],[0.42,0.24],[0.64,0.16]],
    ];
    for (const [color, width, offset] of [['rgba(13,62,98,0.82)',0.032,0], ['rgba(216,248,255,0.85)',0.014,-0.009]]) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
      for (const points of fissures) {
        ctx.beginPath(); points.forEach(([x,y],i) => ctx[i ? 'lineTo' : 'moveTo'](x + offset, y + offset)); ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

export const ICE_VERTEX_SHADER = `
  varying vec2 vIceUv;
  varying vec3 vIceView;
  void main() {
    vIceUv = uv;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vIceView = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

// Analytic bevel normals produce light and reflected highlights without a scene
// copy, transmission pass, extra textures, or changing the colors under the ice.
export const ICE_FRAGMENT_SHADER = `
  uniform float thick;
  uniform float cracked;
  uniform float variant;
  uniform vec4 neighbors; // left, top, right, bottom
  varying vec2 vIceUv;
  varying vec3 vIceView;
  float shell(vec2 p) {
    float extent = mix(0.455, 0.49, thick);
    vec2 lo = mix(vec2(-extent), vec2(-0.7), neighbors.xw);
    vec2 hi = mix(vec2(extent), vec2(0.7), neighbors.zy);
    vec2 center = (lo + hi) * 0.5;
    vec2 q = abs(p - center) - ((hi - lo) * 0.5 - 0.115);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.115;
  }
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
  }
  float fissure(vec2 p) {
    float d = segment(p, vec2(-0.42,0.14), vec2(-0.16,0.06));
    d = min(d, segment(p, vec2(-0.16,0.06), vec2(-0.23,-0.12)));
    d = min(d, segment(p, vec2(-0.23,-0.12), vec2(0.02,-0.02)));
    d = min(d, segment(p, vec2(0.02,-0.02), vec2(0.11,-0.23)));
    d = min(d, segment(p, vec2(0.11,-0.23), vec2(0.39,-0.33)));
    d = min(d, segment(p, vec2(-0.23,-0.12), vec2(-0.32,-0.33)));
    d = min(d, segment(p, vec2(-0.16,0.06), vec2(-0.08,0.26)));
    return min(d, segment(p, vec2(-0.08,0.26), vec2(0.14,0.34)));
  }
  void main() {
    vec2 p = vIceUv - 0.5;
    float d = shell(p);
    if (d > 0.002) discard;
    float bevel = mix(0.085, 0.15, thick);
    float edge = 1.0 - smoothstep(0.0, bevel, -d);
    vec2 gradient = vec2(shell(p + vec2(0.002,0.0)) - shell(p - vec2(0.002,0.0)),
                         shell(p + vec2(0.0,0.002)) - shell(p - vec2(0.0,0.002))) / 0.004;
    vec3 normal = normalize(vec3(gradient * edge * 0.9, 1.0 - edge * 0.65));
    vec3 view = normalize(vIceView);
    vec3 light = normalize(vec3(-0.55, 0.72, 1.1));
    float diffuse = max(dot(normal, light), 0.0);
    float reflection = pow(max(dot(normal, normalize(light + view)), 0.0), 52.0);
    float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
    float lip = exp(-pow((-d - bevel) / 0.009, 2.0));
    vec3 color = mix(vec3(0.015,0.11,0.23), vec3(0.35,0.78,0.94), diffuse);
    color = mix(color, vec3(0.85,0.97,1.0), clamp(reflection * 0.8 + lip * 0.35, 0.0, 1.0));
    float facet = (1.0 - smoothstep(-0.015,0.015,p.x + 0.65 * p.y + 0.1)) * 0.035;
    float alpha = 0.04 + thick * 0.18 + facet * (1.0 + thick) + edge * (0.54 + thick * 0.08) + reflection * 0.32 + fresnel * 0.12 + lip * 0.16;
    if (cracked > 0.5) {
      vec2 cp = variant < 0.5 ? p : variant < 1.5 ? vec2(-p.y,p.x) : variant < 2.5 ? -p : vec2(p.y,-p.x);
      float groove = 1.0 - smoothstep(0.014, 0.027, fissure(cp));
      float glint = 1.0 - smoothstep(0.005, 0.014, fissure(cp + vec2(0.012,-0.012)));
      color = mix(color, vec3(0.025,0.13,0.22), groove);
      color = mix(color, vec3(0.66,0.9,0.98), glint);
      alpha = max(alpha, groove * 0.6 + glint * 0.16);
    }
    // Stay below the bloom threshold: highlights belong to the shell, not the whole cell.
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), min(alpha, 0.85) * (1.0 - smoothstep(-0.002,0.002,d)));
  }
`;
