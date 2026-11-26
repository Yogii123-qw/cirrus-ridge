// Rendering: a small software 3D engine on a 2D canvas. Terrain is a heightfield
// mesh drawn back to front, the plane is a low-poly mesh, rings and the runway
// are projected polygons, and the HUD is screen-space glass. No libraries.
import { MISSIONS, PALETTE, WORLD } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const DEG = Math.PI / 180;
const FT_PER_M = 3.28084;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

function css(rgb, alpha) {
  return alpha === undefined
    ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
    : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

// The plane mesh, in local space: +X right wing, +Y up, +Z nose. A small
// high-wing bush plane: red fuselage, cream wings, blue trim, spinning prop.
const PLANE_VERTS = [
  // Fuselage spine (nose, tail top, tail bottom, belly).
  [0, 0.55, 4.6], [0, 0.9, -3.4], [0, -0.35, -3.4], [0, -0.55, 3.2],
  // Nose ring.
  [0.55, 0.35, 4.2], [-0.55, 0.35, 4.2], [0.55, -0.35, 4.2], [-0.55, -0.35, 4.2],
  // Canopy.
  [0, 1.05, 1.6], [0, 1.05, -0.6],
  // Wing tips (high wing).
  [5.4, 0.75, 0.4], [-5.4, 0.75, 0.4], [5.4, 0.75, -1.1], [-5.4, 0.75, -1.1],
  // Tailplane tips.
  [1.9, 0.55, -3.3], [-1.9, 0.55, -3.3], [1.9, 0.55, -4.0], [-1.9, 0.55, -4.0],
  // Fin tip.
  [0, 2.0, -3.6],
  // Wheels.
  [0.75, -0.95, 2.6], [-0.75, -0.95, 2.6], [0, -0.95, -2.6],
];
const PLANE_FACES = [
  { v: [0, 4, 5], c: '#d8442c' }, { v: [0, 5, 1], c: '#c73a24' },
  { v: [0, 1, 6], c: '#d8442c' }, { v: [0, 6, 4], c: '#e0583f' },
  { v: [3, 7, 6], c: '#b33220' }, { v: [3, 6, 1], c: '#a52c1c' },
  { v: [3, 1, 5], c: '#b33220' }, { v: [3, 5, 7], c: '#c73a24' },
  { v: [4, 6, 7], c: '#8f2a1a' }, { v: [4, 7, 5], c: '#8f2a1a' },
  { v: [2, 0, 4], c: '#e0583f' }, { v: [2, 4, 6], c: '#d8442c' },
  // Canopy glass.
  { v: [8, 0, 9], c: '#9fc8e8' }, { v: [8, 9, 2], c: '#7fb2e0' },
  // Wings.
  { v: [10, 12, 13], c: '#f0ead8' }, { v: [10, 13, 11], c: '#e6dfc9' },
  { v: [10, 1, 12], c: '#d8d0b8' }, { v: [11, 13, 1], c: '#d8d0b8' },
  // Tailplane.
  { v: [14, 16, 17], c: '#f0ead8' }, { v: [14, 17, 15], c: '#e6dfc9' },
  // Fin.
  { v: [18, 1, 2], c: '#1d3557' },
  // Wheels.
  { v: [19, 19, 19], c: '#222222' },
];

export function createRenderer(canvas, world) {
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let dpr = 1;
  const skyTop = hexRgb(PALETTE.skyTop);
  const skyHorizon = hexRgb(PALETTE.skyHorizon);
  const fogRgb = hexRgb(PALETTE.skyHorizon);
  const grassLow = hexRgb(PALETTE.grassLow);
  const grassHigh = hexRgb(PALETTE.grassHigh);
  const fieldRgb = hexRgb(PALETTE.field);
  const rockRgb = hexRgb(PALETTE.rock);
  const snowRgb = hexRgb(PALETTE.snow);
  const waterRgb = hexRgb(PALETTE.water);

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Camera basis from the plane attitude. The chase camera sits behind and
  // above the plane and rolls partway with it, so banks read on screen.
  function cameraBasis(state) {
    const h = state.heading * DEG;
    const p = state.pitch * DEG;
    const f = [
      Math.sin(h) * Math.cos(p),
      Math.sin(p),
      Math.cos(h) * Math.cos(p),
    ];
    let r = [Math.cos(h), 0, -Math.sin(h)];
    let u = [
      f[1] * r[2] - f[2] * r[1],
      f[2] * r[0] - f[0] * r[2],
      f[0] * r[1] - f[1] * r[0],
    ];
    // Roll the camera with the plane, at 60% of its bank.
    const bank = state.bank * 0.6 * DEG;
    const cb = Math.cos(bank);
    const sb = Math.sin(bank);
    const r2 = [
      r[0] * cb + u[0] * sb,
      r[1] * cb + u[1] * sb,
      r[2] * cb + u[2] * sb,
    ];
    const u2 = [
      u[0] * cb - r[0] * sb,
      u[1] * cb - r[1] * sb,
      u[2] * cb - r[2] * sb,
    ];
    return { f, r: r2, u: u2 };
  }

  function makeProjector(cam, focal) {
    return function project(x, y, z) {
      const dx = x - cam.x;
      const dy = y - cam.y;
      const dz = z - cam.z;
      const cx = dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2];
      const cy = dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2];
      const cz = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
      if (cz < 0.6) return null;
      const s = focal / cz;
      return { x: width / 2 + cx * s, y: height / 2 - cy * s, d: cz, s };
    };
  }

  function terrainColor(x, z, h, slope) {
    let c;
    if (h < -20) c = waterRgb;
    else if (h > 520) c = snowRgb;
    else if (h > 340) c = mixRgb(rockRgb, snowRgb, (h - 340) / 180);
    else if (h > 130) c = mixRgb(grassHigh, rockRgb, (h - 130) / 210);
    else c = mixRgb(grassLow, grassHigh, clamp(h / 130, 0, 1));
    // Field patches on the valley floor: warm rectangles of farmland.
    if (h > -10 && h < 120) {
      const fx = Math.abs(((x / 700) % 1 + 1) % 1 - 0.5);
      const fz = Math.abs(((z / 900) % 1 + 1) % 1 - 0.5);
      if (fx < 0.22 && fz < 0.3) c = mixRgb(c, fieldRgb, 0.55);
    }
    const shade = clamp(1 - slope * 0.9, 0.55, 1);
    return [Math.round(c[0] * shade), Math.round(c[1] * shade), Math.round(c[2] * shade)];
  }

  function drawSky(camPos, basis, focal, time) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, PALETTE.skyTop);
    grad.addColorStop(0.55, PALETTE.skyMid);
    grad.addColorStop(0.78, PALETTE.skyHorizon);
    grad.addColorStop(1, '#d9c9a3');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    // Low sun, west-southwest, warm.
    const sunDir = [-0.62, 0.24, -0.45];
    const project = makeProjector(
      { x: camPos.x, y: camPos.y, z: camPos.z, ...basis }, focal,
    );
    const sun = project(
      camPos.x + sunDir[0] * 4000,
      camPos.y + sunDir[1] * 4000,
      camPos.z + sunDir[2] * 4000,
    );
    if (sun) {
      const glow = ctx.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 130);
      glow.addColorStop(0, PALETTE.sunGlow);
      glow.addColorStop(1, 'rgba(255, 236, 170, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sun.x - 140, sun.y - 140, 280, 280);
      ctx.fillStyle = PALETTE.sun;
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, 17, 0, Math.PI * 2);
      ctx.fill();
    }
    void time;
  }

  function drawClouds(camPos, basis, focal) {
    const project = makeProjector(
      { x: camPos.x, y: camPos.y, z: camPos.z, ...basis }, focal,
    );
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const cloud of world.clouds) {
      const p = project(cloud.x, cloud.y, cloud.z);
      if (!p || p.d < 50) continue;
      const r = cloud.r * p.s;
      if (r < 2) continue;
      const alpha = clamp(1 - p.d / 9000, 0.15, 0.85);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(p.x - r * 0.5, p.y + r * 0.08, r * 0.6, r * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(p.x + r * 0.55, p.y + r * 0.06, r * 0.65, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTerrain(camPos, basis, focal, state) {
    const project = makeProjector(
      { x: camPos.x, y: camPos.y, z: camPos.z, ...basis }, focal,
    );
    const cells = WORLD.gridCells;
    const cell = WORLD.cellSize;
    const half = (cells * cell) / 2;
    // Grid centred ahead of the camera, snapped to the cell lattice.
    const cx = Math.round((camPos.x + basis.f[0] * half * 0.7) / cell) * cell;
    const cz = Math.round((camPos.z + basis.f[2] * half * 0.7) / cell) * cell;
    const n = cells + 1;
    const proj = new Array(n * n);
    const heights = new Array(n * n);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = cx - half + i * cell;
        const z = cz - half + j * cell;
        const h = world.terrainHeight(x, z);
        heights[j * n + i] = h;
        proj[j * n + i] = project(x, h, z);
      }
    }
    const tris = [];
    for (let j = 0; j < cells; j += 1) {
      for (let i = 0; i < cells; i += 1) {
        const a = proj[j * n + i];
        const b = proj[j * n + i + 1];
        const c = proj[(j + 1) * n + i + 1];
        const d = proj[(j + 1) * n + i];
        if (!a || !b || !c || !d) continue;
        const x = cx - half + i * cell;
        const z = cz - half + j * cell;
        const h0 = heights[j * n + i];
        const h1 = heights[j * n + i + 1];
        const h2 = heights[(j + 1) * n + i];
        const slope = Math.max(Math.abs(h1 - h0), Math.abs(h2 - h0)) / cell;
        const col = terrainColor(x + cell / 2, z + cell / 2, (h0 + h1 + h2) / 3, slope);
        const depth = (a.d + b.d + c.d + d.d) / 4;
        const fog = clamp((depth - 900) / 3200, 0, 0.82);
        const mixed = mixRgb(col, fogRgb, fog);
        tris.push({ p: [a, b, c], col: mixed, depth });
        tris.push({ p: [a, c, d], col: mixed, depth });
      }
    }
    tris.sort((m, q) => q.depth - m.depth);
    for (const tri of tris) {
      ctx.fillStyle = css(tri.col);
      ctx.beginPath();
      ctx.moveTo(tri.p[0].x, tri.p[0].y);
      ctx.lineTo(tri.p[1].x, tri.p[1].y);
      ctx.lineTo(tri.p[2].x, tri.p[2].y);
      ctx.closePath();
      ctx.fill();
    }
    void state;
  }

  function drawRunway(camPos, basis, focal) {
    const project = makeProjector(
      { x: camPos.x, y: camPos.y, z: camPos.z, ...basis }, focal,
    );
    const hw = 14;
    const z0 = WORLD.runwayZ0;
    const z1 = WORLD.runwayZ1;
    const y = 0.4;
    function quad(x0, zA, x1, zB, fill) {
      const p0 = project(x0, y, zA);
      const p1 = project(x1, y, zA);
      const p2 = project(x1, y, zB);
      const p3 = project(x0, y, zB);
      if (!p0 || !p1 || !p2 || !p3) return;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.fill();
    }
    quad(-hw, z0, hw, z1, PALETTE.runway);
    quad(-hw, z0, -hw + 1.2, z1, PALETTE.runwayEdge);
    quad(hw - 1.2, z0, hw, z1, PALETTE.runwayEdge);
    // Centreline dashes.
    for (let z = z0 + 30; z < z1 - 20; z += 60) {
      quad(-1.1, z, 1.1, z + 26, PALETTE.runwayEdge);
    }
    // Threshold bars at both ends.
    for (const zt of [z0 + 12, z1 - 34]) {
      for (let k = -3; k <= 3; k += 1) {
        if (k === 0) continue;
        quad(k * 3.4 - 1.1, zt, k * 3.4 + 1.1, zt + 18, PALETTE.runwayEdge);
      }
    }
    // Touchdown zone marks.
    for (const zt of [z0 + 130, z1 - 170]) {
      quad(-8, zt, -4.5, zt + 22, PALETTE.runwayEdge);
      quad(4.5, zt, 8, zt + 22, PALETTE.runwayEdge);
    }
  }

  function drawHangars(camPos, basis, focal) {
    const project = makeProjector(
      { x: camPos.x, y: camPos.y, z: camPos.z, ...basis }, focal,
    );
    const spots = [
      { x: 42, z: -120, w: 26, d: 20, h: 9, c: '#7d7468' },
      { x: 44, z: -80, w: 20, d: 16, h: 7, c: '#8a6f5c' },
      { x: -44, z: -150, w: 22, d: 18, h: 8, c: '#6e7d6a' },
    ];
    for (const s of spots) {
      const y0 = world.terrainHeight(s.x, s.z);
      const corners = [
        [s.x - s.w / 2, y0, s.z - s.d / 2], [s.x + s.w / 2, y0, s.z - s.d / 2],
        [s.x + s.w / 2, y0, s.z + s.d / 2], [s.x - s.w / 2, y0, s.z + s.d / 2],
        [s.x - s.w / 2, y0 + s.h, s.z - s.d / 2], [s.x + s.w / 2, y0 + s.h, s.z - s.d / 2],
        [s.x + s.w / 2, y0 + s.h, s.z + s.d / 2], [s.x - s.w / 2, y0 + s.h, s.z + s.d / 2],
      ];
      const p = corners.map(([x, y, z]) => project(x, y, z));
      if (p.some((q) => !q)) continue;
      // Roof.
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.moveTo(p[4].x, p[4].y);
      ctx.lineTo(p[5].x, p[5].y);
      ctx.lineTo(p[6].x, p[6].y);
      ctx.lineTo(p[7].x, p[7].y);
      ctx.closePath();
      ctx.fill();
      // Two visible walls.
      ctx.fillStyle = '#5d564c';
      ctx.beginPath();
      ctx.moveTo(p[1].x, p[1].y);
      ctx.lineTo(p[2].x, p[2].y);
      ctx.lineTo(p[6].x, p[6].y);
      ctx.lineTo(p[5].x, p[5].y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6a6258';
      ctx.beginPath();
      ctx.moveTo(p[2].x, p[2].y);
      ctx.lineTo(p[3].x, p[3].y);
      ctx.lineTo(p[7].x, p[7].y);
      ctx.lineTo(p[6].x, p[6].y);
      ctx.closePath();
      ctx.fill();
    }
    // Windsock by the threshold.
    const wx = -22;
    const wz = WORLD.runwayZ0 + 40;
    const wy = world.terrainHeight(wx, wz);
    const top = project(wx, wy + 7, wz);
    const base = project(wx, wy, wz);
    if (top && base) {
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      const sock = project(wx + 4, wy + 6.4, wz);
      if (sock) {
        ctx.fillStyle = '#ff7a2e';
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(sock.x, sock.y - 2);
        ctx.lineTo(sock.x, sock.y + 2);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawRings(camPos, basis, focal, state, time) {
    const project = makeProjector(
      { x: camPos.x, y: camPos.y, z: camPos.z, ...basis }, focal,
    );
    const SEG = 26;
    for (let i = 0; i < state.rings.length; i += 1) {
      const ring = state.rings[i];
      const isNext = i === state.nextRing;
      const color = ring.passed ? PALETTE.ringPassed : isNext ? PALETTE.ringNext : PALETTE.ringFar;
      const dir = ring.dir || { x: 0, z: 1 };
      // Ring plane: perpendicular to the course direction.
      const px = -dir.z;
      const pz = dir.x;
      const pts = [];
      let visible = true;
      for (let s = 0; s <= SEG; s += 1) {
        const a = (s / SEG) * Math.PI * 2;
        const ox = px * Math.cos(a) * ring.radius;
        const oy = Math.sin(a) * ring.radius;
        const oz = pz * Math.cos(a) * ring.radius;
        const p = project(ring.x + ox, ring.y + oy, ring.z + oz);
        if (!p) { visible = false; break; }
        pts.push(p);
      }
      if (!visible || pts.length < 3) continue;
      const dist = Math.hypot(
        ring.x - camPos.x, ring.y - camPos.y, ring.z - camPos.z,
      );
      const alpha = clamp(1.15 - dist / 2600, 0.25, 1);
      const pulse = isNext ? 1 + 0.25 * Math.sin(time * 5) : 1;
      const wdt = clamp(900 / Math.max(dist, 60), 2, 14) * pulse;
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = wdt * 2.4;
      ctx.globalAlpha = alpha * 0.22;
      ctx.beginPath();
      pts.forEach((p, k) => { if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = wdt;
      ctx.beginPath();
      pts.forEach((p, k) => { if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (isNext) {
        const c = project(ring.x, ring.y, ring.z);
        if (c) {
          ctx.fillStyle = color;
          ctx.font = `700 ${Math.max(13, clamp(1400 / Math.max(dist, 80), 13, 26))}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(`RING ${i + 1}`, c.x, c.y - ring.radius * c.s - 12);
        }
      }
    }
  }

  function drawPlaneShadow(camPos, basis, focal, state) {
    const project = makeProjector(
      { x: camPos.x, y: camPos.y, z: camPos.z, ...basis }, focal,
    );
    const gy = world.terrainHeight(state.x, state.z);
    if (state.y - gy > 400) return;
    const p = project(state.x, gy + 0.5, state.z);
    if (!p) return;
    const r = clamp(1400 / Math.max(p.d, 80), 6, 60);
    const alpha = clamp(0.35 - (state.y - gy) / 1200, 0.06, 0.35);
    ctx.fillStyle = `rgba(10, 14, 20, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlane(camPos, basis, focal, state, time) {
    const project = makeProjector(
      { x: camPos.x, y: camPos.y, z: camPos.z, ...basis }, focal,
    );
    const h = state.heading * DEG;
    const p = state.pitch * DEG;
    const f = [
      Math.sin(h) * Math.cos(p),
      Math.sin(p),
      Math.cos(h) * Math.cos(p),
    ];
    let r = [Math.cos(h), 0, -Math.sin(h)];
    let u = [
      f[1] * r[2] - f[2] * r[1],
      f[2] * r[0] - f[0] * r[2],
      f[0] * r[1] - f[1] * r[0],
    ];
    const bank = state.bank * DEG;
    const cb = Math.cos(bank);
    const sb = Math.sin(bank);
    const r2 = [r[0] * cb + u[0] * sb, r[1] * cb + u[1] * sb, r[2] * cb + u[2] * sb];
    const u2 = [u[0] * cb - r[0] * sb, u[1] * cb - r[1] * sb, u[2] * cb - r[2] * sb];
    r = r2;
    u = u2;
    const worldVerts = PLANE_VERTS.map(([lx, ly, lz]) => [
      state.x + r[0] * lx + u[0] * ly + f[0] * lz,
      state.y + r[1] * lx + u[1] * ly + f[1] * lz,
      state.z + r[2] * lx + u[2] * ly + f[2] * lz,
    ]);
    const faces = [];
    for (const face of PLANE_FACES) {
      if (face.v[0] === face.v[1]) continue; // wheel placeholders carry no area
      const p0 = project(...worldVerts[face.v[0]]);
      const p1 = project(...worldVerts[face.v[1]]);
      const p2 = project(...worldVerts[face.v[2]]);
      if (!p0 || !p1 || !p2) continue;
      const depth = (p0.d + p1.d + p2.d) / 3;
      faces.push({ p: [p0, p1, p2], c: face.c, depth });
    }
    faces.sort((a, b) => b.depth - a.depth);
    for (const face of faces) {
      ctx.fillStyle = face.c;
      ctx.beginPath();
      ctx.moveTo(face.p[0].x, face.p[0].y);
      ctx.lineTo(face.p[1].x, face.p[1].y);
      ctx.lineTo(face.p[2].x, face.p[2].y);
      ctx.closePath();
      ctx.fill();
    }
    // Spinning prop disc at the nose.
    const nose = project(
      state.x + f[0] * 4.7, state.y + f[1] * 4.7, state.z + f[2] * 4.7,
    );
    if (nose) {
      const pr = clamp(900 / Math.max(nose.d, 40), 8, 90);
      ctx.strokeStyle = `rgba(40, 40, 44, ${clamp(0.25 + state.throttle * 0.45, 0, 0.7)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(nose.x, nose.y, pr * 0.92, pr * 0.92, 0, 0, Math.PI * 2);
      ctx.stroke();
      const a = time * (4 + state.throttle * 30);
      ctx.beginPath();
      ctx.moveTo(nose.x - Math.cos(a) * pr, nose.y - Math.sin(a) * pr);
      ctx.lineTo(nose.x + Math.cos(a) * pr, nose.y + Math.sin(a) * pr);
      ctx.stroke();
    }
    // Wheels when the gear is down.
    if (state.gearDown) {
      for (const [lx, ly, lz] of [[0.75, -0.95, 2.6], [-0.75, -0.95, 2.6], [0, -0.95, -2.6]]) {
        const wp = project(
          state.x + r[0] * lx + u[0] * ly + f[0] * lz,
          state.y + r[1] * lx + u[1] * ly + f[1] * lz,
          state.z + r[2] * lx + u[2] * ly + f[2] * lz,
        );
        if (!wp) continue;
        ctx.fillStyle = '#1c1c20';
        ctx.beginPath();
        ctx.arc(wp.x, wp.y, clamp(300 / Math.max(wp.d, 30), 2, 9), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---- HUD ----

  function tape(value, min, max, x, y, w, h, unit, step) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = 'rgba(8, 16, 28, 0.55)';
    ctx.fillRect(x, y, w, h);
    const range = max - min;
    const pxPerUnit = h / range;
    const midY = y + h / 2;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const first = Math.floor((value - range / 2) / step) * step;
    for (let v = first; v <= value + range / 2 + step; v += step) {
      const yy = midY - (v - value) * pxPerUnit;
      if (yy < y - 4 || yy > y + h + 4) continue;
      const major = v % (step * 2) === 0;
      ctx.strokeStyle = 'rgba(232, 244, 255, 0.7)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x + w - (major ? 16 : 9), yy);
      ctx.lineTo(x + w, yy);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = PALETTE.hud;
        ctx.fillText(String(Math.round(v)), x + 6, yy + 4);
      }
    }
    ctx.restore();
    // Current value box.
    ctx.fillStyle = 'rgba(8, 16, 28, 0.85)';
    ctx.fillRect(x, midY - 13, w, 26);
    ctx.strokeStyle = PALETTE.hud;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, midY - 13, w, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(value)}`, x + w / 2, midY + 5);
    ctx.fillStyle = 'rgba(232, 244, 255, 0.75)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText(unit, x + w / 2, y + h + 14);
  }

  function headingTape(heading) {
    const w = Math.min(420, width * 0.5);
    const x = (width - w) / 2;
    const y = 14;
    const h = 34;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = 'rgba(8, 16, 28, 0.55)';
    ctx.fillRect(x, y, w, h);
    const pxPerDeg = w / 90;
    const midX = x + w / 2;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let d = -45; d <= 45; d += 5) {
      let deg = Math.round(heading + d);
      deg = ((deg % 360) + 360) % 360;
      const xx = midX + d * pxPerDeg;
      const major = deg % 30 === 0;
      ctx.strokeStyle = 'rgba(232, 244, 255, 0.7)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(xx, y + h - (major ? 12 : 7));
      ctx.lineTo(xx, y + h);
      ctx.stroke();
      if (major) {
        const label = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : String(deg);
        ctx.fillStyle = PALETTE.hud;
        ctx.fillText(label, xx, y + 14);
      }
    }
    ctx.restore();
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.beginPath();
    ctx.moveTo(midX, y + h - 2);
    ctx.lineTo(midX - 6, y + h + 8);
    ctx.lineTo(midX + 6, y + h + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText(`${String(Math.round(heading)).padStart(3, '0')}°`, midX, y + h + 24);
  }

  function artificialHorizon(state) {
    const cx = width / 2;
    const cy = height * 0.46;
    const r = 74;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-state.bank * DEG);
    const pitchPx = state.pitch * 2.4;
    ctx.fillStyle = '#3f8fd2';
    ctx.fillRect(-r - 4, -r - 4 - pitchPx, r * 2 + 8, r + 4 + pitchPx);
    ctx.fillStyle = '#7a5a34';
    ctx.fillRect(-r - 4, pitchPx, r * 2 + 8, r + 4);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r - 4, pitchPx);
    ctx.lineTo(r + 4, pitchPx);
    ctx.stroke();
    ctx.restore();
    // Fixed wings marker and ring.
    ctx.strokeStyle = PALETTE.hud;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 34, cy);
    ctx.lineTo(cx - 12, cy);
    ctx.moveTo(cx + 12, cy);
    ctx.lineTo(cx + 34, cy);
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx, cy + 4);
    ctx.stroke();
    ctx.fillStyle = PALETTE.hudAmber;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r - 2);
    ctx.lineTo(cx - 5, cy - r - 10);
    ctx.lineTo(cx + 5, cy - r - 10);
    ctx.closePath();
    ctx.fill();
  }

  function drawHud(state, worldApi, time) {
    const altAgl = Math.round((state.y - worldApi.terrainHeight(state.x, state.z)) * FT_PER_M);
    const altMsl = Math.round(state.y * FT_PER_M);
    // Tapes.
    tape(state.speed, Math.max(0, state.speed - 40), state.speed + 40, 16, height * 0.3, 62, 220, 'KT', 10);
    tape(altAgl, Math.max(0, altAgl - 500), altAgl + 500, width - 78, height * 0.3, 62, 220, 'FT AGL', 100);
    headingTape(state.heading);
    artificialHorizon(state);

    // Next ring pointer: an edge arrow and distance.
    const ring = state.rings[state.nextRing];
    if (ring && state.screen === 'play') {
      const dx = ring.x - state.x;
      const dz = ring.z - state.z;
      const bearing = (Math.atan2(dx, dz) / DEG + 360) % 360;
      let rel = bearing - state.heading;
      if (rel > 180) rel -= 360;
      if (rel < -180) rel += 360;
      const distM = Math.round(Math.hypot(dx, ring.y - state.y, dz));
      ctx.fillStyle = 'rgba(8, 16, 28, 0.72)';
      const bw = 150;
      ctx.fillRect(width / 2 - bw / 2, 62, bw, 30);
      ctx.strokeStyle = PALETTE.ringNext;
      ctx.lineWidth = 1;
      ctx.strokeRect(width / 2 - bw / 2, 62, bw, 30);
      ctx.fillStyle = PALETTE.ringNext;
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const arrow = rel > 12 ? '▶' : rel < -12 ? '◀' : '▲';
      ctx.fillText(`${arrow} RING ${state.nextRing + 1}  ${distM}m`, width / 2, 82);
    }

    // Score block, top right. A dark chip behind it keeps the white text
    // readable when a bright cloud drifts past that corner.
    ctx.fillStyle = 'rgba(8, 16, 28, 0.55)';
    ctx.beginPath();
    ctx.roundRect(width - 176, 14, 168, 106, 10);
    ctx.fill();
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(`${state.score}`, width - 16, 40);
    ctx.fillStyle = 'rgba(232, 244, 255, 0.8)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('SCORE', width - 16, 56);
    ctx.fillText(`${state.mission.name.toUpperCase()}`, width - 16, 72);
    const mm = Math.floor(state.time / 60);
    const ss = Math.floor(state.time % 60);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillText(`${mm}:${String(ss).padStart(2, '0')}`, width - 16, 94);
    ctx.fillStyle = 'rgba(232, 244, 255, 0.8)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(`RINGS ${state.ringsPassed}/${state.rings.length}`, width - 16, 110);

    // Throttle and fuel, bottom left.
    const bx = 16;
    const by = height - 66;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(232, 244, 255, 0.8)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('THR', bx, by - 6);
    ctx.fillStyle = 'rgba(8, 16, 28, 0.6)';
    ctx.fillRect(bx + 34, by - 16, 150, 12);
    ctx.fillStyle = state.throttle > 0.85 ? PALETTE.hudAmber : PALETTE.hudGreen;
    ctx.fillRect(bx + 34, by - 16, 150 * state.throttle, 12);
    ctx.fillStyle = 'rgba(232, 244, 255, 0.8)';
    ctx.fillText('FUEL', bx, by + 16);
    ctx.fillStyle = 'rgba(8, 16, 28, 0.6)';
    ctx.fillRect(bx + 34, by + 6, 150, 12);
    ctx.fillStyle = state.fuel < 20 ? PALETTE.hudRed : PALETTE.hudGreen;
    ctx.fillRect(bx + 34, by + 6, 150 * (state.fuel / 100), 12);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(`${Math.round(state.fuel)}%`, bx + 192, by + 16);

    // Gear and flaps pills, bottom right.
    const pills = [
      `GEAR ${state.gearDown ? 'DOWN' : 'UP'}`,
      `FLAPS ${state.flapsDown ? 'DOWN' : 'UP'}`,
      state.onGround ? 'ON GROUND' : state.stalled ? 'STALL' : 'AIRBORNE',
    ];
    ctx.font = '700 11px system-ui, sans-serif';
    let px = width - 16;
    for (const pill of pills) {
      const wdt = ctx.measureText(pill).width + 18;
      ctx.fillStyle = pill === 'STALL' ? 'rgba(255, 90, 78, 0.85)' : 'rgba(8, 16, 28, 0.72)';
      ctx.beginPath();
      ctx.roundRect(px - wdt, height - 40, wdt, 24, 12);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(pill, px - wdt / 2, height - 24);
      px -= wdt + 8;
    }

    // Warnings.
    if (state.stalled && state.airborne) {
      const blink = Math.sin(time * 10) > 0;
      if (blink) {
        ctx.fillStyle = PALETTE.hudRed;
        ctx.font = '800 26px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('STALL', width / 2, height * 0.3);
      }
    }
    if (state.fuel <= 0 && state.airborne) {
      ctx.fillStyle = PALETTE.hudRed;
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FUEL EMPTY: GLIDING', width / 2, height * 0.3 + 28);
    }
    if (altAgl < 150 && state.verticalSpeed < -800 && state.airborne) {
      ctx.fillStyle = PALETTE.hudAmber;
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PULL UP', width / 2, height * 0.62);
    }

    // Announcement banner.
    if (state.message && state.time < state.messageUntil) {
      ctx.fillStyle = 'rgba(8, 16, 28, 0.72)';
      ctx.font = '700 15px system-ui, sans-serif';
      const tw = ctx.measureText(state.message).width + 32;
      ctx.fillRect(width / 2 - tw / 2, 104, tw, 32);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(state.message, width / 2, 125);
    }
    void altMsl;
  }

  // ---- Screens ----

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(8, 16, 28, 0.78)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232, 244, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawTitle(state, bests, selected) {
    const cx = width / 2;
    const top = height * 0.14;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 54px system-ui, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18;
    ctx.fillText('CIRRUS RIDGE', cx, top + 54);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = '600 17px system-ui, sans-serif';
    ctx.fillText('A valley, a little red plane, and the rings between the ridges.', cx, top + 88);
    const pw = Math.min(560, width - 48);
    const px = cx - pw / 2;
    const py = top + 118;
    panel(px, py, pw, 248);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(232, 244, 255, 0.85)';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText('CHOOSE A MISSION', px + 24, py + 30);
    state.missionList = [];
    for (let i = 0; i < MISSIONS.length; i += 1) {
      const m = MISSIONS[i];
      const ry = py + 58 + i * 52;
      const sel = i === selected;
      if (sel) {
        ctx.fillStyle = 'rgba(255, 176, 46, 0.22)';
        ctx.beginPath();
        ctx.roundRect(px + 12, ry - 22, pw - 24, 44, 10);
        ctx.fill();
        ctx.strokeStyle = PALETTE.hudAmber;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = sel ? '#ffffff' : 'rgba(232, 244, 255, 0.92)';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillText(`${i + 1}. ${m.name}`, px + 26, ry - 2);
      ctx.fillStyle = 'rgba(232, 244, 255, 0.7)';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(m.short, px + 26, ry + 16);
      const best = bests[m.id];
      if (best !== undefined) {
        ctx.fillStyle = PALETTE.hudAmber;
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`BEST ${best}`, px + pw - 26, ry - 2);
        ctx.textAlign = 'left';
      }
      state.missionList.push({ x: px + 12, y: ry - 22, w: pw - 24, h: 44, index: i });
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('Arrows pick a mission. Enter or click to fly. In the air: arrows fly, W/S throttle, G gear, F flaps.', cx, py + 228);
  }

  function drawPaused() {
    ctx.fillStyle = 'rgba(6, 10, 18, 0.55)';
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 40px system-ui, sans-serif';
    ctx.fillText('PAUSED', width / 2, height / 2 - 8);
    ctx.fillStyle = 'rgba(232, 244, 255, 0.85)';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText('Press P or Enter to keep flying.', width / 2, height / 2 + 26);
  }

  function drawOver(state, bests) {
    ctx.fillStyle = 'rgba(6, 10, 18, 0.5)';
    ctx.fillRect(0, 0, width, height);
    const pw = Math.min(520, width - 48);
    const px = width / 2 - pw / 2;
    const py = height / 2 - 150;
    panel(px, py, pw, 300);
    const title = state.crashed ? 'DOWN IN THE VALLEY'
      : state.complete ? 'MISSION COMPLETE' : 'LANDED SAFELY';
    ctx.textAlign = 'center';
    ctx.fillStyle = state.crashed ? PALETTE.hudRed : PALETTE.hudGreen;
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.fillText(title, width / 2, py + 52);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.fillText(`${state.score}`, width / 2, py + 116);
    ctx.fillStyle = 'rgba(232, 244, 255, 0.8)';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('POINTS', width / 2, py + 138);
    const mins = Math.floor(state.time / 60);
    const secs = Math.floor(state.time % 60);
    const lines = [
      `Rings flown: ${state.ringsPassed} of ${state.rings.length}`,
      `Best combo: ${state.bestCombo}x`,
      `Time: ${mins}:${String(secs).padStart(2, '0')}`,
      `Distance: ${(state.distanceFlown / 1000).toFixed(1)} km`,
    ];
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232, 244, 255, 0.92)';
    lines.forEach((line, i) => ctx.fillText(line, width / 2, py + 172 + i * 22));
    const best = bests[state.mission.id];
    if (best !== undefined && state.score >= best) {
      ctx.fillStyle = PALETTE.hudAmber;
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillText('NEW BEST FOR THIS MISSION', width / 2, py + 268);
    }
    ctx.fillStyle = 'rgba(232, 244, 255, 0.85)';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('Enter: fly again.  Esc: mission menu.', width / 2, py + 292);
  }

  // ---- Main draw ----

  function draw(state, screen, bests, selected, time) {
    resize();
    const basis = cameraBasis(state);
    const camPos = {
      x: state.x - basis.f[0] * 15 + basis.u[0] * 4.6,
      y: state.y - basis.f[1] * 15 + basis.u[1] * 4.6,
      z: state.z - basis.f[2] * 15 + basis.u[2] * 4.6,
    };
    const focal = (height / 2) / Math.tan(35 * DEG);
    const cam = { x: camPos.x, y: camPos.y, z: camPos.z, ...basis };
    drawSky(camPos, basis, focal, time);
    drawClouds(camPos, basis, focal);
    drawTerrain(camPos, basis, focal, state);
    drawRunway(camPos, basis, focal);
    drawHangars(camPos, basis, focal);
    drawRings(camPos, basis, focal, state, time);
    drawPlaneShadow(camPos, basis, focal, state);
    drawPlane(camPos, basis, focal, state, time);
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) {
      drawHud(state, world, time);
    }
    if (screen === SCREEN_TITLE) drawTitle(state, bests, selected);
    if (screen === SCREEN_PAUSED) drawPaused();
    if (screen === SCREEN_OVER) drawOver(state, bests);
  }

  return { draw, resize };
}
