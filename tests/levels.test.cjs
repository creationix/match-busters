const assert=require('node:assert/strict');
const{test}=require('node:test');
function rng(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}}
function connected(ice){
  const rows=ice.length,cols=ice[0].length,queue=[[0,0]],seen=new Set([0]);
  for(let i=0;i<queue.length;i++){
    const[r,c]=queue[i];for(const[dr,dc]of[[-1,0],[1,0],[0,-1],[0,1]]){
      const y=r+dr,x=c+dc,k=y*cols+x;if(y>=0&&x>=0&&y<rows&&x<cols&&!ice[y][x]&&!seen.has(k)){seen.add(k);queue.push([y,x])}
    }
  }
  return seen.size===rows*cols-ice.flat().filter(Boolean).length;
}
test('eight advanced stages increase ice density, thickness, and spreading pressure',async()=>{
  const{LEVELS}=await import('../levels.js');assert.equal(LEVELS.length,24);
  const advanced=LEVELS.slice(16);assert.deepEqual(advanced.map(l=>l.ice.tiles),[18,20,22,24,24,26,27,28]);
  assert.ok(advanced.every(l=>l.growth&&l.growth.after<=4));assert.ok(advanced.slice(-3).every(l=>l.growth.after===2));
  assert.equal(advanced[7].ice.thick,1);assert.ok(advanced.filter(l=>l.type==='score').every(l=>l.goal>10000));
});
test('fresh ice layouts vary by seed, scale with board area, preserve open paths, and never supply starter powers',async()=>{
  const{LEVELS}=await import('../levels.js'),{createIcePlan}=await import('../ice.js');
  for(const[rows,cols]of[[8,8],[12,8],[8,12],[16,8],[8,16]])for(const level of LEVELS.filter(l=>l.ice)){
    const layouts=new Set(),target=Math.min(Math.floor((rows-2)*(cols-2)*0.8),Math.round(level.ice.tiles*rows*cols/64));
    for(let seed=1;seed<=6;seed++){
      const plan=createIcePlan(rows,cols,level.ice,rng(seed));assert.equal(plan.total,target);assert.deepEqual(plan.powers,[]);
      assert.equal(plan.ice.flat().filter(n=>n===2).length,Math.round(target*level.ice.thick));assert.ok(connected(plan.ice));
      assert.ok(plan.ice[0].every(n=>n===0)&&plan.ice[rows-1].every(n=>n===0));assert.ok(plan.ice.every(row=>row[0]===0&&row[cols-1]===0));
      layouts.add(JSON.stringify(plan.ice));
      assert.deepEqual(plan,createIcePlan(rows,cols,level.ice,rng(seed)));
    }
    assert.ok(layouts.size>1,'Each retry must have a fresh layout');
  }
});
