import { BOARD_PADDING } from './board-layout.js';
import * as THREE from './vendor/three-0.160.0/build/three.module.js';
import { EffectComposer } from './vendor/three-0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three-0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three-0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three-0.160.0/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from './vendor/three-0.160.0/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from './vendor/three-0.160.0/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from './vendor/three-0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js';

export function create3DRenderer(cv, { G, SHAPES, extreme = false }) {
  const TAU = Math.PI * 2;
  let frames = 0, width = 400, height = 400;
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  // Keep Extreme's highlights bright without washing out the playable board.
  renderer.toneMapping = extreme ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = extreme ? 0.9 : 1;
  try {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#140a2e');
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    let cameraDistance = 14, rows = 0, cols = 0, midX = 3.5, midY = 3.5;
    const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(-3, 5, 8); scene.add(sun);
    scene.add(new THREE.AmbientLight(0x9988dd, 0.6));
    let composer = null, environmentTarget = null, prismPass = null;

    const board = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    board.position.z = -0.45; scene.add(board);
    function updateBoard() {
      if (rows === G.rows && cols === G.cols) return;
      rows = G.rows; cols = G.cols; midX = (cols - 1) / 2; midY = (rows - 1) / 2;
      const tile = 64, textureCanvas = document.createElement('canvas');
      textureCanvas.width = cols * tile; textureCanvas.height = rows * tile;
      const ctx = textureCanvas.getContext('2d');
      ctx.fillStyle = '#1a1035'; ctx.fillRect(0, 0, textureCanvas.width, textureCanvas.height);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#211541' : '#2a1c50'; ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(c * tile + 2, r * tile + 2, tile - 4, tile - 4, 9);
        else ctx.rect(c * tile + 2, r * tile + 2, tile - 4, tile - 4);
        ctx.fill();
      }
      const texture = new THREE.CanvasTexture(textureCanvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
      board.geometry.dispose(); if (board.material.map) board.material.map.dispose();
      board.geometry = new THREE.PlaneGeometry(cols, rows); board.material.map = texture; board.material.needsUpdate = true;
    }
    updateBoard();
    function canvasTex(draw) {
      const tc = document.createElement('canvas'); tc.width = tc.height = 128; draw(tc.getContext('2d'));
      const t = new THREE.CanvasTexture(tc); t.colorSpace = THREE.SRGBColorSpace; return t;
    }
    const dotTex = canvasTex(c => { const g = c.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, '#fff'); g.addColorStop(0.3, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); });
    const selTex = canvasTex(c => { c.strokeStyle = '#fff'; c.lineWidth = 9; c.fillStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.roundRect ? c.roundRect(8, 8, 112, 112, 22) : c.rect(8, 8, 112, 112); c.fill(); c.stroke(); });
    const additive = (color, map) => new THREE.MeshBasicMaterial({ color, map: map || null, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const PLANE = new THREE.PlaneGeometry(1, 1), RINGFX = new THREE.RingGeometry(0.72, 1, 48);
    const selMesh = new THREE.Mesh(PLANE, additive(0xffffff, selTex)); selMesh.position.z = -0.35; selMesh.visible = false; scene.add(selMesh);
    const flashMesh = new THREE.Mesh(PLANE, additive(0xffffff)); flashMesh.scale.set(12, 12, 1); flashMesh.position.z = 1; flashMesh.visible = false; scene.add(flashMesh);

    // piece geometry: one 3D model per shape
    function starGeo(bevelSegments = 4) {
      const s = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.19 : 0.41;
        s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
      }
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments });
      g.center(); return g;
    }
    const GEOS = [
      new THREE.SphereGeometry(0.37, 36, 24),
      new RoundedBoxGeometry(0.64, 0.64, 0.4, 5, 0.11),
      new THREE.TorusGeometry(0.26, 0.125, 20, 44),
      starGeo(),
      new THREE.OctahedronGeometry(0.46).scale(0.8, 1, 0.62),
    ];
    const BAR = new THREE.BoxGeometry(0.62, 0.07, 0.07), CONE = new THREE.ConeGeometry(0.1, 0.18, 14);
    const CORE = new THREE.SphereGeometry(0.17, 20, 14), SPARK = new THREE.SphereGeometry(0.055, 10, 8), HALO = new THREE.RingGeometry(0.4, 0.48, 40);
    const RAINBOW = new THREE.TorusGeometry(0.45, 0.04, 8, 60);
    {
      const pos = RAINBOW.attributes.position, cols = new Float32Array(pos.count * 3), col = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const h = (Math.atan2(pos.getY(i), pos.getX(i)) / TAU + 1) % 1;
        col.setHSL(h, 1, 0.6).multiplyScalar(1.8); cols.set([col.r, col.g, col.b], i * 3);
      }
      RAINBOW.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    }
    // Line-clear arrows must stay readable without becoming a bloom light source.
    const WHITE = new THREE.MeshBasicMaterial({ color: extreme ? new THREE.Color('#f4efff') : new THREE.Color(2, 2, 2) });
    const BLACK = new THREE.MeshStandardMaterial({ color: 0x120820, roughness: 0.2, metalness: 0.6 });
    const GOLD = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 0.5) });
    const HALOMAT = additive(0xffb347);
    const RAINBOWMAT = new THREE.MeshBasicMaterial({ vertexColors: true });

    const pieceGroup = new THREE.Group(), fxGroup = new THREE.Group(); scene.add(pieceGroup, fxGroup);
    let liveMeshes = new Set(), liveFx = new Set();
    function buildMesh(p) {
      const g = new THREE.Group(), color = new THREE.Color(SHAPES[p.t].color);
      const base = { color, emissive: color, emissiveIntensity: 0.16, flatShading: p.t === 4 };
      const mat = new THREE.MeshStandardMaterial({ ...base, metalness: 0.3, roughness: p.t === 0 || p.t === 2 ? 0.28 : 0.5, envMapIntensity: 0.55 });
      const main = new THREE.Mesh(GEOS[p.t], mat); g.add(main);
      const extra = new THREE.Group(); g.add(extra);
      if (p.sp === 'line') {
        const bar = new THREE.Mesh(BAR, WHITE), a = new THREE.Mesh(CONE, WHITE), b = new THREE.Mesh(CONE, WHITE);
        a.position.x = 0.4; a.rotation.z = -Math.PI / 2; b.position.x = -0.4; b.rotation.z = Math.PI / 2;
        extra.add(bar, a, b); extra.position.z = 0.34;
        if (p.dir === 'v') extra.rotation.z = Math.PI / 2;
      } else if (p.sp === 'bomb') {
        const core = new THREE.Mesh(CORE, BLACK), spark = new THREE.Mesh(SPARK, GOLD), halo = new THREE.Mesh(HALO, HALOMAT);
        core.position.z = 0.3; spark.position.set(0.1, 0.13, 0.42); halo.position.z = -0.2; halo.name = 'halo';
        extra.add(core, spark, halo);
      } else if (p.sp === 'color') {
        const ring = new THREE.Mesh(RAINBOW, RAINBOWMAT); ring.name = 'ring'; extra.add(ring);
      }
      g.userData = { main, mat, extra, phase: Math.random() * TAU };
      pieceGroup.add(g);
      return g;
    }

    // particles
    const PMAX = 2000;
    const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: extreme ? 0.34 : 0.26, map: dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    points.frustumCulled = false; scene.add(points);

    const isCell = (cell, p) => cell && cell.r === p.r && cell.c === p.c;
    function sync(time) {
      const seen = new Set(), pulse = 0.5 + 0.5 * Math.sin(time * 5);
      if (G.grid) {
        for (const row of G.grid) for (const p of row) {
          if (!p) continue;
          const g = p.mesh || (p.mesh = buildMesh(p)), u = g.userData;
          seen.add(g);
          const b = p.born - 1;
          let sc = p.born < 1 ? 0.2 + 0.8 * (1 + 2.7 * b * b * b + 1.7 * b * b) : 1, z = 0;
          const selected = isCell(G.sel, p);
          if (selected) { sc *= 1.18 + 0.05 * Math.sin(time * 9); z = 0.5; }
          else if (G.hint && (isCell(G.hint[0], p) || isCell(G.hint[1], p))) sc *= 1 + 0.1 * Math.sin(time * 8);
          if (p.sp) sc *= 1 + 0.04 * pulse;
          g.position.set(p.x - midX, midY - p.y, z);
          g.scale.setScalar(sc);
          const m = u.main;
          if (p.t === 4) m.rotation.y = time * (selected ? 5 : 1.3) + u.phase;
          else m.rotation.y = selected ? time * 5 : Math.sin(time * 1.4 + u.phase) * 0.4;
          m.rotation.x = Math.sin(time * 1.1 + u.phase * 2) * 0.2;
          if (p.t === 3) m.rotation.z = Math.sin(time * 0.9 + u.phase) * 0.15;
          u.mat.emissiveIntensity = extreme
            ? p.sp ? 0.25 + 0.1 * pulse : selected ? 0.45 : 0.2
            : p.sp ? 0.4 + 0.35 * pulse : selected ? 0.5 : 0.16;
          if (p.sp === 'color') u.extra.rotation.z = time * 2.5;
          else if (p.sp === 'bomb') u.extra.getObjectByName('halo').scale.setScalar(1 + 0.12 * pulse);
        }
        for (const d of G.dying) {
          const p = d.p, g = p.mesh || (p.mesh = buildMesh(p)), u = g.userData, k = 1 - d.life;
          seen.add(g);
          g.position.set(p.x - midX, midY - p.y, 0.2 + k);
          g.scale.setScalar(k < 0.3 ? 1 + k * 1.2 : Math.max(0.001, 1.36 * (d.life / 0.7)));
          u.main.rotation.z += 0.25; u.main.rotation.y += 0.2;
          u.mat.emissive.set(0xffffff); u.mat.emissiveIntensity = 0.3 + k * 1.6;
          u.extra.visible = false;
        }
      }
      for (const m of liveMeshes) if (!seen.has(m)) { pieceGroup.remove(m); m.userData.mat.dispose(); }
      liveMeshes = seen;

      const fx = new Set();
      for (const b of G.beams) {
        const m = b.mesh || (b.mesh = fxGroup.add(new THREE.Mesh(PLANE, additive(b.color))) && fxGroup.children[fxGroup.children.length - 1]);
        fx.add(m);
        const w = 0.15 + 0.9 * b.life;
        if (b.dir === 'h') { m.position.set(0, midY - b.r, 0.7); m.scale.set(cols + 4, w, 1); } else { m.position.set(b.c - midX, 0, 0.7); m.scale.set(w, rows + 4, 1); }
        m.material.opacity = b.life; m.material.color.set(b.color).multiplyScalar(1.5);
      }
      for (const b of G.blasts) {
        const m = b.mesh || (b.mesh = fxGroup.add(new THREE.Mesh(RINGFX, additive(b.color))) && fxGroup.children[fxGroup.children.length - 1]);
        fx.add(m);
        m.position.set(b.c - midX, midY - b.r, 0.6);
        m.scale.setScalar(b.size * (0.2 + 0.8 * (1 - b.life * b.life)));
        m.material.opacity = b.life;
      }
      for (const m of liveFx) if (!fx.has(m)) { fxGroup.remove(m); m.material.dispose(); }
      liveFx = fx;

      selMesh.visible = !!G.sel;
      if (G.sel) { selMesh.position.x = G.sel.c - midX; selMesh.position.y = midY - G.sel.r; selMesh.material.opacity = 0.6 + 0.4 * pulse; }
      flashMesh.visible = G.flash > 0;
      if (G.flash > 0) { flashMesh.material.color.set(G.flashColor); flashMesh.material.opacity = G.flash * 0.55; }

      const n = Math.min(G.parts.length, PMAX);
      for (let i = 0; i < n; i++) {
        const q = G.parts[i], f = Math.max(0, q.life) * 1.6;
        pPos[i * 3] = q.x; pPos[i * 3 + 1] = q.y; pPos[i * 3 + 2] = q.z;
        pCol[i * 3] = q.r * f; pCol[i * 3 + 1] = q.g * f; pCol[i * 3 + 2] = q.b * f;
      }
      points.visible = n > 0;
      pGeo.setDrawRange(0, n);
      if (n) { pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true; }

      const sh = G.shake * (extreme ? 0.3 : 0.18);
      camera.position.set(Math.sin(time * 0.35) * 0.45 + (Math.random() - 0.5) * sh, Math.cos(time * 0.28) * 0.3 + (Math.random() - 0.5) * sh, cameraDistance);
      camera.lookAt(0, 0, 0);
    }
    function render(time) {
      frames++;
      if (prismPass) prismPass.uniforms.time.value = time;
      sync(time);
      if (composer) composer.render();
      else renderer.render(scene, camera);
    }

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), zPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
    function cellAt(e) {
      const b = cv.getBoundingClientRect();
      ndc.set((e.clientX - b.left) / b.width * 2 - 1, 1 - (e.clientY - b.top) / b.height * 2);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(zPlane, hit)) return null;
      const c = Math.floor(hit.x + cols / 2), r = Math.floor(rows / 2 - hit.y);
      return r >= 0 && c >= 0 && r < rows && c < cols ? { r, c } : null;
    }

    const v3 = new THREE.Vector3();
    function project(col, row) {
      v3.set(col - midX, midY - row, 0.5).project(camera);
      return { x: (v3.x + 1) / 2, y: (1 - v3.y) / 2 };
    }
    const room = new RoomEnvironment(), generator = new THREE.PMREMGenerator(renderer);
    environmentTarget = generator.fromScene(room, 0.04);
    scene.environment = environmentTarget.texture;
    generator.dispose(); room.dispose();
    const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), extreme ? 1.05 : 0.6, extreme ? 0.55 : 0.5, extreme ? 1.25 : 1.0);
    composer.addPass(bloom);
    if (extreme) {
      prismPass = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
        vertexShader: `varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
          void main() {
            vec2 fringe = (vUv - 0.5) * (0.008 + 0.003 * sin(time * 1.5));
            vec3 color = vec3(texture2D(tDiffuse, vUv + fringe).r,
                              texture2D(tDiffuse, vUv).g,
                              texture2D(tDiffuse, vUv - fringe).b);
            float vignette = 1.0 - 0.18 * smoothstep(0.25, 0.75, length(vUv - 0.5));
            gl_FragColor = vec4(color * vignette * (1.0 + 0.035 * sin(time * 2.0)), 1.0);
          }`,
      });
      composer.addPass(prismPass);
    }
    composer.addPass(new OutputPass());
    return {
      kind: 'webgl', quality: extreme ? 'extreme' : 'fancy', engine: renderer,
      get frames() { return frames; },
      render, project, cellAt,
      resize(pxWidth, pxHeight, ratio) {
        width = pxWidth; height = pxHeight; updateBoard();
        camera.aspect = width / height;
        cameraDistance = Math.max(rows + BOARD_PADDING, (cols + BOARD_PADDING) / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(17.5)));
        camera.far = cameraDistance + 100; camera.updateProjectionMatrix();
        flashMesh.scale.set(cols + 4, rows + 4, 1);
        renderer.setPixelRatio(ratio); renderer.setSize(width, height, false);
        composer.setPixelRatio(ratio); composer.setSize(width, height);
      },
      dispose() {
        composer.passes.forEach(pass => pass.dispose()); composer.dispose();
        environmentTarget.dispose();
        const resources = new Set([...GEOS, BAR, CONE, CORE, SPARK, HALO, RAINBOW, PLANE, RINGFX, dotTex, selTex]);
        scene.traverse(obj => {
          if (obj.geometry) resources.add(obj.geometry);
          if (obj.material) {
            resources.add(obj.material);
            for (const value of Object.values(obj.material)) if (value && value.isTexture) resources.add(value);
          }
        });
        resources.forEach(resource => resource.dispose());
        if (G.grid) for (const row of G.grid) for (const p of row) if (p) p.mesh = null;
        for (const d of G.dying) d.p.mesh = null;
        for (const effect of [...G.beams, ...G.blasts]) effect.mesh = null;
        renderer.dispose(); renderer.forceContextLoss();
      },
    };
  } catch (error) {
    renderer.dispose(); renderer.forceContextLoss();
    throw error;
  }
}
