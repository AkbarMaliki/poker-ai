/* Poker 3D — scene Three.js: meja, kartu, chip, avatar, nameplate, animasi. */
window.Scene3D = (() => {
  'use strict';
  const E = window.PokerEngine;
  const L = 2.3, R = 2.0, RAIL = 0.42;          // meja stadium: panjang lurus setengah, radius
  const SLOT_DEG = [90, 148, 212, 270, 328, 32]; // slot 0 = bawah (pemain sendiri), searah jarum jam
  const DECK = new THREE.Vector3(2.05, 0.05, -0.3);
  const POT = new THREE.Vector3(0, 0, 0.5);
  const DENOMS = [[5000, '#1f5fbf'], [1000, '#e0a526'], [500, '#6a2aa0'], [100, '#1b1b1f'], [25, '#23874a'], [5, '#c3262e'], [1, '#e9e6de']];

  let renderer, scene, camera, controls, platesEl, nowFn = () => Date.now();
  let root, dealerBtn, turnRing, cardGeo, chipGeo, edgeMat, backMat, backTex, maxAniso = 1;
  let view = null, mySeat = -1, viewSeat = 0, clockT = 0;
  const cards = new Map(), chips = new Map(), avatars = new Array(6).fill(null), plates = [], tweens = [];
  const texCache = new Map(), chipMats = {};

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const slotOf = i => (i - viewSeat + 6) % 6;
  const angOf = i => SLOT_DEG[slotOf(i)] * Math.PI / 180;
  function seatXZ(i, k, side) {
    const a = angOf(i);
    const p = V(Math.cos(a) * (L + R) * k, 0, Math.sin(a) * R * k);
    if (side) { p.x += Math.sin(a) * side; p.z -= Math.cos(a) * side; }
    return p;
  }
  /** Posisi avatar: tepi felt ke arah kursi, lalu didorong keluar melewati rail. */
  function avatarXZ(i) {
    const p = seatXZ(i, 1), d = Math.hypot(p.x, p.z);
    return V(p.x + (p.x / d) * 0.8, 0, p.z + (p.z / d) * 0.8);
  }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(cv) {
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding; t.anisotropy = maxAniso;
    return t;
  }
  function rr(x, px, py, w, h, r) {
    x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
  }

  // ---------- tekstur ----------
  const SUIT_TXT = ['♠︎', '♥︎', '♦︎', '♣︎'];
  function cardTex(c) {
    if (texCache.has(c)) return texCache.get(c);
    const W = 256, H = 366, cv = canvas(W, H), x = cv.getContext('2d');
    rr(x, 3, 3, W - 6, H - 6, 24); x.fillStyle = '#fdfcf6'; x.fill(); x.lineWidth = 3; x.strokeStyle = '#cbc3b0'; x.stroke();
    const r = c >> 2, s = c & 3, col = s === 1 || s === 2 ? '#c8102e' : '#16181d';
    const rs = E.RANK_NAME[r], ss = SUIT_TXT[s];
    x.fillStyle = col; x.textAlign = 'center'; x.textBaseline = 'middle';
    const corner = () => {
      x.font = `bold ${rs.length > 1 ? 60 : 72}px Georgia, 'Times New Roman', serif`; x.fillText(rs, 46, 54);
      x.font = '54px "Segoe UI Symbol", "DejaVu Sans", serif'; x.fillText(ss, 46, 114);
    };
    corner();
    x.save(); x.translate(W, H); x.rotate(Math.PI); corner(); x.restore();
    if (r >= 9 && r <= 11) {
      rr(x, 78, 86, 100, 194, 12); x.fillStyle = s === 1 || s === 2 ? '#fbe6e6' : '#e6e9f2'; x.fill();
      x.lineWidth = 4; x.strokeStyle = col; x.stroke();
      x.fillStyle = col; x.font = 'bold 96px Georgia, serif'; x.fillText(rs, 128, 160);
      x.font = '56px "Segoe UI Symbol", serif'; x.fillText(ss, 128, 238);
    } else {
      x.font = `${r === 12 ? 190 : 150}px "Segoe UI Symbol", "DejaVu Sans", serif`; x.fillText(ss, 128, 192);
    }
    const t = tex(cv); texCache.set(c, t);
    return t;
  }
  function makeBackTex() {
    const W = 256, H = 366, cv = canvas(W, H), x = cv.getContext('2d');
    rr(x, 3, 3, W - 6, H - 6, 24); x.fillStyle = '#fdfcf6'; x.fill();
    rr(x, 16, 16, W - 32, H - 32, 16); x.fillStyle = '#8f1d2c'; x.fill();
    x.save(); rr(x, 16, 16, W - 32, H - 32, 16); x.clip();
    x.strokeStyle = 'rgba(255,215,160,0.35)'; x.lineWidth = 3;
    for (let k = -H; k < W + H; k += 22) {
      x.beginPath(); x.moveTo(k, 0); x.lineTo(k + H, H); x.stroke();
      x.beginPath(); x.moveTo(k, H); x.lineTo(k + H, 0); x.stroke();
    }
    x.restore();
    x.strokeStyle = '#f2d39b'; x.lineWidth = 4; rr(x, 26, 26, W - 52, H - 52, 12); x.stroke();
    x.fillStyle = '#f2d39b'; x.font = 'bold 64px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.beginPath(); x.arc(W / 2, H / 2, 52, 0, Math.PI * 2); x.fillStyle = '#8f1d2c'; x.fill(); x.stroke();
    x.fillStyle = '#f2d39b'; x.font = '60px "Segoe UI Symbol", serif'; x.fillText('♠︎', W / 2, H / 2 + 4);
    return tex(cv);
  }
  function feltTex() {
    const W = 2048, H = Math.round(W * (R + 0.02) / (L + R + 0.02)), cv = canvas(W, H), x = cv.getContext('2d');
    const toPx = (wx, wz) => [((wx + L + R + 0.02) / (2 * (L + R + 0.02))) * W, ((wz + R + 0.02) / (2 * (R + 0.02))) * H];
    const g = x.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.55);
    g.addColorStop(0, '#17804a'); g.addColorStop(0.7, '#0e6338'); g.addColorStop(1, '#0a4a2a');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const img = x.getImageData(0, 0, W, H), d = img.data;
    for (let k = 0; k < d.length; k += 4) { const n = (Math.random() - 0.5) * 14; d[k] += n; d[k + 1] += n; d[k + 2] += n; }
    x.putImageData(img, 0, 0);
    // garis dalam
    const ppu = W / (2 * (L + R + 0.02));
    x.strokeStyle = 'rgba(232,200,120,0.45)'; x.lineWidth = 5;
    const inset = R - 0.45, [cx, cy] = toPx(0, 0);
    x.beginPath();
    x.arc(cx - L * ppu, cy, inset * ppu, Math.PI / 2, Math.PI * 1.5);
    x.arc(cx + L * ppu, cy, inset * ppu, -Math.PI / 2, Math.PI / 2);
    x.closePath(); x.stroke();
    // kotak kartu board
    x.strokeStyle = 'rgba(255,255,255,0.14)'; x.lineWidth = 4;
    for (let k = 0; k < 5; k++) {
      const [px, py] = toPx((k - 2) * 0.66 - 0.29, -0.3 - 0.41);
      rr(x, px, py, 0.58 * ppu, 0.82 * ppu, 14); x.stroke();
    }
    x.fillStyle = 'rgba(240,215,150,0.16)'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `bold ${Math.round(0.26 * ppu)}px Georgia, serif`;
    const [tx, ty] = toPx(0, 1.02); x.fillText('POKER 3D', tx, ty);
    x.font = `${Math.round(0.13 * ppu)}px Georgia, serif`;
    const [ux, uy] = toPx(0, -1.12); x.fillText("TEXAS HOLD'EM · NO LIMIT", ux, uy);
    return tex(cv);
  }
  function chipTex(color) {
    const S = 128, cv = canvas(S, S), x = cv.getContext('2d');
    x.fillStyle = color; x.fillRect(0, 0, S, S);
    x.fillStyle = '#ffffff';
    for (let k = 0; k < 8; k++) {
      x.save(); x.translate(S / 2, S / 2); x.rotate(k * Math.PI / 4);
      x.fillRect(-7, -S / 2, 14, 18); x.restore();
    }
    x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 4;
    x.beginPath(); x.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2); x.stroke();
    return tex(cv);
  }
  function chipSideTex(color) {
    const cv = canvas(128, 16), x = cv.getContext('2d');
    x.fillStyle = color; x.fillRect(0, 0, 128, 16);
    x.fillStyle = '#fff';
    for (let k = 0; k < 8; k++) x.fillRect(k * 16 + 4, 0, 8, 16);
    return tex(cv);
  }
  function labelTex(text, bg, fg) {
    const cv = canvas(128, 128), x = cv.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 128, 128);
    x.fillStyle = fg; x.font = 'bold 72px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 64, 68);
    return tex(cv);
  }

  // ---------- bangun scene ----------
  function stadium(l, r, Cls) {
    const s = new (Cls || THREE.Shape)();
    s.moveTo(-l, -r); s.lineTo(l, -r);
    s.absarc(l, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(-l, r);
    s.absarc(-l, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    return s;
  }

  function buildRoom() {
    scene.add(new THREE.HemisphereLight(0xc8d8ff, 0x2a1a10, 0.55));
    const spot = new THREE.SpotLight(0xfff0d8, 1.5, 22, 0.8, 0.55, 1.1);
    spot.position.set(0, 8, 0.6); spot.target.position.set(0, 0, 0);
    spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.0004;
    spot.shadow.camera.near = 3; spot.shadow.camera.far = 14;
    scene.add(spot, spot.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(0, 5, 9); scene.add(fill);
    const rim = new THREE.PointLight(0x5a7dff, 0.5, 18); rim.position.set(-6, 3, -6); scene.add(rim);
    const rim2 = new THREE.PointLight(0xff8a4a, 0.35, 18); rim2.position.set(6, 3, -5); scene.add(rim2);

    // lantai karpet
    const cv = canvas(512, 512), x = cv.getContext('2d');
    x.fillStyle = '#2a0f14'; x.fillRect(0, 0, 512, 512);
    x.strokeStyle = 'rgba(200,150,80,0.12)'; x.lineWidth = 3;
    for (let k = 0; k <= 512; k += 64) {
      x.beginPath(); x.moveTo(k, 0); x.lineTo(512, 512 - k); x.stroke();
      x.beginPath(); x.moveTo(0, k); x.lineTo(512 - k, 512); x.stroke();
      x.beginPath(); x.moveTo(k, 0); x.lineTo(0, k); x.stroke();
      x.beginPath(); x.moveTo(512, k); x.lineTo(k, 512); x.stroke();
    }
    const ft = tex(cv); ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(14, 14);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: ft, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.45; floor.receiveShadow = true;
    scene.add(floor);
  }

  function buildTable() {
    const fg = new THREE.ShapeGeometry(stadium(L, R + 0.02), 64);
    const pos = fg.attributes.position, uv = fg.attributes.uv, Rf = R + 0.02;
    for (let k = 0; k < pos.count; k++) uv.setXY(k, (pos.getX(k) + L + Rf) / (2 * (L + Rf)), (pos.getY(k) + Rf) / (2 * Rf));
    fg.rotateX(-Math.PI / 2);
    const felt = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: feltTex(), roughness: 0.95 }));
    felt.receiveShadow = true;
    scene.add(felt);

    const rs = stadium(L, R + RAIL); rs.holes.push(stadium(L, R, THREE.Path));
    const rg = new THREE.ExtrudeGeometry(rs, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 6, curveSegments: 64 });
    rg.rotateX(-Math.PI / 2);
    const rail = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x241510, roughness: 0.42, metalness: 0.05 }));
    rail.position.y = 0.02; rail.castShadow = true; rail.receiveShadow = true;
    scene.add(rail);

    const ag = new THREE.ExtrudeGeometry(stadium(L, R + RAIL + 0.08), { depth: 0.3, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 64 });
    ag.rotateX(-Math.PI / 2);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b3a1c, roughness: 0.5, metalness: 0.1 });
    const apron = new THREE.Mesh(ag, wood); apron.position.y = -0.4; apron.castShadow = true;
    scene.add(apron);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 1.05, 48), wood);
    ped.scale.x = 2.2; ped.position.y = -0.95; ped.castShadow = true;
    scene.add(ped);

    // dek kartu kecil
    const deck = new THREE.Group();
    for (let k = 0; k < 8; k++) {
      const m = new THREE.Mesh(cardGeo, [edgeMat, edgeMat, backMat, backMat, edgeMat, edgeMat]);
      m.position.y = k * 0.009; m.rotation.y = (Math.random() - 0.5) * 0.04; m.castShadow = true;
      deck.add(m);
    }
    deck.position.copy(DECK).setY(0.005); deck.rotation.y = 0.15;
    scene.add(deck);
  }

  function init(cv, opts) {
    opts = opts || {};
    nowFn = opts.now || nowFn;
    platesEl = opts.plates;
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    maxAniso = renderer.capabilities.getMaxAnisotropy();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06080c);
    scene.fog = new THREE.Fog(0x06080c, 16, 34);
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(0, 6.3, 7.2);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0.35);
    controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.2;
    controls.minAzimuthAngle = -0.9; controls.maxAzimuthAngle = 0.9;

    cardGeo = new THREE.BoxGeometry(0.56, 0.008, 0.8);
    chipGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.034, 28);
    edgeMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 });
    backTex = makeBackTex();
    backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.55, alphaTest: 0.5 });
    DENOMS.forEach(([d, col]) => {
      const side = new THREE.MeshStandardMaterial({ map: chipSideTex(col), roughness: 0.45 });
      const top = new THREE.MeshStandardMaterial({ map: chipTex(col), roughness: 0.4 });
      chipMats[d] = [side, top, top];
    });

    buildRoom();
    buildTable();
    root = new THREE.Group(); scene.add(root);

    dealerBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 32), [
      new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ map: labelTex('D', '#f4f1e8', '#1a1a1a'), roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0xf4f1e8 }),
    ]);
    dealerBtn.castShadow = true; dealerBtn.visible = false; dealerBtn.position.y = 0.02; dealerBtn.rotation.y = Math.PI / 2;
    scene.add(dealerBtn);

    turnRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 64),
      new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    turnRing.rotation.x = -Math.PI / 2; turnRing.position.y = 0.006; turnRing.visible = false;
    scene.add(turnRing);

    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      el.className = 'plate'; el.hidden = true;
      el.innerHTML = '<div class="pn"></div><div class="ps"></div><div class="pa"></div><div class="pt"><i></i></div>';
      platesEl.appendChild(el);
      plates.push({ el, n: el.children[0], s: el.children[1], a: el.children[2], bar: el.children[3].firstChild, key: '' });
    }

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);
  }

  let lastPortrait = null;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const portrait = camera.aspect < 0.85;
    const d = Math.min(24, Math.max(8.4, (portrait ? 4.9 : 5.6) / Math.tan(hf / 2), 3.4 / Math.tan(vf / 2)));
    if (portrait !== lastPortrait) {
      // portrait: kamera lebih dari atas & meja digeser ke atas agar tidak tertutup panel aksi
      lastPortrait = portrait;
      controls.target.set(0, 0, portrait ? 1.9 : 0.35);
      camera.position.copy(controls.target).add(portrait ? V(0, 0.93, 0.37) : V(0, 6.3, 6.85).normalize());
    }
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, d);
    controls.minDistance = d * 0.55; controls.maxDistance = d * 1.5;
    camera.updateProjectionMatrix();
  }

  // ---------- tween ----------
  function tween(obj, to, dur, delay, opt) {
    opt = opt || {};
    const ch = opt.ch || 'pose';
    for (const t of tweens) if (t.obj === obj && t.ch === ch) t.dead = true;
    tweens.push({ obj, to, dur: Math.max(0.01, dur), start: clockT + (delay || 0), from: null, arc: opt.arc || 0, done: opt.done, ch });
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  function stepTweens() {
    for (let k = tweens.length - 1; k >= 0; k--) {
      const tw = tweens[k];
      if (tw.dead) { tweens.splice(k, 1); continue; }
      if (clockT < tw.start) continue;
      const o = tw.obj;
      if (!tw.from) tw.from = { pos: o.position.clone(), rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z, s: o.scale.x };
      const p = Math.min(1, (clockT - tw.start) / tw.dur);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const t = tw.to, f = tw.from;
      if (t.pos) { o.position.lerpVectors(f.pos, t.pos, e); if (tw.arc) o.position.y += Math.sin(Math.PI * p) * tw.arc; }
      if (t.py !== undefined) o.position.y = lerp(f.pos.y, t.py, e);
      if (t.rx !== undefined) o.rotation.x = lerp(f.rx, t.rx, e);
      if (t.ry !== undefined) o.rotation.y = lerp(f.ry, t.ry, e);
      if (t.rz !== undefined) o.rotation.z = lerp(f.rz, t.rz, e);
      if (t.s !== undefined) o.scale.setScalar(lerp(f.s, t.s, e));
      if (p >= 1) { tweens.splice(k, 1); if (tw.done) tw.done(); }
    }
  }

  // ---------- kartu ----------
  function makeCard() {
    const top = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.5, alphaTest: 0.5 });
    const mesh = new THREE.Mesh(cardGeo, [edgeMat, edgeMat, top, backMat, edgeMat, edgeMat]);
    mesh.castShadow = true;
    const group = new THREE.Group(); group.add(mesh);
    return { group, mesh, top, c: -1, poseKey: '' };
  }
  function setFace(o, c) {
    o.c = c;
    o.top.map = c >= 0 ? cardTex(c) : backTex;
    o.top.needsUpdate = true;
  }
  function flip(o, c, delay) {
    o.c = c;
    tween(o.mesh, { rz: Math.PI / 2, py: 0.14 }, 0.13, delay, {
      ch: 'flip',
      done: () => { setFace(o, c); tween(o.mesh, { rz: 0, py: 0 }, 0.13, 0, { ch: 'flip' }); },
    });
  }
  function holePose(i, k, mine) {
    if (mine) {
      const b = seatXZ(i, 0.68);
      return { pos: V(b.x + (k ? 0.37 : -0.37), 0.34, b.z), rx: 0.55, ry: k ? -0.07 : 0.07, s: 1.3 };
    }
    const b = seatXZ(i, 0.74);
    return { pos: V(b.x + (k ? 0.17 : -0.17), 0.012 + k * 0.01, b.z), rx: 0, ry: k ? -0.12 : 0.12, s: 0.92 };
  }
  const boardPose = k => ({ pos: V((k - 2) * 0.66, 0.012, -0.3), rx: 0, ry: 0, s: 1 });
  const poseKey = p => [p.pos.x, p.pos.y, p.pos.z, p.rx, p.ry, p.s].map(n => n.toFixed(3)).join();

  function removeCard(key, o, target) {
    cards.delete(key);
    tween(o.group, { pos: target, s: 0.5 }, 0.35, 0, { done: () => { root.remove(o.group); o.top.dispose(); } });
  }

  function syncCards(v) {
    const want = new Map();
    const inHand = v.seats.map(s => !!(s && s.inHand));
    const n = inHand.filter(Boolean).length;
    const order = {};
    if (v.sbSeat >= 0) { let c = 0; for (let k = 0; k < 6; k++) { const i = (v.sbSeat + k) % 6; if (inHand[i]) order[i] = c++; } }
    const best = new Set();
    if (v.phase === 'showdown' && v.results) v.results.forEach(r => (r.best || []).forEach(c => best.add(c)));
    const winners = new Set();
    if (v.phase === 'showdown' && v.results) v.results.forEach(r => { if (!r.ret) r.winners.forEach(w => winners.add(w)); });

    v.seats.forEach((s, i) => {
      if (!s || !s.cards || !s.inHand) return;
      const mine = i === mySeat;
      if (s.folded && !mine) return;
      s.cards.forEach((c, k) => {
        const face = (mine || s.shown) && c >= 0 ? c : -1;
        const pose = holePose(i, k, mine);
        const w = best.size && winners.has(i) && best.has(c);
        if (w) pose.pos.y += mine ? 0.12 : 0.1;
        if (mine && s.folded) { pose.pos.y = 0.02; pose.rx = 0; pose.pos.z -= 0.2; }
        want.set(`h${v.hand}-${i}-${k}`, { c: face, pose, delay: (k * n + (order[i] || 0)) * 0.1, dim: s.folded, win: w });
      });
    });
    (v.board || []).forEach((c, k) => {
      const pose = boardPose(k);
      const w = best.has(c);
      if (w) pose.pos.y += 0.1;
      want.set(`b${v.hand}-${k}`, { c, pose, delay: k < 3 && v.board.length === 3 ? k * 0.16 : 0.05, win: w, dim: false });
    });

    for (const [key, o] of [...cards]) {
      if (want.has(key)) continue;
      const newHand = !key.startsWith(`h${v.hand}-`) && !key.startsWith(`b${v.hand}-`);
      removeCard(key, o, newHand ? DECK.clone().setY(0.1) : POT.clone().setY(0.05));
    }
    for (const [key, w] of want) {
      let o = cards.get(key);
      if (!o) {
        o = makeCard(); cards.set(key, o); root.add(o.group);
        o.group.position.copy(DECK).setY(0.1); o.group.scale.setScalar(0.9); o.group.rotation.set(0, 0.15, 0);
        setFace(o, -1);
        o.poseKey = poseKey(w.pose);
        const target = w.c;
        tween(o.group, w.pose, 0.42, w.delay, { arc: 0.35, done: () => { if (target >= 0 && o.c !== target) flip(o, target, 0.02); } });
        o.pending = target;
      } else {
        const pk = poseKey(w.pose);
        if (pk !== o.poseKey) { o.poseKey = pk; tween(o.group, w.pose, 0.3, 0); }
        if (w.c !== o.pending) { o.pending = w.c; flip(o, w.c, 0); }
      }
      o.top.emissive.setHex(w.win ? 0x6b4a00 : 0x000000);
      o.top.color.setScalar(w.dim ? 0.45 : 1);
    }
  }

  // ---------- chip ----------
  function chipGroup(amount) {
    const g = new THREE.Group();
    let rest = Math.round(amount);
    const cols = [];
    for (const [d] of DENOMS) {
      let n = Math.floor(rest / d); rest -= n * d;
      while (n > 0 && cols.length < 7) { const h = Math.min(n, 10); cols.push([d, h]); n -= h; }
    }
    const spots = [[0, 0], [0.25, 0], [0.125, 0.217], [-0.125, 0.217], [-0.25, 0], [-0.125, -0.217], [0.125, -0.217]];
    cols.forEach(([d, h], ci) => {
      for (let k = 0; k < h; k++) {
        const m = new THREE.Mesh(chipGeo, chipMats[d]);
        m.position.set(spots[ci][0] + (Math.random() - 0.5) * 0.012, 0.017 + k * 0.035, spots[ci][1] + (Math.random() - 0.5) * 0.012);
        m.rotation.y = Math.random() * 6;
        m.castShadow = true;
        g.add(m);
      }
    });
    return g;
  }
  const stackPos = i => seatXZ(i, 0.8, i === mySeat ? 1.4 : 0.85);
  const betPos = i => seatXZ(i, i === mySeat ? 0.5 : 0.48, 0.3);

  function syncChips(v) {
    const want = new Map();
    v.seats.forEach((s, i) => {
      if (!s) return;
      if (s.stack > 0) want.set('s' + i, { amt: s.stack, pos: stackPos(i) });
      if (s.bet > 0) want.set('b' + i, { amt: s.bet, pos: betPos(i) });
    });
    const pot = v.results ? 0 : E.potCollected(v);
    if (pot > 0) want.set('pot', { amt: pot, pos: POT });
    const win = v.results && v.results[0] && v.results[0].winners.length ? v.results[0].winners[0] : -1;

    for (const [key, o] of [...chips]) {
      const w = want.get(key);
      if (w && w.amt === o.amt) {
        if (!o.pos.equals(w.pos)) { o.pos = w.pos; tween(o.group, { pos: w.pos }, 0.3); }
        continue;
      }
      chips.delete(key);
      if (!w && (key[0] === 'b' || key === 'pot')) {
        const target = win >= 0 && v.results ? stackPos(win) : POT;
        tween(o.group, { pos: target }, 0.5, key === 'pot' ? 0.6 : 0, { arc: 0.25, done: () => root.remove(o.group) });
      } else root.remove(o.group);
    }
    for (const [key, w] of want) {
      if (chips.has(key)) continue;
      const group = chipGroup(w.amt);
      group.position.copy(w.pos);
      root.add(group);
      chips.set(key, { group, amt: w.amt, pos: w.pos });
    }
  }

  // ---------- avatar ----------
  function hashColor(str) {
    let h = 0; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return new THREE.Color().setHSL((h % 360) / 360, 0.55, 0.45);
  }
  function makeAvatar(s) {
    const g = new THREE.Group();
    const col = hashColor(s.id + s.name);
    const shirt = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, transparent: true });
    const skin = new THREE.MeshStandardMaterial({ color: s.bot ? 0xb8c2cf : 0xe0b48f, roughness: s.bot ? 0.3 : 0.6, metalness: s.bot ? 0.6 : 0, transparent: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.46, 1.25, 24), shirt);
    body.position.y = -0.2; body.castShadow = true;
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), shirt);
    shoulders.scale.set(1.15, 0.45, 0.8); shoulders.position.y = 0.38;
    const head = s.bot ? new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.44), skin) : new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 18), skin);
    head.position.y = 0.78; head.castShadow = true;
    g.add(body, shoulders, head);
    const mats = [shirt, skin];
    if (s.bot) {
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x55e0ff, transparent: true });
      [-0.1, 0.1].forEach(x => { const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.02), eyeMat); e.position.set(x, 0.8, 0.225); g.add(e); });
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2), skin); ant.position.y = 1.08; g.add(ant);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), eyeMat); tip.position.y = 1.19; g.add(tip);
      mats.push(eyeMat);
    } else {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.2),
        new THREE.MeshStandardMaterial({ color: hashColor(s.name).offsetHSL(0.3, -0.3, -0.3), roughness: 0.9, transparent: true }));
      hair.position.y = 0.8; hair.rotation.x = -0.25; g.add(hair); mats.push(hair.material);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true });
      [-0.08, 0.08].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), eyeMat); e.position.set(x, 0.8, 0.235); g.add(e); });
      mats.push(eyeMat);
    }
    return { group: g, mats, id: s.id, bot: s.bot, faded: false, head };
  }
  function syncAvatars(v) {
    for (let i = 0; i < 6; i++) {
      const s = v.seats[i];
      let a = avatars[i];
      const want = s && i !== mySeat;
      if (a && (!want || a.id !== s.id)) { root.remove(a.group); avatars[i] = a = null; }
      if (!want) continue;
      if (!a) {
        a = avatars[i] = makeAvatar(s);
        const p = avatarXZ(i);
        a.group.position.set(p.x, 0, p.z);
        a.group.scale.setScalar(0.85);
        a.group.lookAt(0, 0, 0.3);
        root.add(a.group);
      }
      const fade = s.out || s.away || (s.inHand && s.folded && v.phase !== 'lobby');
      const op = s.out ? 0.25 : fade ? 0.5 : 1;
      a.mats.forEach(m => { m.opacity = op; });
    }
  }

  // ---------- nameplate ----------
  function syncPlates(v) {
    const winners = new Map();
    if (v.phase === 'showdown' && v.results) v.results.forEach(r => r.winners.forEach(w => winners.set(w, true)));
    plates.forEach((p, i) => {
      const s = v.seats[i];
      if (!s) { p.el.hidden = true; return; }
      p.el.hidden = false;
      const badges = (v.dealer === i && v.phase !== 'lobby' ? '<b class="bd">D</b>' : '') + (s.bot ? '<b class="bb">BOT</b>' : '') + (s.away ? '<b class="bw">OFF</b>' : '');
      p.n.innerHTML = `${escHtml(s.name)} ${badges}`;
      p.s.textContent = s.out ? 'Bangkrut' : '🪙 ' + s.stack.toLocaleString('id-ID');
      let act = s.hand && s.shown && v.phase === 'showdown' ? s.hand : s.last;
      if (winners.get(i) && s.win) act = `+${s.win.toLocaleString('id-ID')} ${s.hand ? '· ' + s.hand : ''}`;
      p.a.textContent = act || '';
      p.a.className = 'pa ' + (winners.get(i) && s.win ? 'win' : s.last === 'Fold' ? 'fold' : /All/.test(s.last) ? 'allin' : '');
      p.el.classList.toggle('me', i === mySeat);
      p.el.classList.toggle('turn', v.toAct === i);
      p.el.classList.toggle('folded', !!(s.folded && s.inHand) || !!s.out);
    });
  }
  function escHtml(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const tmpV = new THREE.Vector3();
  function positionPlates() {
    if (!view) return;
    const w = window.innerWidth, h = window.innerHeight;
    plates.forEach((p, i) => {
      if (p.el.hidden) return;
      if (i === mySeat) { p.el.style.transform = ''; }
      else {
        const a = avatars[i];
        if (a) a.group.getWorldPosition(tmpV); else tmpV.copy(avatarXZ(i));
        tmpV.y = 1.3;
        tmpV.project(camera);
        const x = Math.max(60, Math.min(w - 60, (tmpV.x * 0.5 + 0.5) * w));
        const y = Math.max(40, Math.min(h - 40, (-tmpV.y * 0.5 + 0.5) * h));
        p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
      let pct = 0;
      if (view.toAct === i && view.deadline && view.cfg && view.cfg.turn) pct = Math.max(0, Math.min(1, (view.deadline - nowFn()) / (view.cfg.turn * 1000)));
      p.bar.parentNode.style.visibility = pct > 0 ? 'visible' : 'hidden';
      p.bar.style.width = (pct * 100).toFixed(1) + '%';
      p.bar.style.background = pct < 0.3 ? '#ff5d5d' : '#ffd36a';
    });
  }

  function syncMarkers(v) {
    if (v.dealer >= 0 && v.seats[v.dealer] && v.phase !== 'lobby') {
      const p = seatXZ(v.dealer, 0.62, v.dealer === mySeat ? -1.25 : -0.72);
      if (!dealerBtn.visible) { dealerBtn.position.set(p.x, 0.022, p.z); dealerBtn.visible = true; }
      else tween(dealerBtn, { pos: V(p.x, 0.022, p.z) }, 0.5);
    } else dealerBtn.visible = false;
    if (v.toAct >= 0 && v.seats[v.toAct]) {
      const p = seatXZ(v.toAct, v.toAct === mySeat ? 0.68 : 0.74);
      turnRing.position.set(p.x, 0.006, p.z);
      turnRing.scale.setScalar(v.toAct === mySeat ? 1.35 : 1);
      turnRing.visible = true;
    } else turnRing.visible = false;
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    clockT = ts / 1000;
    stepTweens();
    if (turnRing.visible) turnRing.material.opacity = 0.45 + Math.sin(clockT * 5) * 0.3;
    avatars.forEach((a, i) => {
      if (!a) return;
      a.head.position.y = 0.78 + Math.sin(clockT * 1.6 + i) * 0.012;
      a.head.rotation.y = view && view.toAct === i ? Math.sin(clockT * 2) * 0.15 : 0;
    });
    controls.update();
    renderer.render(scene, camera);
    positionPlates();
  }

  function clearAll() {
    for (const [, o] of cards) { root.remove(o.group); o.top.dispose(); }
    cards.clear();
    for (const [, o] of chips) root.remove(o.group);
    chips.clear();
    avatars.forEach((a, i) => { if (a) root.remove(a.group); avatars[i] = null; });
    tweens.length = 0;
    dealerBtn.visible = false; turnRing.visible = false;
  }

  function update(v, my) {
    const vs = my >= 0 ? my : 0;
    if (vs !== viewSeat || my !== mySeat) { viewSeat = vs; mySeat = my; clearAll(); }
    view = v;
    syncAvatars(v); syncCards(v); syncChips(v); syncMarkers(v); syncPlates(v);
  }
  function reset() {
    clearAll(); view = null;
    plates.forEach(p => { p.el.hidden = true; });
  }

  return { init, update, reset };
})();
