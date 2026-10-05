/* Ustatahir Konutları — giriş ekranı için canlı sahne.
   Gökyüzü gerçek saate göre değişir (şafak, gündüz, gün batımı, gece). Akşam pencereler yanar,
   bulutlar süzülür, gece yıldızlar parlar ve sokak lambaları yanar. Her çözünürlükte nettir.
   Önizleme: adresin sonuna ?saat=19.5 gibi bir saat eklenebilir. */
(function () {
  'use strict';
  const cv = document.getElementById('sahne');
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wideMq = matchMedia('(min-aspect-ratio: 5/4)');
  let W = 0, H = 0, DPR = 1, layout = null, cache = {}, raf = 0, lastT = 0, lastBake = 0;

  // ---------- yardımcılar ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => { const A = typeof a === 'string' ? hex(a) : a, B = typeof b === 'string' ? hex(b) : b; return [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]; };
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // ---------- zaman ve ışık ----------
  function hourNow() {
    const q = new URLSearchParams(location.search).get('saat');
    if (q != null && !isNaN(parseFloat(q))) return (parseFloat(q) + (performance.now() / 1000 / 3600)) % 24;
    const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }
  function sunTimes() {
    const d = new Date(), start = new Date(d.getFullYear(), 0, 0), doy = Math.floor((d - start) / 86400000);
    const len = 12.15 + 2.45 * Math.cos(2 * Math.PI * (doy - 172) / 365); // ~37°K enlemi
    const noon = 12.95;
    return { rise: noon - len / 2, set: noon + len / 2 };
  }
  function light(h) {
    const { rise, set } = sunTimes(), tw = 0.9;
    let L; // 0 gece … 1 gündüz
    if (h < rise - tw || h > set + tw) L = 0;
    else if (h < rise + tw) L = (h - (rise - tw)) / (2 * tw);
    else if (h > set - tw) L = 1 - (h - (set - tw)) / (2 * tw);
    else L = 1;
    L = clamp(L, 0, 1); L = L * L * (3 - 2 * L);
    const dr = Math.abs(h - rise), ds = Math.abs(h - set);
    const warm = clamp(1 - Math.min(dr, ds) / 1.3, 0, 1); // gün doğumu/batımı sıcaklığı
    const dusk = ds < dr; // akşam mı sabah mı
    // güneşin gökyüzündeki yeri (0..1 doğudan batıya), yüksekliği
    const p = clamp((h - rise) / (set - rise), -0.15, 1.15);
    return { L, warm, dusk, p, night: L < 0.25 };
  }
  function palette(lt) {
    const { L, warm, dusk } = lt;
    const top = mix(mix('#0a1526', '#3f86c6', L), dusk ? '#3a3f78' : '#5a78b0', warm * 0.6);
    const mid = mix(mix('#13253c', '#8cc2ea', L), dusk ? '#c86a6a' : '#e7a3a0', warm * 0.75);
    const hor = mix(mix('#24364a', '#dcefff', L), dusk ? '#ffad66' : '#ffd29a', warm);
    const facade = mix(mix('#3a4650', '#e6e9ec', L), '#f0c9a8', warm * 0.35);
    const facadeShade = mix(mix('#2a333b', '#bfc6cc', L), '#c99b80', warm * 0.3);
    const stripe = mix('#1c2329', '#55606a', L);
    const roof = mix('#141a20', '#3d4752', L);
    const city = [mix(mix('#16263a', '#a9c4d8', L), hor, 0.35), mix(mix('#1b2b3c', '#8aa6bb', L), hor, 0.22), mix(mix('#202f3e', '#7891a3', L), hor, 0.12)];
    const ground = mix('#1a2226', '#7f8a72', L);
    const grass = mix('#14241a', '#5f8a4a', L);
    const road = mix('#202629', '#9a9690', L);
    const winDay = mix('#2b3a48', '#9fb9cc', L);
    return { top, mid, hor, facade, facadeShade, stripe, roof, city, ground, grass, road, winDay };
  }

  // ---------- yerleşim (ekran boyutuna göre bir kez) ----------
  function buildLayout() {
    const r = rng(20251005);
    const groundY = H * 0.86;
    // uzak şehir katmanları
    const layers = [0.62, 0.70, 0.77].map((base, li) => {
      const arr = []; let x = -20;
      while (x < W + 20) {
        const w = (28 + r() * 60) * (H / 1080) * (1 + li * 0.25);
        const h = (40 + r() * (li === 0 ? 150 : 110)) * (H / 1080) * (1 + li * 0.2);
        const wins = [];
        const cols = Math.max(1, Math.floor(w / (9 * H / 1080))), rows = Math.max(1, Math.floor(h / (11 * H / 1080)));
        for (let c = 0; c < cols; c++) for (let k = 0; k < rows; k++) if (r() < 0.32) wins.push([c / cols, k / rows, r()]);
        arr.push({ x, w, h, y: H * base + (li === 0 ? 0 : r() * 8), wins, cols, rows });
        x += w + r() * 6 * (H / 1080);
      }
      return arr;
    });
    // site blokları: arkada üç, önde üç (fotoğraftaki düzen gibi)
    const s = H / 1080, cx = W / 2;
    const blocks = [
      { name: 'B1', x: cx - 520 * s, w: 300 * s, floors: 5, depth: 1 },
      { name: 'B2', x: cx - 150 * s, w: 300 * s, floors: 5, depth: 1 },
      { name: 'C2', x: cx + 220 * s, w: 300 * s, floors: 5, depth: 1 },
      { name: 'A1', x: cx - 860 * s, w: 520 * s, floors: 5, depth: 0 },
      { name: 'C1', x: cx - 230 * s, w: 460 * s, floors: 4, depth: 0, low: true },
      { name: 'A2', x: cx + 340 * s, w: 520 * s, floors: 5, depth: 0 }
    ];
    blocks.forEach(b => {
      const fh = (b.depth ? 46 : 62) * s;
      b.base = b.depth ? groundY - 70 * s : groundY - 6 * s;
      b.h = b.floors * fh + 14 * s; b.fh = fh; b.top = b.base - b.h;
      const bays = Math.round(b.w / ((b.depth ? 38 : 46) * s));
      b.bays = bays; b.wins = [];
      for (let f = 0; f < b.floors; f++) for (let k = 0; k < bays; k++) {
        if (k % 4 === 1 && !b.low) continue; // merdiven bandı
        b.wins.push({ f, k, on: r() < 0.55, hue: r(), next: 4 + r() * 40 });
      }
    });
    // ağaçlar (birkaç palmiye)
    const trees = []; for (let x = 30 * s; x < W; x += (90 + r() * 120) * s) trees.push({ x, h: (60 + r() * 50) * s, palm: r() < 0.3 });
    // sokak lambaları
    const lamps = []; for (let x = 60 * s; x < W; x += 170 * s) lamps.push(x + r() * 30 * s);
    // yıldızlar ve bulutlar
    const stars = Array.from({ length: Math.round(W * H / 9000) }, () => ({ x: r() * W, y: r() * H * 0.6, r: (0.4 + r() * 1.3) * Math.max(1, H / 1080), ph: r() * 6.28, sp: 0.6 + r() * 1.8 }));
    const clouds = Array.from({ length: 7 }, (_, i) => ({ x: r() * W, y: H * (0.08 + r() * 0.32), s: (0.6 + r() * 1.1) * s, v: (4 + r() * 10) * s, parts: Array.from({ length: 7 + (r() * 5 | 0) }, () => [r() * 2 - 1, r() * 0.45 - 0.2, 0.45 + r() * 0.6]) }));
    return { groundY, layers, blocks, lamps, trees, stars, clouds, s, plane: { t: -1 } };
  }

  // ---------- statik katmanların çizimi (yarım dakikada bir) ----------
  function makeCanvas() { const c = document.createElement('canvas'); c.width = W * DPR; c.height = H * DPR; const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0); return [c, g]; }
  function bake(lt) {
    const P = palette(lt), Ly = layout, s = Ly.s;
    // gökyüzü + uzak şehir
    const [bc, b] = makeCanvas();
    const g = b.createLinearGradient(0, 0, 0, Ly.groundY);
    g.addColorStop(0, rgb(P.top)); g.addColorStop(0.55, rgb(P.mid)); g.addColorStop(1, rgb(P.hor));
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    // güneş / ay
    const arcX = lerp(W * 0.08, W * 0.92, clamp(lt.p, 0, 1));
    if (lt.L > 0.05) {
      const sy = Ly.groundY - Math.sin(Math.PI * clamp(lt.p, 0, 1)) * H * 0.62 + (1 - lt.L) * H * 0.08;
      const sc = mix('#fff6d8', '#ffb36b', lt.warm);
      const gr = b.createRadialGradient(arcX, sy, 0, arcX, sy, 220 * s);
      gr.addColorStop(0, rgb(sc, 0.95)); gr.addColorStop(0.08, rgb(sc, 0.85)); gr.addColorStop(0.25, rgb(sc, 0.25)); gr.addColorStop(1, rgb(sc, 0));
      b.fillStyle = gr; b.fillRect(arcX - 240 * s, sy - 240 * s, 480 * s, 480 * s);
    }
    if (lt.L < 0.6) {
      const mx = W * 0.8, my = H * 0.16, mr = 26 * s, a = 1 - lt.L / 0.6;
      const gr = b.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 5);
      gr.addColorStop(0, `rgba(220,230,255,${0.18 * a})`); gr.addColorStop(1, 'rgba(220,230,255,0)');
      b.fillStyle = gr; b.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
      b.fillStyle = `rgba(240,244,255,${0.95 * a})`; b.beginPath(); b.arc(mx, my, mr, 0, 7); b.fill();
      b.fillStyle = rgb(P.top, a); b.beginPath(); b.arc(mx + mr * 0.45, my - mr * 0.15, mr * 0.95, 0, 7); b.fill(); // hilal
    }
    // uzak şehir
    Ly.layers.forEach((layer, li) => {
      layer.forEach(bd => {
        b.fillStyle = rgb(P.city[li]); b.fillRect(bd.x, bd.y - bd.h, bd.w, bd.h + H);
        const lit = lt.night ? 0.9 : clamp(1 - lt.L * 1.6, 0, 1);
        if (lit > 0) bd.wins.forEach(([u, v, q]) => { if (q < 0.55) { b.fillStyle = q < 0.08 ? `rgba(190,220,255,${0.55 * lit})` : `rgba(255,${200 + (q * 40 | 0)},120,${(0.35 + 0.4 * (1 - li / 3)) * lit})`; b.fillRect(bd.x + u * bd.w + 2 * s, bd.y - bd.h + v * bd.h + 3 * s, 3 * s * (1 + li * 0.3), 4 * s * (1 + li * 0.3)); } });
      });
      // pus
      const hz = b.createLinearGradient(0, H * 0.5, 0, Ly.groundY);
      hz.addColorStop(0, rgb(P.hor, 0)); hz.addColorStop(1, rgb(P.hor, 0.18 - li * 0.04));
      b.fillStyle = hz; b.fillRect(0, H * 0.5, W, Ly.groundY - H * 0.5);
    });
    cache.back = bc;

    // orta plan: zemin ve arka sıradaki bloklar
    const [mc, f] = makeCanvas();
    // zemin
    f.fillStyle = rgb(P.ground); f.fillRect(0, Ly.groundY - 80 * s, W, H);
    f.fillStyle = rgb(P.grass); f.fillRect(0, Ly.groundY - 80 * s, W, 70 * s);
    f.fillStyle = rgb(P.road); f.fillRect(0, Ly.groundY + 26 * s, W, H);
    f.fillStyle = rgb(mix(P.road, '#ffffff', 0.25)); for (let x = 0; x < W; x += 90 * s) f.fillRect(x, Ly.groundY + 70 * s, 46 * s, 4 * s);
    Ly.blocks.filter(bk => bk.depth === 1).forEach(bk => drawBlock(f, bk, P, lt));
    cache.mid = mc;
    // ön plan: öndeki bloklar, ağaçlar, duvar, lambalar
    const [fc, f2] = makeCanvas();
    Ly.blocks.filter(bk => bk.depth === 0).forEach(bk => drawBlock(f2, bk, P, lt));
    drawFront(f2, P, lt);
    cache.front = fc;
    cache.P = P;
  }
  function drawFront(f, P, lt) {
    const Ly = layout, s = Ly.s;
    // ağaçlar
    const tc = mix('#0f1c14', '#4f7a3c', lt.L), tc2 = mix('#13241a', '#6a9a4f', lt.L), trunk = mix('#1a1512', '#5a4535', lt.L);
    Ly.trees.forEach(t => {
      if (t.palm) {
        f.strokeStyle = rgb(trunk); f.lineWidth = 5 * s; f.beginPath(); f.moveTo(t.x, Ly.groundY + 4 * s); f.quadraticCurveTo(t.x + 8 * s, Ly.groundY - t.h * 0.5, t.x + 4 * s, Ly.groundY - t.h); f.stroke();
        f.fillStyle = rgb(tc);
        for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * 0.5; f.save(); f.translate(t.x + 4 * s, Ly.groundY - t.h); f.rotate(a + Math.PI / 2); f.beginPath(); f.ellipse(0, -26 * s, 7 * s, 28 * s, 0, 0, 7); f.fill(); f.restore(); }
      } else {
        f.fillStyle = rgb(trunk); f.fillRect(t.x - 3 * s, Ly.groundY - t.h * 0.45, 6 * s, t.h * 0.45 + 6 * s);
        f.fillStyle = rgb(tc); f.beginPath(); f.arc(t.x, Ly.groundY - t.h * 0.62, t.h * 0.34, 0, 7); f.arc(t.x - t.h * 0.2, Ly.groundY - t.h * 0.48, t.h * 0.26, 0, 7); f.arc(t.x + t.h * 0.22, Ly.groundY - t.h * 0.5, t.h * 0.27, 0, 7); f.fill();
        f.fillStyle = rgb(tc2, 0.6); f.beginPath(); f.arc(t.x - t.h * 0.08, Ly.groundY - t.h * 0.72, t.h * 0.18, 0, 7); f.fill();
      }
    });
    // çevre duvarı
    f.fillStyle = rgb(mix(P.facade, P.ground, 0.4)); f.fillRect(0, Ly.groundY + 6 * s, W, 16 * s);
    f.fillStyle = rgb(mix(P.stripe, P.ground, 0.2)); for (let x = 20 * s; x < W; x += 60 * s) f.fillRect(x, Ly.groundY - 2 * s, 8 * s, 26 * s);
    // lambalar (direk)
    Ly.lamps.forEach(x => { f.fillStyle = rgb(P.stripe); f.fillRect(x, Ly.groundY - 54 * s, 3 * s, 62 * s); f.fillRect(x - 6 * s, Ly.groundY - 56 * s, 15 * s, 4 * s); });
  }
  function drawBlock(g, b, P, lt) {
    const s = layout.s, x = b.x, y = b.top, w = b.w, h = b.h;
    // gövde
    g.fillStyle = rgb(b.depth ? mix(P.facade, P.hor, 0.18) : P.facade); g.fillRect(x, y, w, h);
    g.fillStyle = rgb(P.facadeShade, 0.9); g.fillRect(x + w * 0.86, y, w * 0.14, h); // gölge yüzü
    // dikey koyu bantlar
    if (!b.low) for (let k = 1; k < b.bays; k += 4) { g.fillStyle = rgb(P.stripe, 0.85); g.fillRect(x + k * (w / b.bays), y + 6 * s, w / b.bays, h - 6 * s); }
    // çatı (kırma çatı)
    const ov = 12 * s, rh = (b.depth ? 26 : 34) * s;
    g.fillStyle = rgb(P.roof); g.beginPath(); g.moveTo(x - ov, y + 2 * s); g.lineTo(x + w * 0.12, y - rh); g.lineTo(x + w * 0.88, y - rh); g.lineTo(x + w + ov, y + 2 * s); g.closePath(); g.fill();
    g.fillStyle = rgb(mix(P.roof, '#ffffff', 0.08)); g.fillRect(x - ov, y, w + ov * 2, 3 * s);
    // pencereler (gündüz hali) ve balkonlar
    const bw = w / b.bays;
    b.wins.forEach(wi => {
      const wx = x + wi.k * bw + bw * 0.2, wy = y + 14 * s + wi.f * b.fh + b.fh * 0.18, ww = bw * 0.6, wh = b.fh * 0.5;
      g.fillStyle = rgb(P.winDay); g.fillRect(wx, wy, ww, wh);
      g.fillStyle = rgb(P.stripe, 0.9); g.fillRect(wx - bw * 0.12, wy + wh + 2 * s, ww + bw * 0.24, 3 * s); // balkon korkuluğu
      wi.rect = [wx, wy, ww, wh];
    });
    // giriş
    g.fillStyle = rgb(P.stripe); g.fillRect(x + w * 0.46, b.base - b.fh * 0.7, w * 0.08, b.fh * 0.7);
  }

  // ---------- her karede çizilenler ----------
  function frame(t) {
    raf = 0;
    if (!document.body.classList.contains('loginbg') || !wideMq.matches || document.hidden) return;
    if (lastT && t - lastT < 30) { raf = requestAnimationFrame(frame); return; } // ~30 kare/sn yeter, pil dostu
    const dt = Math.min(0.1, (t - lastT) / 1000 || 0); lastT = t;
    const h = hourNow(), lt = light(h);
    if (!cache.back || t - lastBake > 30000) { bake(lt); lastBake = t; }
    const Ly = layout, s = Ly.s, P = cache.P;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(cache.back, 0, 0, W, H);
    // yıldızlar
    const starA = clamp(1 - lt.L * 1.8, 0, 1);
    if (starA > 0) Ly.stars.forEach(st => { const a = starA * (0.45 + 0.55 * Math.sin(t / 1000 * st.sp + st.ph)) ; if (a > 0.05) { ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(st.x, st.y, st.r, st.r); } });
    // uçak (gece, ara sıra)
    if (lt.L < 0.4) {
      const pl = Ly.plane; if (pl.t < 0 && Math.random() < dt / 40) { pl.t = 0; pl.y = H * (0.1 + Math.random() * 0.15); pl.dir = Math.random() < 0.5 ? 1 : -1; }
      if (pl.t >= 0) { pl.t += dt / 45; const px = pl.dir > 0 ? lerp(-20, W + 20, pl.t) : lerp(W + 20, -20, pl.t); const blink = Math.sin(t / 180) > 0.6; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(px, pl.y, 2 * s, 2 * s); if (blink) { ctx.fillStyle = 'rgba(255,80,80,.95)'; ctx.fillRect(px - 4 * s * pl.dir, pl.y, 2.5 * s, 2.5 * s); } if (pl.t > 1) pl.t = -1; }
    }
    // bulutlar
    const cc = mix(mix('#2a3a50', '#ffffff', lt.L), '#ffc7a0', lt.warm * 0.6), ca = 0.12 + 0.42 * lt.L;
    Ly.clouds.forEach(cl => {
      cl.x += cl.v * dt; if (cl.x - 260 * cl.s > W) cl.x = -260 * cl.s;
      cl.parts.forEach(([u, v, r]) => { const R = 80 * cl.s * r, X = cl.x + u * 150 * cl.s, Y = cl.y + v * 80 * cl.s; const gr = ctx.createRadialGradient(X, Y, 0, X, Y, R); gr.addColorStop(0, rgb(cc, ca)); gr.addColorStop(0.55, rgb(cc, ca * 0.75)); gr.addColorStop(1, rgb(cc, 0)); ctx.fillStyle = gr; ctx.fillRect(X - R, Y - R, R * 2, R * 2); });
    });
    const lit = clamp(1 - lt.L * 1.7, 0, 1);
    const litWins = depth => Ly.blocks.forEach(b => { if (b.depth !== depth) return; b.wins.forEach(wi => {
        wi.next -= dt; if (wi.next < 0) { wi.next = 8 + Math.random() * 60; if (Math.random() < 0.3) wi.on = !wi.on; }
        if (!wi.on || !wi.rect) return;
        const [x, y, w, hh] = wi.rect;
        const c = wi.hue < 0.12 ? [170, 205, 255] : wi.hue < 0.5 ? [255, 214, 140] : [255, 196, 110];
        ctx.fillStyle = rgb(c, (depth ? 0.75 : 0.92) * lit); ctx.fillRect(x, y, w, hh);
        ctx.fillStyle = rgb([255, 255, 255], 0.12 * lit); ctx.fillRect(x, y, w, hh * 0.35);
      }); });
    ctx.drawImage(cache.mid, 0, 0, W, H);
    if (lit > 0) litWins(1);
    ctx.drawImage(cache.front, 0, 0, W, H);
    if (lit > 0) {
      litWins(0);
      // lamba ışıkları
      Ly.lamps.forEach(x => { const y = layout.groundY - 52 * s; const gr = ctx.createRadialGradient(x + 1.5 * s, y, 0, x + 1.5 * s, y, 80 * s); gr.addColorStop(0, `rgba(255,220,160,${0.9 * lit})`); gr.addColorStop(0.08, `rgba(255,205,130,${0.5 * lit})`); gr.addColorStop(1, 'rgba(255,200,120,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x + 1.5 * s, y, 80 * s, 0, 7); ctx.fill(); });
    }
    if (!reduce) raf = requestAnimationFrame(frame);
  }

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    layout = buildLayout(); cache = {}; lastBake = 0;
    kick();
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  window.addEventListener('resize', () => { clearTimeout(resize._t); resize._t = setTimeout(resize, 150); });
  document.addEventListener('visibilitychange', kick);
  wideMq.addEventListener && wideMq.addEventListener('change', kick);
  new MutationObserver(kick).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  resize();
})();
