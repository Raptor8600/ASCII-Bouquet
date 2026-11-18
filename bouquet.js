/*
 * Rotating ASCII bouquet
 * ----------------------
 * A tiny software 3D renderer drawn onto a <canvas>. Every "pixel" is one grid
 * cell, filled with a colour and (in ASCII style) a shaded character.
 *
 *   - Big layered roses (red and pink) plus a few yellow and purple blooms
 *   - Baby's breath sprays scattered through and around the flowers
 *   - Green stems and leaves, wrapped in a pleated paper cone
 *   - Satin ribbon bow with a little heart tag
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------
  const SEED = 14;                 // change for a different arrangement
  const GRID_W = 96;               // characters across (more = more detail)
  const GRID_H = 80;               // characters down
  const CELL = 9;                  // canvas pixels per cell
  const FRAME_DELAY = 50;          // ms between frames (bigger = slower)
  const ROTATION_SPEED = 0.005;    // radians per frame (fixed, very slow)
  const CAMERA_DISTANCE = 10.0;
  const BASE_PITCH = 0.25;         // camera looks slightly down on the bouquet
  const LIGHT_DIR = [-0.45, 0.70, 0.55];   // from upper left, in front
  const GLYPH_RAMP = ".,:;+=itfLCO0#%@";   // dark -> bright

  const PAPER_BOTTOM = -1.75;
  const PAPER_TOP = 0.0;
  const STEM_BOTTOM = -2.05;
  const TIE_Y = -1.05;             // where the ribbon is tied
  const DOME_CENTER = [0, -0.35, 0];
  const PLEATS = 7;

  const WHITE = [250, 250, 255];
  const STEM_GREEN = [46, 140, 58];
  const STEM_LIGHT = [84, 168, 84];
  const LEAF_DARK = [24, 98, 44];
  const LEAF_LIGHT = [96, 180, 90];
  const TWIG_GREEN = [112, 172, 102];

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function mulberry32(a) {            // small seedable random generator
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(SEED);
  const uniform = (a, b) => a + (b - a) * rand();
  const randint = (a, b) => a + Math.floor(rand() * (b - a + 1));

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
                           a[2] * b[0] - a[0] * b[2],
                           a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.sqrt(dot(a, a));
  function norm(a) { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function mix(a, b, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  const scaleColor = (c, k) => [clamp8(c[0] * k), clamp8(c[1] * k), clamp8(c[2] * k)];
  const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

  const LIGHT = norm(LIGHT_DIR);
  const FILL = norm([0.25, -0.25, 0.9]);   // soft light from the front, lifts undersides

  function basis(normal) {            // two vectors perpendicular to normal
    const n = norm(normal);
    const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(helper, n));
    const v = cross(n, u);
    return [u, v, n];
  }

  // ---------------------------------------------------------------------
  // Scene: a cloud of coloured 3D points
  // layout per point: x y z  nx ny nz  r g b  glyph twoSided
  // glyph: 0 = normal cell, 1 = "*" blossom, 2 = "o" blossom
  // ---------------------------------------------------------------------
  const STRIDE = 11;
  const raw = [];
  function addPoint(p, n, c, glyph = 0, twoSided = false) {
    raw.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2],
             glyph | 0, twoSided ? 1 : 0);
  }

  /** Quadratic Bezier made of points. thick adds a second and third point so
   *  stems read as a solid line at this resolution. */
  function drawCurve(p0, p1, p2, colA, colB, spacing = 0.025, thick = false) {
    const approx = len(sub(p1, p0)) + len(sub(p2, p1));
    const steps = Math.max(3, Math.floor(approx / spacing));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      const p = [a * p0[0] + b * p1[0] + c * p2[0],
                 a * p0[1] + b * p1[1] + c * p2[1],
                 a * p0[2] + b * p1[2] + c * p2[2]];
      const radial = [p[0], 0, p[2]];
      const nrm = len(radial) > 1e-6 ? norm(radial) : [0, 0, 1];
      const col = mix(colA, colB, t);
      addPoint(p, nrm, col, 0, true);
      if (thick) {
        addPoint([p[0] + 0.03, p[1], p[2]], nrm, col, 0, true);
        addPoint([p[0], p[1], p[2] + 0.03], nrm, col, 0, true);
      }
      pts.push(p);
    }
    return pts;
  }

  // ---------------------------------------------------------------------
  // Paper cone, ribbon, bow and heart tag
  // ---------------------------------------------------------------------
  const paperRadius = (t) => 0.14 + 1.02 * Math.pow(t, 1.05);
  const pleat = (th, t) => 1 + 0.08 * t * Math.sin(PLEATS * th);

  function buildPaper() {
    const H = PAPER_TOP - PAPER_BOTTOM;
    const rows = 84, eps = 0.01;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const y = PAPER_BOTTOM + t * H;
      const r0 = paperRadius(t);
      const hi = Math.min(1, t + eps), lo = Math.max(0, t - eps);
      const slope = (paperRadius(hi) - paperRadius(lo)) / ((hi - lo) * H);
      const count = Math.max(20, Math.floor(2 * Math.PI * r0 * 1.12 / 0.026));
      for (let k = 0; k < count; k++) {
        const th = 2 * Math.PI * k / count;
        const rimT = 1 - 0.05 * (0.5 + 0.5 * Math.sin(PLEATS * th + 1.0));  // wavy rim
        if (t > rimT) continue;
        const m = pleat(th, t);
        const r = r0 * m;
        const c = Math.cos(th), s = Math.sin(th);
        const tang = -(0.08 * t * PLEATS * Math.cos(PLEATS * th)) / m;     // pleat shading
        const nrm = norm([c - s * tang, -slope, s + c * tang]);
        const stripe = 0.5 + 0.5 * Math.sin(PLEATS * th);
        let col = mix([242, 178, 204], [255, 232, 240], t);
        col = mix(col, [255, 240, 245], 0.18 * stripe);
        if (t > 0.94) col = [255, 244, 247];
        addPoint([r * c, y, r * s], nrm, col);
        if (t > 0.35) {                                                   // red inside
          const inner = mix([150, 20, 50], [206, 44, 78], t);
          addPoint([r * 0.965 * c, y, r * 0.965 * s], mul(nrm, -1), inner, 0, true);
        }
      }
    }
  }

  function ribbonRadius(y) {
    const t = (y - PAPER_BOTTOM) / (PAPER_TOP - PAPER_BOTTOM);
    return paperRadius(t) * 1.09 + 0.025;
  }

  function buildRibbon() {
    for (let y = TIE_Y - 0.08; y <= TIE_Y + 0.08; y += 0.02) {
      const r = ribbonRadius(y);
      const count = Math.floor(2 * Math.PI * r / 0.024);
      const shine = 1 - Math.abs(y - TIE_Y) / 0.08;
      const col = mix([212, 24, 58], [255, 96, 120], shine * 0.6);
      for (let k = 0; k < count; k++) {
        const th = 2 * Math.PI * k / count;
        const c = Math.cos(th), s = Math.sin(th);
        addPoint([r * c, y, r * s], norm([c, -0.5, s]), col);
      }
    }
  }

  function buildHeart(center, radial, tangent) {
    const sc = 0.17;
    for (let hx = -1.3; hx <= 1.3; hx += 0.08) {
      for (let hy = -1.2; hy <= 1.4; hy += 0.08) {
        const f = Math.pow(hx * hx + hy * hy - 1, 3) - hx * hx * Math.pow(hy, 3);
        if (f > 0) continue;
        const p = add(add(center, mul(tangent, hx * sc)),
                      add([0, hy * sc, 0], mul(radial, 0.02)));
        const shine = (hx < -0.1 && hy > 0.3) ? 0.45 : 0;
        addPoint(p, radial, mix([212, 16, 56], [255, 130, 150], shine), 0, true);
      }
    }
  }

  function buildBow() {
    const a0 = Math.PI / 2;                       // bow faces the camera at the start
    const radial = [Math.cos(a0), 0, Math.sin(a0)];
    const tangent = [-Math.sin(a0), 0, Math.cos(a0)];
    const up = [0, 1, 0];
    const C = add(mul(radial, ribbonRadius(TIE_Y) + 0.03), [0, TIE_Y, 0]);
    const red = [216, 26, 60], dark = [150, 10, 42], light = [255, 96, 120];

    // two loops
    for (const s of [-1, 1]) {
      const m = norm(add(mul(tangent, s), mul(up, 0.3)));   // loop's long axis
      const q = norm(cross(radial, m));
      const a = 0.30, b = 0.15;
      const centre = add(C, mul(m, a * 0.95));  // loop sits beside the knot
      for (let ua = -a; ua <= a; ua += 0.02) {
        for (let ub = -b; ub <= b; ub += 0.02) {
          const e = (ua / a) ** 2 + (ub / b) ** 2;
          if (e > 1) continue;
          const p = add(add(centre, add(mul(m, ua), mul(q, ub))),
                        mul(radial, 0.01 + 0.05 * (1 - e)));
          const col = e < 0.25 ? dark : mix(light, red, (1 - e) * 1.3);
          addPoint(p, radial, col, 0, true);
        }
      }
    }

    // knot
    for (let ua = -0.09; ua <= 0.09; ua += 0.018) {
      for (let ub = -0.09; ub <= 0.09; ub += 0.018) {
        const e = (ua / 0.09) ** 2 + (ub / 0.09) ** 2;
        if (e > 1) continue;
        const p = add(add(C, add(mul(tangent, ua), mul(up, ub))),
                      mul(radial, 0.025 + 0.04 * (1 - e)));
        addPoint(p, radial, mix(red, light, 0.4 * (1 - e)), 0, true);
      }
    }

    // two tails; the heart tag hangs from the right one
    for (const s of [-1, 1]) {
      const dir = norm(add(add(mul(tangent, s * 0.45), [0, -1, 0]), mul(radial, 0.3)));
      const wdir = norm(cross(dir, radial));
      const L = 0.78;
      const steps = Math.floor(L / 0.02);
      let endPoint = C;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const w = 0.06 + 0.06 * u;
        const centre = add(add(C, mul(dir, L * u)),
                           mul(tangent, s * 0.07 * Math.sin(u * Math.PI * 0.9)));
        endPoint = centre;
        for (let across = -w; across <= w; across += 0.02) {
          if (u > 0.88 && Math.abs(across) < (u - 0.88) * w * 6) continue;   // V-notch
          const p = add(add(centre, mul(wdir, across)), mul(radial, 0.015));
          addPoint(p, radial, mix(red, light, 0.25 * (1 - u)), 0, true);
        }
      }
      if (s === 1) buildHeart(add(endPoint, [0, -0.17, 0.0]), radial, tangent);
    }
  }

  // ---------------------------------------------------------------------
  // Flowers
  // ---------------------------------------------------------------------
  const FLOWER_TYPES = {
    red:    { petal: [218, 30, 54],   tip: [255, 104, 112], core: [132, 8, 34],
              petals: 6,  cup: 0.55, style: "rose",  size: 1.00 },
    pink:   { petal: [246, 124, 180], tip: [255, 204, 228], core: [194, 52, 124],
              petals: 7,  cup: 0.50, style: "rose",  size: 1.00 },
    yellow: { petal: [255, 208, 36],  tip: [255, 238, 130], core: [160, 88, 14],
              petals: 11, cup: 0.12, style: "daisy", size: 1.00 },
    purple: { petal: [124, 70, 206],  tip: [196, 152, 248], core: [255, 214, 86],
              petals: 14, cup: 0.20, style: "aster", size: 0.88 },
  };
  const OUTLINE_LOW = { rose: 0.88, daisy: 0.62, aster: 0.74 };

  function flowerColor(spec, r, th, radius) {
    const t = r / radius;
    if (spec.style === "rose") {
      // concentric petal layers: each is shaded darker where it tucks under the next
      const layers = 4;
      const lt = Math.min(0.999, t) * layers;
      const layer = Math.floor(lt), tt = lt - layer;
      const lobe = 0.5 + 0.5 * Math.cos(spec.petals * th * 0.5 + layer * 1.7);
      const shade = 0.74 + 0.26 * Math.pow(tt, 0.6);
      let col = mix(spec.core, spec.petal, ((layer + 0.5) / layers) * 1.15);
      col = mix(col, spec.tip, 0.45 * tt * tt * lobe);
      if (layer === 0) {                                  // tight spiral heart of the rose
        const swirl = 0.5 + 0.5 * Math.sin(th * 3 + r * 40);
        col = mix(col, spec.petal, 0.35 * swirl);
      }
      return scaleColor(col, shade);
    }
    const ray = 0.5 + 0.5 * Math.cos(spec.petals * th);
    if (spec.style === "daisy") {
      if (t < 0.30) return mix(spec.core, [232, 156, 34], 0.5 + 0.5 * Math.sin(th * 7 + r * 60));
      return mix(spec.petal, spec.tip, 0.6 * ray * t);
    }
    if (t < 0.22) return mix(spec.core, [210, 150, 30], 0.5 + 0.5 * Math.sin(th * 9 + r * 70));
    return mix(spec.petal, spec.tip, 0.7 * ray * t);
  }

  function buildFlower(center, normal, radius, spec) {
    const [u, v, n] = basis(normal);
    const lo = OUTLINE_LOW[spec.style];
    const step = 0.025;
    const rings = Math.floor(radius / step);
    for (let ri = 0; ri <= rings; ri++) {
      const r = ri * step;
      const count = ri === 0 ? 1 : Math.max(6, Math.floor(2 * Math.PI * r / 0.028));
      for (let k = 0; k < count; k++) {
        const th = 2 * Math.PI * k / count + (ri % 2) * 0.5 * Math.PI / count;
        const wave = Math.abs(Math.cos(spec.petals * th / 2));   // scalloped outline
        if (r > radius * (lo + (1 - lo) * wave)) continue;
        const t = r / radius;
        const radial = add(mul(u, Math.cos(th)), mul(v, Math.sin(th)));
        const pos = add(add(center, mul(radial, r)), mul(n, spec.cup * radius * t * t));
        const nrm = norm(sub(n, mul(radial, spec.cup * 2 * t)));
        addPoint(pos, nrm, flowerColor(spec, r, th, radius), 0, true);
      }
    }
    // green calyx behind the petals (shows when a flower faces away)
    const back = sub(center, mul(n, 0.05));
    for (let r = 0; r <= radius * 0.62; r += 0.035) {
      const count = r === 0 ? 1 : Math.max(6, Math.floor(2 * Math.PI * r / 0.035));
      for (let k = 0; k < count; k++) {
        const th = 2 * Math.PI * k / count;
        const p = add(back, add(mul(u, r * Math.cos(th)), mul(v, r * Math.sin(th))));
        addPoint(p, mul(n, -1), [40, 120, 52], 0, true);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Leaves
  // ---------------------------------------------------------------------
  function buildLeaf(base, direction, leafLen, width, droop = 0.3) {
    const d = norm(direction);
    const side = norm(cross(d, [0, 1, 0]));
    const up = norm(cross(side, d));
    const steps = Math.max(4, Math.floor(leafLen / 0.025));
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const half = width * 0.5 * Math.sin(Math.PI * Math.pow(s, 0.8));
      const centre = add(add(base, mul(d, leafLen * s)), [0, -droop * leafLen * s * s, 0]);
      const across = Math.max(1, Math.floor(half * 2 / 0.025));
      for (let j = 0; j <= across; j++) {
        const w = (j / across) * 2 - 1;
        const p = add(add(centre, mul(side, half * w)), mul(up, 0.04 * (1 - Math.abs(w))));
        const col = mix(LEAF_DARK, LEAF_LIGHT, s * 0.7 + (Math.abs(w) < 0.12 ? 0.3 : 0));
        addPoint(p, up, col, 0, true);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Baby's breath: branch -> twigs -> little star blossoms
  // ---------------------------------------------------------------------
  function buildBabysBreath() {
    for (let b = 0; b < 15; b++) {
      const phi = uniform(0.10, 1.25);
      const az = uniform(0, 2 * Math.PI);
      const dir = [Math.sin(phi) * Math.cos(az), Math.cos(phi), Math.sin(phi) * Math.sin(az)];
      const tip = add(DOME_CENTER, mul(dir, uniform(1.40, 1.95)));
      const start = [uniform(-0.1, 0.1), TIE_Y + 0.3, uniform(-0.1, 0.1)];
      const mid = add(mix(start, tip, 0.5), [uniform(-0.12, 0.12), 0, uniform(-0.12, 0.12)]);
      drawCurve(start, mid, tip, TWIG_GREEN, TWIG_GREEN, 0.03);
      for (let w = 0; w < 5; w++) {
        const tw = norm([dir[0] + uniform(-0.9, 0.9),
                         dir[1] + uniform(-0.4, 0.9),
                         dir[2] + uniform(-0.9, 0.9)]);
        const end = add(tip, mul(tw, uniform(0.20, 0.40)));
        drawCurve(tip, mix(tip, end, 0.5), end, TWIG_GREEN, TWIG_GREEN, 0.03);
        const blossoms = randint(3, 5);
        for (let k = 0; k < blossoms; k++) {
          const c = add(end, [uniform(-0.1, 0.1), uniform(-0.1, 0.1), uniform(-0.1, 0.1)]);
          const g = randint(1, 2);
          const n = norm([uniform(-1, 1), 1, uniform(-1, 1)]);
          addPoint(c, n, WHITE, g, true);                       // a tiny cross of points
          addPoint(add(c, [0.04, 0, 0]), n, WHITE, g, true);
          addPoint(add(c, [-0.04, 0, 0]), n, WHITE, g, true);
          addPoint(add(c, [0, 0.04, 0]), n, WHITE, g, true);
          addPoint(add(c, [0, 0, 0.04]), n, WHITE, g, true);
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Assemble the bouquet
  // ---------------------------------------------------------------------
  function buildScene() {
    buildPaper();
    buildRibbon();

    // green collar of leaves framing the roses at the rim of the paper
    for (let i = 0; i < 9; i++) {
      const a = 2 * Math.PI * i / 9 + uniform(-0.2, 0.2);
      const base = [0.5 * Math.cos(a), -0.05, 0.5 * Math.sin(a)];
      buildLeaf(base, [Math.cos(a), 0.5, Math.sin(a)], uniform(0.95, 1.2), 0.42, 0.55);
    }

    // flower heads on a dome, laid out on a golden-angle spiral
    const order = ["red", "red", "red", "red", "red", "pink", "pink", "pink",
                   "yellow", "yellow", "purple", "purple"];
    for (let i = order.length - 1; i > 0; i--) {              // shuffle
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const count = order.length;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const phiMax = 1.2;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const phi = Math.acos(1 - t * (1 - Math.cos(phiMax)));
      const az = i * golden;
      const dir = [Math.sin(phi) * Math.cos(az), Math.cos(phi), Math.sin(phi) * Math.sin(az)];
      const head = add(DOME_CENTER, mul(dir, 1.30 + uniform(-0.04, 0.06)));
      const facing = norm(add(dir, [0, 0.2, 0]));
      const spec = FLOWER_TYPES[order[i]];
      const radius = uniform(0.52, 0.60) * spec.size;

      // stem: all stems start in a tight bundle below the paper and fan out
      const start = [uniform(-0.09, 0.09), STEM_BOTTOM, uniform(-0.09, 0.09)];
      const end = sub(head, mul(facing, 0.05));
      const ctrl = [start[0] + (end[0] - start[0]) * 0.10,
                    start[1] + (end[1] - start[1]) * 0.55,
                    start[2] + (end[2] - start[2]) * 0.10];
      const stem = drawCurve(start, ctrl, end, STEM_GREEN, STEM_LIGHT, 0.025, true);
      buildFlower(head, facing, radius, spec);

      if (rand() < 0.5) {                                     // a leaf under the bloom
        const p = stem[Math.floor(stem.length * uniform(0.82, 0.92))];
        const a = Math.atan2(p[2], p[0]) + uniform(-0.6, 0.6);
        buildLeaf(p, [Math.cos(a), 0.35, Math.sin(a)], uniform(0.55, 0.8), 0.28, 0.4);
      }
    }

    buildBabysBreath();
    buildBow();                                               // last, so it is never hidden
    return new Float32Array(raw);
  }

  // ---------------------------------------------------------------------
  // Renderer
  // ---------------------------------------------------------------------
  const W = GRID_W, H = GRID_H;
  const scale = Math.min(H / 4.3, W / 4.0);

  const points = buildScene();
  const N = points.length / STRIDE;

  const zbuf = new Float32Array(W * H);
  const has = new Uint8Array(W * H);          // 0 empty, 1 solid, 2 "*", 3 "o"
  const pr = new Float32Array(W * H), pg = new Float32Array(W * H), pb = new Float32Array(W * H);
  const pbr = new Float32Array(W * H);

  const canvas = document.getElementById("stage");
  canvas.width = W * CELL;
  canvas.height = H * CELL;
  const ctx = canvas.getContext("2d");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${CELL * 1.05}px "Courier New", monospace`;

  function cell(x, y, bg, fg, ch) {
    ctx.fillStyle = css(bg);
    ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    if (ch !== " ") {
      ctx.fillStyle = css(fg);
      ctx.fillText(ch, x * CELL + CELL / 2, y * CELL + CELL / 2);
    }
  }

  function render(angle, pitch, tick, style) {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cx = W / 2, cy = H * 0.47, D = CAMERA_DISTANCE;
    const [lx, ly, lz] = LIGHT;
    const [kx, ky, kz] = FILL;

    ctx.clearRect(0, 0, canvas.width, canvas.height);   // transparent background
    zbuf.fill(-1e9);
    has.fill(0);

    for (let i = 0; i < N; i++) {
      const o = i * STRIDE;
      const x = points[o], y = points[o + 1], z = points[o + 2];
      const x1 = x * ca + z * sa;                  // turntable rotation
      const z1 = z * ca - x * sa;
      const y2 = y * cp - z1 * sp;                 // camera pitch
      const z2 = y * sp + z1 * cp;
      const f = D / (D - z2);
      const fx = cx + x1 * scale * f, fy = cy - y2 * scale * f;
      if (fx < 0 || fy < 0) continue;
      const sx = fx | 0, sy = fy | 0;
      if (sx >= W || sy >= H) continue;
      const idx = sy * W + sx;
      if (z2 <= zbuf[idx]) continue;

      const nx = points[o + 3], ny = points[o + 4], nz = points[o + 5];
      const nx1 = nx * ca + nz * sa;
      const nz1 = nz * ca - nx * sa;
      const ny2 = ny * cp - nz1 * sp;
      const nz2 = ny * sp + nz1 * cp;
      let d = nx1 * lx + ny2 * ly + nz2 * lz;
      let d2 = nx1 * kx + ny2 * ky + nz2 * kz;
      if (points[o + 10]) { d = Math.abs(d); d2 = Math.abs(d2); }
      else { d = d > 0 ? d : 0; d2 = d2 > 0 ? d2 : 0; }

      zbuf[idx] = z2;
      has[idx] = 1 + points[o + 9];
      pr[idx] = points[o + 6]; pg[idx] = points[o + 7]; pb[idx] = points[o + 8];
      pbr[idx] = 0.58 + 0.50 * d + 0.28 * d2;
    }

    const rampMax = GLYPH_RAMP.length - 1;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const kind = has[idx];
        if (kind) {
          const col = [pr[idx], pg[idx], pb[idx]];
          const br = pbr[idx];
          const fg = scaleColor(col, br);
          if (style === "block") {
            cell(x, y, fg, fg, " ");
          } else if (kind >= 2) {                            // baby's breath blossoms
            cell(x, y, scaleColor(col, br * 0.8), [255, 255, 255], kind === 2 ? "*" : "o");
          } else {
            const g = Math.floor(Math.max(0, Math.min(1, (br - 0.45) / 0.85)) * rampMax);
            cell(x, y, scaleColor(col, br * 0.56),
                 scaleColor(col, Math.min(1.35, br * 1.15)), GLYPH_RAMP[g]);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Animation loop and controls
  // ---------------------------------------------------------------------
  const styleSelect = document.getElementById("style");
  const pauseBtn = document.getElementById("pause");

  let angle = 0, frame = 0, last = 0;
  let paused = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  pauseBtn.textContent = paused ? "Play" : "Pause";

  function draw() {
    const pitch = BASE_PITCH + 0.035 * Math.sin(frame * 0.03);   // gentle nod
    render(angle, pitch, frame, styleSelect.value);
  }

  function loop(now) {
    if (!paused && now - last >= FRAME_DELAY) {
      last = now;
      angle = (angle + ROTATION_SPEED) % (2 * Math.PI);
      frame++;
      draw();
    }
    requestAnimationFrame(loop);
  }

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "Play" : "Pause";
  });
  styleSelect.addEventListener("change", draw);

  draw();
  requestAnimationFrame(loop);
})();
