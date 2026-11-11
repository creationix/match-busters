export function openAreaConnected(ice) {
  const rows = ice.length, cols = ice[0].length, flat = ice.flat(), first = flat.findIndex(n => !n);
  if (first < 0) return false;
  const open = flat.filter(n => !n).length, queue = [first], seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const r = queue[i] / cols | 0, c = queue[i] % cols;
    for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const y = r+dr, x = c+dc, key = y*cols+x;
      if (y>=0 && x>=0 && y<rows && x<cols && !ice[y][x] && !seen.has(key)) { seen.add(key); queue.push(key); }
    }
  }
  return seen.size === open;
}

// Ice is rolled with each board; power-ups must be earned from matches.
// Legacy numeric designs keep the lab's four difficulty bands without fixed maps.
export function createIcePlan(rows, cols, design = 0, random = Math.random) {
  const lab = [{ tiles:6, thick:0 },{ tiles:8, thick:0 },{ tiles:12, thick:1 },{ tiles:16, thick:0.5 }];
  const config = Number.isInteger(design) ? lab[design] : design;
  const ice = Array.from({ length:rows }, () => Array(cols).fill(0));
  const area = (rows-2)*(cols-2), scale = Number.isInteger(design) ? 1 : rows*cols/64;
  const target = Math.max(0,Math.min(Math.floor(area*0.8),Math.round(config.tiles*scale)));
  const shuffle = array => {
    for (let i=array.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [array[i],array[j]]=[array[j],array[i]]; }
    return array;
  };
  const slots = [];
  for (let r=1;r<rows-1;r++) for (let c=1;c<cols-1;c++) slots.push({r,c});
  const placed = [], seeds = [], islands = Math.min(target,Math.max(1,Math.round(target/7)));
  // Distributed seeds create several patches instead of one solid wall.
  for (const cell of shuffle(slots.slice())) {
    if (seeds.length>=islands) break;
    if (seeds.some(p=>Math.abs(p.r-cell.r)+Math.abs(p.c-cell.c)<3)) continue;
    ice[cell.r][cell.c]=1;
    if (openAreaConnected(ice)) { seeds.push(cell); placed.push(cell); } else ice[cell.r][cell.c]=0;
  }
  while (placed.length<target) {
    const available = slots.filter(p=>!ice[p.r][p.c]);
    const frontier = available.filter(({r,c})=>ice[r-1][c]||ice[r+1][c]||ice[r][c-1]||ice[r][c+1]);
    const preferPatch = random()<0.82 && frontier.length;
    const candidates = shuffle(preferPatch ? frontier : available);
    // Include all remaining slots if a patch's frontier is blocked by a corridor.
    if (preferPatch) candidates.push(...shuffle(available.filter(p=>!frontier.includes(p))));
    let added = false;
    for (const cell of candidates) {
      ice[cell.r][cell.c]=1;
      if (openAreaConnected(ice)) { placed.push(cell); added=true; break; }
      ice[cell.r][cell.c]=0;
    }
    if (!added) break;
  }
  const thickCount = Math.round(placed.length*Math.max(0,Math.min(1,config.thick||0)));
  shuffle(placed).slice(0,thickCount).forEach(({r,c})=>{ice[r][c]=2;});
  return { ice, powers:[], total:placed.length };
}

