const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');
const root = path.resolve(__dirname,'..'), prefix = '/match-busters/';
const stars = [3,2,1,3,2,1,3,2,1,3,2,1,3,2,1,3];
let browser, server, origin;
before(async () => {
  server = http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url,'http://localhost');
      if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
      const file = url.pathname.slice(prefix.length)+(url.pathname.endsWith('/')?'index.html':'');
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');
      res.setHeader('Cache-Control','no-store'); res.end(await readFile(path.join(root,file)));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--enable-unsafe-swiftshader']});
});
after(async () => { if(browser)await browser.close(); if(server)await new Promise(resolve=>server.close(resolve)); });
async function open(t,options={}) {
  const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,...options}); t.after(()=>context.close());
  await context.addInitScript(stars=>{
    if(!localStorage.getItem('matchbusters'))localStorage.setItem('matchbusters',JSON.stringify({stars,smooth:true,keep3D:true,sound:false,music:false,boardLayout:'classic'}));
    if(!localStorage.getItem('matchbusters-ice-lab'))localStorage.setItem('matchbusters-ice-lab',JSON.stringify({stars:[1,2,3,1],smooth:true}));
  },stars);
  const page = await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+prefix);await page.waitForFunction(()=>window.__mb);
  return{page,context,errors};
}
async function move(page,a,b) {
  await page.evaluate(async({a,b})=>{
    const driving=setInterval(()=>__mb.update(0.1),1);
    try{await __mb.trySwap(a,b);}finally{clearInterval(driving);}
  },{a,b});
}
async function tap(page,r,c) {
  const point=await page.evaluate(({r,c})=>__mb.renderer.project(c,r),{r,c}),box=await page.locator('#board').boundingBox();
  await page.mouse.click(box.x+point.x*box.width,box.y+point.y*box.height);
}

test('campaign keeps all 16 existing saved slots across 24 levels and goal types while introducing thin, thick, and growing frost',async t=>{
  const{page,errors}=await open(t);
  await page.getByRole('button',{name:'Play',exact:true}).click();assert.equal(await page.locator('.lvBtn').count(),24);assert.equal(await page.locator('.lvBtn:enabled').count(),17);
  assert.match(await page.locator('.lvBtn').nth(4).textContent(),/ice/);
  const result=await page.evaluate(()=>{
    const mb=__mb,g=mb.G,checks=[];
    for(const layout of ['classic','tall','wide'])for(let level=0;level<24;level++){
      mb.save.boardLayout=layout;mb.startLevel(level);mb.setPaused(true);
      checks.push({level,layout,type:g.lv.type,rows:g.rows,cols:g.cols,starters:g.grid.flat().filter(p=>p.sp).length,total:g.iceTotal,thick:g.ice.flat().filter(n=>n===2).length,growing:!!g.frost,matches:mb.findMatches().length,moves:!!mb.findMove(),full:g.grid.flat().every(Boolean)});
    }
    return{checks,stars:mb.save.stars,lab:JSON.parse(localStorage.getItem('matchbusters-ice-lab')).stars};
  });
  const types=['score','collect','timed','score','collect','timed','collect','score','score','collect','timed','score','collect','timed','collect','score','collect','score','collect','score','collect','score','collect','score'];
  for(const check of result.checks){
    assert.equal(check.type,types[check.level]);assert.equal(check.starters,0);assert.equal(check.matches,0);assert.ok(check.moves&&check.full);
    if(check.level<4||check.type==='timed')assert.equal(check.total,0);
    if(check.level===4)assert.equal(check.total,Math.round(6*check.rows*check.cols/64));
    if(check.level<8)assert.equal(check.thick,0);
    if(check.level===8)assert.equal(check.thick,check.total);
    assert.equal(check.growing,(check.level===12||check.level>=14));
  }
  assert.deepEqual(result.stars,stars);assert.deepEqual(result.lab,[1,2,3,1]);
  await page.reload();await page.waitForFunction(()=>window.__mb);assert.deepEqual(await page.evaluate(()=>__mb.save.stars),stars);
  assert.deepEqual(errors,[]);
});

test('offline campaign uses its own shared modules even when an older lab cache was created first',async t=>{
  const{page,context,errors}=await open(t);
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.evaluate(async()=>{
    const name='match-busters-v16',own=await caches.open(name),requests=await own.keys();
    const entries=await Promise.all(requests.map(async req=>[req,await own.match(req)]));
    const lab=await caches.open('ice-lab-stale');
    await lab.put('/match-busters/render-2d.js',new Response('throw Error("Old lab renderer must not load")',{headers:{'Content-Type':'text/javascript'}}));
    await caches.delete(name);const fresh=await caches.open(name);
    for(const[req,res]of entries)await fresh.put(req,res);
  });
  await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.__mb);
  await page.evaluate(()=>__mb.startLevel(4));assert.equal(await page.evaluate(()=>__mb.G.iceTotal),6);
  assert.deepEqual(await page.evaluate(()=>__mb.save.stars),stars);
  assert.ok(await page.evaluate(async()=>(await caches.keys()).includes('ice-lab-stale')));
  assert.deepEqual(errors,[]);
});

test('icy campaign levels require both the original target and thawing, and award progress after a real final thaw',async t=>{
  const{page,errors}=await open(t);
  await page.evaluate(()=>{
    const m=__mb,g=m.G;m.startLevel(4);g.collected[4]=g.lv.count;m.checkEnd();
  });
  assert.equal(await page.evaluate(()=>__mb.goalMet()),false);assert.equal(await page.evaluate(()=>__mb.G.ended),false);
  assert.match(await page.locator('#objectives').textContent(),/Thaw all ice/);
  await page.evaluate(()=>{
    const m=__mb,g=m.G;
    g.grid=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>m.mk((r+c*2)%5,r,c)));
    g.ice=Array.from({length:8},()=>Array(8).fill(0));g.ice[3][3]=1;g.iceInitial=g.ice.map(row=>row.slice());g.thawed=5;g.iceTotal=6;g.iceVersion++;
    g.grid[2][2].t=g.grid[2][3].t=g.grid[1][4].t=1;g.grid[2][4].t=0;m.render(0);
  });
  await tap(page,1,4);await tap(page,2,4);await page.waitForFunction(()=>!__mb.G.busy);
  assert.equal(await page.evaluate(()=>__mb.G.ended),true);assert.equal(await page.evaluate(()=>__mb.goalMet()),true);
  await page.waitForFunction(()=>document.getElementById('scrResult').classList.contains('show'));
  assert.match(await page.locator('#resText').textContent(),/35\/35.*Ice thawed: 6\/6/);
  assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('matchbusters')).stars[4]>0));
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('matchbusters-ice-lab')).stars),[1,2,3,1]);
  const score=await page.evaluate(()=>{
    const m=__mb,g=m.G;m.startLevel(8);g.thawed=g.iceTotal;g.ice.forEach(row=>row.fill(0));g.iceVersion++;m.checkEnd();
    const waitsForScore=!g.ended&&!m.goalMet();g.score=g.lv.goal;m.checkEnd();
    return{waitsForScore,ended:g.ended,met:m.goalMet(),moves:g.moves};
  });
  assert.deepEqual(score,{waitsForScore:true,ended:true,met:true,moves:36});
  await page.evaluate(()=>{__mb.startLevel(0);__mb.G.score=__mb.G.lv.goal;__mb.checkEnd()});
  assert.equal(await page.evaluate(()=>__mb.G.ended),false); // Original score-only levels still use the full move budget.
  assert.deepEqual(errors,[]);
});

test('power-ups activate and combine on ordinary campaign levels without an ice objective',async t=>{
  const{page,errors}=await open(t);
  for(const[a,b,kind]of[['bomb','bomb','mega'],['line','line','cross'],['color','bomb','color-bomb'],['bomb',null,null]]){
    await page.evaluate(({a,b})=>{
      const m=__mb,g=m.G;m.startLevel(0);
      g.grid=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>m.mk((r+c)%5,r,c)));
      g.grid[3][3].sp=a;g.grid[3][4].sp=b;g.grid[3][3].dir='h';g.grid[3][4].dir='v';g.grid[3][3].t=0;g.grid[3][4].t=1;
    },{a,b});
    await move(page,{r:3,c:3},{r:3,c:4});
    assert.equal(await page.evaluate(()=>__mb.G.moves),19);assert.equal(await page.evaluate(()=>__mb.G.lastCombo),kind);
    assert.equal(await page.evaluate(()=>__mb.G.iceTotal),0);assert.ok(await page.evaluate(()=>__mb.G.score>0));
  }
  assert.deepEqual(errors,[]);
});

test('campaign frost grows while the collection target is already met, and its HUD resets on retry',async t=>{
  const{page,errors}=await open(t);
  await page.evaluate(()=>{
    const m=__mb,g=m.G;m.startLevel(12);g.collected[1]=g.lv.count;
    g.grid=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>m.mk((r+c*2)%5,r,c)));
    g.ice=Array.from({length:8},()=>Array(8).fill(0));g.ice[4][4]=2;g.ice[6][6]=1;
    g.iceInitial=g.ice.map(row=>row.slice());g.frost.ever=g.ice.map(row=>row.map(Boolean));g.iceTotal=2;g.thawed=0;g.iceVersion++;
  });
  for(let i=0;i<4;i++){
    await page.evaluate(()=>{__mb.G.grid[0][0].sp='bomb'});await move(page,{r:0,c:0},{r:0,c:0});
  }
  assert.deepEqual(await page.evaluate(()=>[__mb.G.iceTotal,__mb.G.frost.remaining,__mb.G.frost.quiet,__mb.G.ended]),[3,3,0,false]);
  assert.match(await page.locator('#iceProgress').textContent(),/0\/3/);
  await page.evaluate(()=>__mb.startLevel(12));
  assert.deepEqual(await page.evaluate(()=>[__mb.G.iceTotal,__mb.G.frost.remaining,__mb.G.frost.quiet]),[16,4,0]);
  await page.evaluate(()=>__mb.startLevel(2));assert.equal(await page.locator('#iceProgress').isVisible(),false);assert.equal(await page.locator('#iceWarning').isVisible(),false);
  assert.deepEqual(errors,[]);
});

test('campaign frost, both objectives, and growth warnings fit mobile portraits and landscapes in all graphics modes',{timeout:60000},async t=>{
  for(const[quality,layout,width,height,level]of[['fancy','tall',390,844,8],['extreme','wide',844,390,15]]){
    const{page,errors}=await open(t,{viewport:{width,height}}),shaderErrors=[];
    page.on('console',m=>{if(m.type()==='error'&&/Shader Error|VALIDATE_STATUS|GL_INVALID/i.test(m.text()))shaderErrors.push(m.text())});
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Board',{exact:true}).selectOption(layout);await page.getByLabel('Graphics',{exact:true}).selectOption(quality);
    await page.waitForFunction(q=>__mb.renderer.quality===q,quality);await page.evaluate(level=>__mb.startLevel(level),level);
    await page.waitForFunction(()=>__mb.G.grid.flat().every(p=>p.born===1));
    await page.evaluate(()=>{__mb.setPaused(true);__mb.show(null);__mb.render(0)});
    const board=await page.locator('#board').boundingBox(),hud=await page.locator('#hud').boundingBox();
    for(const box of[board,hud])assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,JSON.stringify(box));
    assert.equal(await page.locator('#iceProgress').isVisible(),true);assert.equal(await page.locator('#iceWarning').isVisible(),level===15);
    await page.screenshot({path:`/tmp/campaign-${quality}-${layout}.png`});
    await page.evaluate(()=>__mb.show('settings'));await page.getByLabel('Graphics',{exact:true}).selectOption('smooth');await page.waitForFunction(()=>__mb.renderer.quality==='smooth');
    assert.equal(await page.evaluate(()=>{__mb.render(0);const f=__mb.renderer.frames;for(let i=0;i<120;i++)__mb.render(i/60);return __mb.renderer.frames-f}),0);
    assert.deepEqual(shaderErrors,[]);assert.deepEqual(errors,[]);
  }
});


test('every goal stays visible on narrow portrait and short landscape screens',async t=>{
  for(const[width,height]of[[320,568],[568,320],[812,375]]){
    const{page,errors}=await open(t,{viewport:{width,height}});
    for(const level of[15,18,23]){
      await page.evaluate(level=>{__mb.save.boardLayout='auto';__mb.startLevel(level);for(const p of __mb.G.grid.flat())p.born=1;__mb.setPaused(true);__mb.show(null);__mb.render(0)},level);
      const result=await page.evaluate(()=>{
        const hud=document.getElementById('hud'),header=document.getElementById('hudTop').getBoundingClientRect(),goals=document.getElementById('objectives').getBoundingClientRect();
        const texts=['lvGoal','iceProgress','iceWarning','sGoal'].map(id=>{
          const el=document.getElementById(id),box=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);
          return{id,text:el.textContent,scrollWidth:el.scrollWidth,width:el.clientWidth,inside:[...range.getClientRects()].every(r=>r.left>=box.left-1&&r.right<=box.right+1&&r.top>=box.top-1&&r.bottom<=box.bottom+1)};
        });
        return{texts,goalBelowHeader:goals.top>=header.bottom,scroll:hud.scrollHeight,height:hud.clientHeight,pause:document.getElementById('pauseBtn').getBoundingClientRect().width,board:document.getElementById('board').getBoundingClientRect().width};
      });
      assert.ok(result.goalBelowHeader);assert.equal(result.pause,42);assert.ok(result.scroll<=result.height+1,JSON.stringify({width,height,level,result}));
      for(const text of result.texts){assert.ok(text.inside,JSON.stringify({width,height,level,text}));assert.ok(text.scrollWidth<=text.width+1,JSON.stringify(text))}
      assert.ok(result.board>140);
    }
    await page.screenshot({path:`/tmp/goals-${width}x${height}.png`});assert.deepEqual(errors,[]);
  }
});


test('new campaigns load random ice even alongside an older cached ice API',async t=>{
  const{page,errors}=await open(t,{serviceWorkers:'block'});
  await page.route('**/ice.js*',async route=>{
    if(new URL(route.request().url()).search){await route.continue();return}
    await route.fulfill({contentType:'text/javascript',body:"export * from './ice.js?current-art'; export function createIcePlan(){throw Error('Legacy generator must not be used')}"});
  });
  await page.reload();await page.waitForFunction(()=>window.__mb);
  await page.evaluate(()=>__mb.startLevel(23));assert.equal(await page.evaluate(()=>__mb.G.iceTotal),28);
  assert.equal(await page.evaluate(()=>__mb.G.grid.flat().filter(p=>p.sp).length),0);
  await page.goto(origin+prefix+'ice-lab/');await page.waitForFunction(()=>window.__mb);
  await page.evaluate(()=>__mb.startLevel(0));assert.equal(await page.evaluate(()=>__mb.G.iceTotal),6);
  assert.deepEqual(errors,[]);
});

for(const mode of ['fancy','extreme'])test(`${mode} ice stays visible through board resizing, retries, cracking, thawing, and growth`,{timeout:60000},async t=>{
  const{page,errors}=await open(t,{viewport:{width:1280,height:850},hasTouch:false});
  await page.evaluate(()=>__mb.show('settings'));
  await page.selectOption('#graphicsMode',mode);
  await page.waitForFunction(mode=>__mb.renderer.quality===mode,mode);
  const results=await page.evaluate(()=>{
    const m=__mb,g=m.G,engine=m.renderer.engine,results=[];
    function check(label){
      const gl=engine.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
      function pixels(){
        m.render(0);const data=new Uint8Array(w*h*4);
        gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;
      }
      const visible=pixels(),error=gl.getError(),thawed=g.thawed;
      // Hide only the ice pass: keep frozen pieces, lighting, and camera identical.
      g.thawed=g.iceTotal;const hidden=pixels();g.thawed=thawed;
      let frozen=0,missing=0,ghosts=0;
      for(let r=1;r<g.rows-1;r++)for(let c=1;c<g.cols-1;c++){
        const point=m.renderer.project(c,r),x=Math.round(point.x*w),y=Math.round((1-point.y)*h);let delta=0;
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)for(let ch=0;ch<3;ch++){
          const i=((y+dy)*w+x+dx)*4+ch;delta+=Math.abs(visible[i]-hidden[i]);
        }
        delta/=25;
        if(g.ice[r][c]){frozen++;if(delta<5)missing++;}
        else if(delta>5)ghosts++;
      }
      results.push({label,error,frozen,missing,ghosts,sameRenderer:m.renderer.engine===engine,textures:engine.info.memory.textures});
    }
    for(const layout of ['classic','wide','tall','wide','classic','classic']){
      m.save.boardLayout=layout;m.startLevel(23);m.setPaused(true);m.show(null);
      g.grid=Array.from({length:g.rows},(_,r)=>Array.from({length:g.cols},(_,c)=>m.mk((r+c)%5,r,c)));
      g.grid.flat().forEach(p=>{p.born=1;p.x=p.c;p.y=p.r});g.shake=0;
      g.ice=g.grid.map((row,r)=>row.map((_,c)=>r>0&&r<g.rows-1&&c>0&&c<g.cols-1&&(r+c)%2===0?2:0));
      g.iceInitial=g.ice.map(row=>row.slice());g.iceTotal=g.ice.flat().filter(Boolean).length;g.thawed=0;g.iceVersion++;
      check(layout+' thick');
      // Change the field without changing its dimensions, including newly grown thin ice.
      for(let r=1;r<g.rows-1;r++)for(let c=1;c<g.cols-1;c++){
        if(g.ice[r][c]){g.ice[r][c]=r%2?1:0;if(!g.ice[r][c])g.thawed++;}
      }
      g.ice[2][3]=g.iceInitial[2][3]=1;g.iceTotal++;g.iceVersion++;
      check(layout+' cracked/thawed/grown');
    }
    return results;
  });
  for(const result of results){
    assert.equal(result.error,0,JSON.stringify(result));assert.ok(result.frozen>0);
    assert.equal(result.missing,0,JSON.stringify(result));
    // Extreme's bloom deliberately spills light beyond the ice contour.
    if(mode==='fancy')assert.equal(result.ghosts,0,JSON.stringify(result));
    assert.ok(result.sameRenderer);assert.equal(result.textures,results[0].textures,'replaced ice textures must be disposed');
  }
  assert.deepEqual(errors,[]);
});
