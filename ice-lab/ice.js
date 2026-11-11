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

// Trace the exposed edges of the entire frozen region, including concave
// corners and holes. Right turns keep diagonally touching islands separate.
function iceContours(ice) {
  const edges = [], starts = new Map(), rows = ice.length, cols = ice[0].length;
  const add = (x, y, dx, dy, dir) => {
    const edge = { x, y, dx, dy, dir, used: false }, key = x + ',' + y;
    edges.push(edge); if (!starts.has(key)) starts.set(key, []); starts.get(key).push(edge);
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (ice[r][c]) {
    if (!r || !ice[r - 1][c]) add(c,r,1,0,0);
    if (c === cols - 1 || !ice[r][c + 1]) add(c+1,r,0,1,1);
    if (r === rows - 1 || !ice[r + 1][c]) add(c+1,r+1,-1,0,2);
    if (!c || !ice[r][c - 1]) add(c,r+1,0,-1,3);
  }
  const loops = [], rank = [1,0,3,2];
  for (const first of edges) if (!first.used) {
    let edge = first; const points = [];
    while (edge && !edge.used) {
      edge.used = true; points.push([edge.x,edge.y]);
      const x = edge.x + edge.dx, y = edge.y + edge.dy;
      if (x === first.x && y === first.y) break;
      const incoming = edge.dir;
      edge = (starts.get(x + ',' + y) || []).filter(e => !e.used)
        .sort((a,b) => rank[(a.dir-incoming+4)%4] - rank[(b.dir-incoming+4)%4])[0];
    }
    loops.push(points.filter((p,i) => {
      const a = points[(i+points.length-1)%points.length], b = points[(i+1)%points.length];
      return (p[0]-a[0])*(b[1]-p[1]) !== (p[1]-a[1])*(b[0]-p[0]);
    }));
  }
  return loops;
}

function icePath(ctx, loops, unit) {
  ctx.beginPath();
  for (const points of loops) {
    points.forEach((p,i) => {
      const a = points[(i+points.length-1)%points.length], b = points[(i+1)%points.length];
      const la = Math.hypot(a[0]-p[0],a[1]-p[1]), lb = Math.hypot(b[0]-p[0],b[1]-p[1]);
      const radius = Math.min(0.13,la/2,lb/2), enter = [p[0]+(a[0]-p[0])*radius/la,p[1]+(a[1]-p[1])*radius/la];
      ctx[i ? 'lineTo' : 'moveTo'](enter[0]*unit,enter[1]*unit);
      ctx.quadraticCurveTo(p[0]*unit,p[1]*unit,(p[0]+(b[0]-p[0])*radius/lb)*unit,(p[1]+(b[1]-p[1])*radius/lb)*unit);
    });
    ctx.closePath();
  }
}

const surfaceCache = new WeakMap(), ICE_RESOLUTION = 40;
// One continuous distance/height field prevents tile boundaries from becoming
// clipping planes. It is rebuilt only when ice changes, never on idle frames.
export function getIceSurface(G) {
  const previous = surfaceCache.get(G), ice = G.ice, rows = ice.length, cols = ice[0].length;
  if (previous && previous.ice === ice && previous.version === G.iceVersion) return previous;
  const unit = ICE_RESOLUTION, width = cols*unit, height = rows*unit, count = width*height;
  const coverage = ice.map(row => row.map(n => n ? '1' : '0').join('')).join('');
  let mask, distance, loops;
  if (previous && previous.coverage === coverage && previous.width === width && previous.height === height) {
    ({ mask, distance, loops } = previous);
  } else {
    loops = iceContours(ice); mask = document.createElement('canvas'); mask.width = width; mask.height = height;
    const ctx = mask.getContext('2d', { willReadFrequently: true }); icePath(ctx,loops,unit); ctx.fillStyle = '#fff'; ctx.fill('evenodd');
    const pixels = ctx.getImageData(0,0,width,height).data, inside = new Uint8Array(count), unsigned = new Float32Array(count);
    for (let i = 0; i < count; i++) inside[i] = pixels[i*4+3] >= 128 ? 1 : 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y*width+x, alpha = pixels[i*4+3]/255;
      const boundary = (x && inside[i-1] !== inside[i]) || (x+1<width && inside[i+1] !== inside[i]) ||
        (y && inside[i-width] !== inside[i]) || (y+1<height && inside[i+width] !== inside[i]);
      unsigned[i] = alpha > 0 && alpha < 1 ? Math.abs(alpha-0.5) : boundary ? 0.5 : 1e6;
    }
    const diagonal = Math.SQRT2;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y*width+x; let d = unsigned[i];
      if (x) d = Math.min(d,unsigned[i-1]+1);
      if (y) { d = Math.min(d,unsigned[i-width]+1); if (x) d = Math.min(d,unsigned[i-width-1]+diagonal); if (x+1<width) d = Math.min(d,unsigned[i-width+1]+diagonal); }
      unsigned[i] = d;
    }
    for (let y = height-1; y >= 0; y--) for (let x = width-1; x >= 0; x--) {
      const i = y*width+x; let d = unsigned[i];
      if (x+1<width) d = Math.min(d,unsigned[i+1]+1);
      if (y+1<height) { d = Math.min(d,unsigned[i+width]+1); if (x) d = Math.min(d,unsigned[i+width-1]+diagonal); if (x+1<width) d = Math.min(d,unsigned[i+width+1]+diagonal); }
      unsigned[i] = d;
    }
    distance = new Float32Array(count);
    for (let i = 0; i < count; i++) distance[i] = Math.min(1,unsigned[i]/unit)*(inside[i] ? 1 : -1);
  }
  // Blur occupied weight and thick weight together, then normalize. This tapers
  // thickness across shared edges without fading solid ice beside empty space.
  const weights = new Float32Array(count), thick = new Float32Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y*width+x, layer = ice[y/unit|0][x/unit|0];
    weights[i] = layer ? 1 : 0; thick[i] = layer === 2 ? 1 : 0;
  }
  function blur(input) {
    const radius = Math.round(unit*0.24), span = radius*2+1, temp = new Float32Array(count), out = new Float32Array(count);
    for (let y = 0; y < height; y++) {
      const offset = y*width; let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += input[offset+Math.max(0,Math.min(width-1,x))];
      for (let x = 0; x < width; x++) {
        temp[offset+x] = sum/span;
        sum += input[offset+Math.min(width-1,x+radius+1)] - input[offset+Math.max(0,x-radius)];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += temp[Math.max(0,Math.min(height-1,y))*width+x];
      for (let y = 0; y < height; y++) {
        out[y*width+x] = sum/span;
        sum += temp[Math.min(height-1,y+radius+1)*width+x] - temp[Math.max(0,y-radius)*width+x];
      }
    }
    return out;
  }
  const blurredWeight = blur(weights), blurredThick = blur(thick), data = new Uint8Array(count*4), density = new Float32Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y*width+x, r = y/unit|0, c = x/unit|0;
    const encoded = Math.max(0,Math.min(65535,Math.round((distance[i]+0.2)*131070)));
    density[i] = blurredWeight[i] > 0 ? blurredThick[i]/blurredWeight[i] : 0;
    data[i*4] = encoded>>8; data[i*4+1] = encoded&255;
    data[i*4+2] = Math.round(density[i]*255); data[i*4+3] = ice[r][c] === 1 && G.iceInitial[r][c] === 2 ? 255 : 0;
  }
  const surface = { ice, version: G.iceVersion, coverage, width, height, rows, cols, unit, mask, loops, distance, density, data, visible: loops.length > 0, sprite: null };
  surfaceCache.set(G,surface); return surface;
}

const smoothstep = (a,b,x) => { const t = Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
export function getIceSprite(surface, initial) {
  if (surface.sprite) return surface.sprite;
  const { width, height, distance, density, unit, ice, rows, cols } = surface;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(width,height);
  const gamma = n => Math.round(Math.pow(Math.max(0,Math.min(1,n)),1/2.2)*255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y*width+x, thick = density[i], d = distance[i]-(0.045-0.035*thick);
    if (d < -0.012) continue;
    const bevel = 0.085+0.065*thick, edge = 1-smoothstep(0,bevel,d);
    let nx = (distance[y*width+Math.max(0,x-1)]-distance[y*width+Math.min(width-1,x+1)])*unit/2*edge*0.9;
    let ny = (distance[Math.min(height-1,y+1)*width+x]-distance[Math.max(0,y-1)*width+x])*unit/2*edge*0.9;
    let nz = 1-edge*0.65; const length = Math.hypot(nx,ny,nz); nx/=length; ny/=length; nz/=length;
    const diffuse = Math.max(0,nx*-0.387+ny*0.507+nz*0.77), reflection = Math.pow(Math.max(0,nx*-0.206+ny*0.269+nz*0.941),52);
    const lip = Math.exp(-Math.pow((d-bevel)/0.009,2)), highlight = Math.min(1,reflection*0.8+lip*0.35);
    const facet = (1-smoothstep(-0.08,0.08,Math.sin((x/unit+0.65*y/unit)*0.9)))*0.035;
    const alpha = Math.min(0.85,0.04+thick*0.18+facet*(1+thick)+edge*(0.54+thick*0.08)+reflection*0.32+lip*0.16)*(smoothstep(-0.012,0.012,d));
    pixels.data[i*4] = gamma((0.015+0.335*diffuse)*(1-highlight)+0.85*highlight);
    pixels.data[i*4+1] = gamma((0.11+0.67*diffuse)*(1-highlight)+0.97*highlight);
    pixels.data[i*4+2] = gamma((0.23+0.71*diffuse)*(1-highlight)+highlight);
    pixels.data[i*4+3] = Math.round(alpha*255);
  }
  ctx.putImageData(pixels,0,0); ctx.save(); icePath(ctx,surface.loops,unit); ctx.clip('evenodd');
  const fissures = [[[0.08,0.36],[0.34,0.44],[0.27,0.62],[0.52,0.52],[0.61,0.73],[0.89,0.83]],[[0.27,0.62],[0.18,0.83]],[[0.34,0.44],[0.42,0.24],[0.64,0.16]]];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (ice[r][c] === 1 && initial[r][c] === 2) {
    ctx.save(); ctx.translate((c+0.5)*unit,(r+0.5)*unit); ctx.rotate((r+c*3)%4*Math.PI/2); ctx.scale(unit,unit); ctx.translate(-0.5,-0.5);
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const [color,lineWidth,offset] of [['rgba(13,62,98,.82)',.032,0],['rgba(216,248,255,.85)',.014,-.009]]) {
      ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
      for (const points of fissures) { ctx.beginPath(); points.forEach(([x,y],i) => ctx[i ? 'lineTo' : 'moveTo'](x+offset,y+offset)); ctx.stroke(); }
    }
    ctx.restore();
  }
  ctx.restore(); surface.sprite = canvas; return canvas;
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

// A cached contour/height texture supplies continuous bevel normals and density.
// No scene-copy or transmission pass is needed.
export const ICE_FRAGMENT_SHADER = `
  uniform sampler2D field;
  uniform vec2 fieldTexel;
  uniform vec2 boardSize;
  uniform float resolution;
  varying vec2 vIceUv;
  varying vec3 vIceView;
  float depthAt(vec2 uv) {
    vec2 encoded = texture2D(field, uv).rg;
    return dot(encoded, vec2(65280.0,255.0)) / 131070.0 - 0.2;
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
    vec2 uv = vec2(vIceUv.x,1.0-vIceUv.y);
    vec4 state = texture2D(field,uv);
    float thick = state.b;
    float d = mix(0.045,0.01,thick) - depthAt(uv);
    if (d > 0.012) discard;
    vec2 cell = uv * boardSize;
    vec2 p = vec2(fract(cell.x)-0.5,0.5-fract(cell.y));
    float variant = mod(floor(cell.y)+floor(cell.x)*3.0,4.0);
    float bevel = mix(0.085,0.15,thick);
    float edge = 1.0-smoothstep(0.0,bevel,-d);
    vec2 gradient = vec2(depthAt(uv-vec2(fieldTexel.x,0.0))-depthAt(uv+vec2(fieldTexel.x,0.0)),
                         depthAt(uv+vec2(0.0,fieldTexel.y))-depthAt(uv-vec2(0.0,fieldTexel.y))) * resolution * 0.5;
    vec3 normal = normalize(vec3(gradient * edge * 0.9, 1.0 - edge * 0.65));
    vec3 view = normalize(vIceView);
    vec3 light = normalize(vec3(-0.55, 0.72, 1.1));
    float diffuse = max(dot(normal, light), 0.0);
    float reflection = pow(max(dot(normal, normalize(light + view)), 0.0), 52.0);
    float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
    float lip = exp(-pow((-d - bevel) / 0.009, 2.0));
    vec3 color = mix(vec3(0.015,0.11,0.23), vec3(0.35,0.78,0.94), diffuse);
    color = mix(color, vec3(0.85,0.97,1.0), clamp(reflection * 0.8 + lip * 0.35, 0.0, 1.0));
    float facet = (1.0-smoothstep(-0.08,0.08,sin((cell.x+0.65*cell.y)*0.9)))*0.035;
    float alpha = 0.04 + thick * 0.18 + facet * (1.0 + thick) + edge * (0.54 + thick * 0.08) + reflection * 0.32 + fresnel * 0.12 + lip * 0.16;
    if (state.a > 0.01) {
      vec2 cp = variant < 0.5 ? p : variant < 1.5 ? vec2(-p.y,p.x) : variant < 2.5 ? -p : vec2(p.y,-p.x);
      float groove = (1.0-smoothstep(0.014,0.027,fissure(cp)))*state.a;
      float glint = (1.0-smoothstep(0.005,0.014,fissure(cp+vec2(0.012,-0.012))))*state.a;
      color = mix(color, vec3(0.025,0.13,0.22), groove);
      color = mix(color, vec3(0.66,0.9,0.98), glint);
      alpha = max(alpha, groove * 0.6 + glint * 0.16);
    }
    // Stay below the bloom threshold: highlights belong to the shell, not the whole cell.
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), min(alpha, 0.85) * (1.0 - smoothstep(-0.012,0.012,d)));
  }
`;
