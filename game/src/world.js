// The world: terrain, runway, courses and the flight model. The plane flies in
// metres; the HUD converts to feet and knots. Terrain height comes from layered
// noise with a valley carved along the runway and a canyon cut north of it.
import { FLIGHT, MISSIONS, WORLD } from './config.js';
import { createRandom, fbm2 } from './random.js';

export const EVENT_RING = 'ring';
export const EVENT_CRASH = 'crash';
export const EVENT_LAND = 'land';
export const EVENT_COMPLETE = 'complete';
export const EVENT_FUEL_EMPTY = 'fuel-empty';
export const EVENT_STALL = 'stall';

const FT_PER_M = 3.28084;
const KT_PER_MS = 1.94384;
const DEG = Math.PI / 180;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Distance from a point to the runway centreline, along the strip. The
// centreline runs 2200 m past the south end: the approach corridor over it
// is flat valley floor, so a landing approach never meets a hillside.
function runwayDistance(x, z) {
  const dz = clamp(z, -2200, WORLD.runwayZ1);
  const dx = x;
  const along = z - dz;
  return Math.hypot(dx, along);
}

export function createWorld(random) {
  const seed = Math.floor(random() * 100000) | 0;
  const rng = createRandom(seed);

  // Terrain height in metres at world (x, z). A broad valley runs north-south
  // along the runway; ridges rise east and west; a canyon cuts north of the
  // field where the time-trial gates sit; a lake fills the low south end.
  function terrainHeight(x, z) {
    const valley = Math.exp(-((x / 1100) ** 2));
    const ridge = fbm2(x * 0.00045 + 7.3, z * 0.00045 - 2.1, seed, 4);
    const hills = fbm2(x * 0.0016 + 1.7, z * 0.0016 + 4.9, seed, 3);
    let h = ridge * WORLD.ridgeHeight * (1 - valley * 0.75)
      + hills * WORLD.hillHeight * (1 - valley * 0.5)
      - 60;
    // Canyon: a narrow slot cut through the eastern ridge, north of the field.
    const canyon = Math.exp(-(((x - 420) / 130) ** 2)) * smoothstep(500, 1400, z);
    h -= canyon * 200;
    h += canyon * 60 * fbm2(x * 0.004, z * 0.004, seed + 5, 2);
    // Flatten the strip and its apron so the runway sits on level ground.
    // The flat valley floor runs wide around the centreline, so an approach
    // a little off the centreline still meets level ground.
    const d = runwayDistance(x, z);
    const flat = smoothstep(160, 60, d);
    h = h * (1 - flat);
    // The lake at the south end, below the field.
    const lake = smoothstep(-700, -1500, z) * smoothstep(300, 900, Math.abs(x));
    h = h * (1 - lake) + WORLD.seaLevel * lake;
    return h;
  }

  function smoothstep(a, b, v) {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // A ring must hang in open air not only above the ground under it, but above
  // the ground a pilot crosses on the way in: its height clears the highest
  // terrain within `disc` metres of it. The canyon gates use a disc of 0: the
  // slot they sit in is the low ground, and the walls beside it are not the
  // approach.
  function ringAltitude(x, z, clearance, disc) {
    let top = -1e9;
    for (let dx = -disc; dx <= disc; dx += 100) {
      for (let dz = -disc; dz <= disc; dz += 100) {
        top = Math.max(top, terrainHeight(x + dx, z + dz));
      }
    }
    return top + clearance;
  }

  // Ring courses. Each ring: centre, the direction the course runs through it,
  // and its radius. Ring Course weaves over the valley; the Canyon trial stays
  // low between the walls; the Landing circuit marks climb-out, downwind, final.
  function buildCourse(missionId) {
    const rings = [];
    if (missionId === 'rings') {
      const spots = [
        [60, 800], [-280, 1450], [220, 2100], [-180, 2750],
        [320, 3400], [-320, 4050], [120, 4600], [0, 4900],
      ];
      for (let i = 0; i < spots.length; i += 1) {
        const [x, z] = spots[i];
        rings.push({ x, y: ringAltitude(x, z, 55, 300), z, radius: FLIGHT.ringRadius, passed: false });
      }
    } else if (missionId === 'canyon') {
      const spots = [
        [400, 900], [450, 1300], [390, 1700], [460, 2100],
        [410, 2500], [450, 2900], [400, 3300], [460, 3700],
        [420, 4100], [440, 4500],
      ];
      for (let i = 0; i < spots.length; i += 1) {
        const [x, z] = spots[i];
        rings.push({ x, y: ringAltitude(x, z, 45, 0), z, radius: FLIGHT.ringRadius, passed: false });
      }
    } else {
      // Landing circuit gates: climb-out, downwind leg, final approach.
      const spots = [
        [0, 900], [-650, 200], [0, -1100],
      ];
      for (let i = 0; i < spots.length; i += 1) {
        const [x, z] = spots[i];
        rings.push({ x, y: ringAltitude(x, z, 60, 300), z, radius: FLIGHT.ringRadius + 8, passed: false });
      }
    }
    // Course direction per ring, from the previous ring (or the start) to it.
    // The miss test and the ring's facing both read this.
    let px = WORLD.startX;
    let pz = WORLD.startZ;
    for (const ring of rings) {
      let dx = ring.x - px;
      let dz = ring.z - pz;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      ring.dir = { x: dx, z: dz };
      px = ring.x;
      pz = ring.z;
    }
    return rings;
  }

  // Cloud puffs: fixed world positions, drawn as soft billboards.
  const clouds = [];
  for (let i = 0; i < 26; i += 1) {
    clouds.push({
      x: (rng() - 0.5) * 9000,
      y: 700 + rng() * 500,
      z: (rng() - 0.5) * 9000 + 2000,
      r: 180 + rng() * 320,
    });
  }

  const state = {
    screen: 'title',
    missionIndex: 0,
    mission: MISSIONS[0],
    rings: [],
    nextRing: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    time: 0,
    events: [],
    message: '',
    messageUntil: 0,
    // Flight state.
    x: WORLD.startX,
    y: 2,
    z: WORLD.startZ,
    heading: WORLD.startHeading,
    pitch: 0,
    bank: 0,
    speed: 0, // knots
    throttle: 0,
    fuel: FLIGHT.fuelCapacity,
    gearDown: true,
    flapsDown: false,
    damage: 0,
    stalled: false,
    onGround: true,
    airborne: false,
    landed: false,
    complete: false,
    crashed: false,
    verticalSpeed: 0, // feet per minute, for the HUD and the landing judge
    distanceFlown: 0,
    ringsPassed: 0,
    seed,
  };

  function reset(missionIndex) {
    state.missionIndex = missionIndex;
    state.mission = MISSIONS[missionIndex];
    state.rings = buildCourse(state.mission.id);
    state.nextRing = 0;
    state.score = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.time = 0;
    state.events = [];
    state.message = '';
    state.x = WORLD.startX;
    state.y = 2;
    state.z = WORLD.startZ;
    state.heading = WORLD.startHeading;
    state.pitch = 0;
    state.bank = 0;
    state.speed = 0;
    state.throttle = 0;
    state.fuel = state.mission.fuel;
    state.gearDown = true;
    state.flapsDown = false;
    state.damage = 0;
    state.stalled = false;
    state.onGround = true;
    state.airborne = false;
    state.landed = false;
    state.complete = false;
    state.crashed = false;
    state.verticalSpeed = 0;
    state.distanceFlown = 0;
    state.ringsPassed = 0;
  }

  function announce(text, seconds) {
    state.message = text;
    state.messageUntil = state.time + seconds;
  }

  function pushEvent(type, data) {
    state.events.push({ type, time: state.time, ...data });
  }

  // One fixed step of flight. Input: {pitch, roll, throttle, gear, flaps, brake}
  // with pitch/roll in [-1, 1] and throttle in [0, 1]. Toggles arrive as edges.
  function step(dt, input) {
    if (state.crashed || state.complete || state.landed) return;
    state.time += dt;

    // Throttle and speed.
    const targetThrottle = input.throttle;
    state.throttle += clamp(targetThrottle - state.throttle, -dt * 1.4, dt * 1.4);
    const stall = FLIGHT.stallSpeed - (state.flapsDown ? FLIGHT.flapLift : 0);
    const power = state.fuel > 0 ? state.throttle : 0;
    let accel = power * FLIGHT.accelPerSec - (1 - power) * FLIGHT.dragPerSec;
    // Drag grows with the square of speed: full power settles near maxSpeed,
    // and the plane never runs away past it.
    accel -= 30 * (state.speed / FLIGHT.maxSpeed) ** 2;
    if (state.gearDown && state.airborne) accel -= FLIGHT.gearDrag;
    if (state.onGround && state.speed < FLIGHT.takeoffSpeed) accel *= 0.55;
    state.speed = Math.max(0, Math.min(240, state.speed + accel * dt));
    if (state.fuel > 0) {
      state.fuel = Math.max(0, state.fuel - state.throttle * FLIGHT.fuelBurn * dt);
      if (state.fuel === 0) pushEvent(EVENT_FUEL_EMPTY, {});
    }

    // Attitude. The stick moves pitch and bank toward their targets; the bank
    // turns the heading; the pitch and the speed set the climb.
    const targetBank = input.roll * FLIGHT.maxBank;
    state.bank += clamp(targetBank - state.bank, -FLIGHT.rollRate * dt, FLIGHT.rollRate * dt);
    const targetPitch = input.pitch * (input.pitch > 0 ? FLIGHT.maxPitchUp : -FLIGHT.maxPitchDown);
    state.pitch += clamp(targetPitch - state.pitch, -FLIGHT.pitchRate * dt, FLIGHT.pitchRate * dt);

    state.stalled = state.airborne && state.speed < stall;
    if (state.stalled) {
      state.pitch = Math.max(state.pitch - 26 * dt, FLIGHT.maxPitchDown);
      const lastStall = state.events.length
        ? state.events[state.events.length - 1]
        : null;
      if (!lastStall || lastStall.type !== EVENT_STALL || state.time - lastStall.time > 1.5) {
        pushEvent(EVENT_STALL, {});
      }
    }

    const turnRate = state.bank * FLIGHT.turnFactor * clamp(state.speed / 120, 0.25, 1.4);
    state.heading += turnRate * dt;
    if (state.heading >= 360) state.heading -= 360;
    if (state.heading < 0) state.heading += 360;

    // Climb and sink. Level flight needs speed; pitch trades speed for height.
    const speedMs = (state.speed / KT_PER_MS);
    let climbMs = 0;
    if (state.airborne) {
      const pitchRad = state.pitch * DEG;
      climbMs = Math.sin(pitchRad) * speedMs;
      climbMs += (power - 0.55) * (FLIGHT.climbRate / 60 / FT_PER_M) * 0.35;
      if (state.stalled) climbMs -= 6;
      if (!state.stalled && state.speed > stall) {
        climbMs -= (FLIGHT.sinkRate / 60 / FT_PER_M) * (1 - power) * 0.6;
      }
    }
    state.verticalSpeed = (climbMs * FT_PER_M * 60);

    // Move. The previous position is kept for the ring crossing test below.
    const px0 = state.x;
    const py0 = state.y;
    const pz0 = state.z;
    const headingRad = state.heading * DEG;
    const fx = Math.sin(headingRad);
    const fz = Math.cos(headingRad);
    const forward = state.onGround ? speedMs : speedMs * Math.cos(state.pitch * DEG);
    state.x += fx * forward * dt;
    state.z += fz * forward * dt;
    state.y += climbMs * dt;
    state.distanceFlown += forward * dt;

    // Takeoff: fast enough on the strip, nose up, she flies.
    const ground = terrainHeight(state.x, state.z);
    if (state.onGround) {
      state.y = ground + 2;
      if (state.speed >= FLIGHT.takeoffSpeed && state.pitch > 4) {
        state.onGround = false;
        state.airborne = true;
        state.gearDown = false;
        announce('Airborne. Gear up, flaps as needed.', 3);
      }
    }

    // Landing check: on the strip, slow, gentle, gear down. Only when the
    // plane is actually coming down: a fresh takeoff climbs away through this
    // same height and must not be read as a landing.
    if (state.airborne && !state.onGround && state.verticalSpeed < -30) {
      const overStrip = Math.abs(state.x) < FLIGHT.runwayHalfWidth + 6
        && state.z > WORLD.runwayZ0 - 40 && state.z < WORLD.runwayZ1 + 40;
      const vs = state.verticalSpeed;
      if (state.y <= ground + 2.2) {
        if (overStrip && state.gearDown && state.speed < 110 && vs > -900) {
          state.onGround = true;
          state.airborne = false;
          state.y = ground + 2;
          state.pitch = 0;
          state.bank = 0;
          const centreError = Math.abs(state.x);
          const soft = vs > -350;
          const bonus = FLIGHT.landingBonus + (soft ? FLIGHT.perfectLandingBonus : 0)
            + Math.max(0, Math.round((1 - centreError / 14) * 150));
          state.score += bonus;
          state.landed = true;
          pushEvent(EVENT_LAND, { bonus, centreError, soft });
          if (state.mission.id === 'landing') {
            state.complete = true;
            pushEvent(EVENT_COMPLETE, { score: state.score });
          } else {
            announce(`Landed. +${bonus} points. Press Enter to fly again.`, 6);
          }
        } else {
          crash('terrain');
        }
      }
    }

    // Ring passes: the plane crosses the ring's disc. The test is exact: the
    // step that carries the plane through the ring's plane is interpolated,
    // and the crossing point must lie inside the radius. A near miss on the
    // disc's edge is still a miss, but a true crossing is never lost between
    // two sampled positions.
    const ring = state.rings[state.nextRing];
    if (ring && !ring.passed && state.airborne) {
      const dir = ring.dir || { x: 0, z: 1 };
      const along0 = (px0 - ring.x) * dir.x + (pz0 - ring.z) * dir.z;
      const along1 = (state.x - ring.x) * dir.x + (state.z - ring.z) * dir.z;
      const dx = state.x - ring.x;
      const dy = state.y - ring.y;
      const dz = state.z - ring.z;
      const dist = Math.hypot(dx, dy, dz);
      let passed = dist < ring.radius;
      if (!passed && along0 < 0 && along1 >= 0) {
        const t = along0 === along1 ? 0 : -along0 / (along1 - along0);
        const cx = px0 + (state.x - px0) * t - ring.x;
        const cy = py0 + (state.y - py0) * t - ring.y;
        const cz = pz0 + (state.z - pz0) * t - ring.z;
        passed = Math.hypot(cx, cy, cz) < ring.radius;
      }
      if (passed) {
        ring.passed = true;
        state.ringsPassed += 1;
        state.combo += 1;
        state.bestCombo = Math.max(state.bestCombo, state.combo);
        const points = FLIGHT.ringScore * (state.combo >= 3 ? 2 : 1);
        state.score += points;
        pushEvent(EVENT_RING, { index: state.nextRing, points, combo: state.combo });
        announce(`Ring ${state.ringsPassed} of ${state.rings.length}. +${points}`, 2.5);
        state.nextRing += 1;
        if (state.nextRing >= state.rings.length) {
          if (state.mission.id === 'landing') {
            announce('Circuit flown. Bring her down on the runway.', 4);
          } else {
            state.complete = true;
            const timeBonus = state.mission.id === 'canyon'
              ? Math.max(0, Math.round((state.mission.timeLimit - state.time) * 5))
              : Math.round(state.fuel * 4);
            state.score += timeBonus;
            pushEvent(EVENT_COMPLETE, { score: state.score, timeBonus });
          }
        }
      } else if (dist < ring.radius + 40) {
        // Flew past the ring without going through it: the streak breaks once
        // the plane is clearly beyond the ring along the course direction.
        const along = dx * dir.x + dz * dir.z;
        if (along > 80) state.combo = 0;
      }
    }

    // Out of the valley: turn back. The world ends at the map edge.
    if (Math.abs(state.x) > 4800 || Math.abs(state.z) > 5200 || state.z < -2400) {
      announce('Turn back. You are leaving the valley.', 2);
      state.damage = Math.min(100, state.damage + 4 * dt);
    }

    // Hard deck: the lake is water, the ridges are rock. Either ends the flight.
    if (state.y < ground + 0.5 && !state.onGround) crash('terrain');
    if (state.y > 1500) {
      state.y = 1500;
      state.pitch = Math.min(state.pitch, 0);
    }
  }

  function crash(cause) {
    if (state.crashed) return;
    state.crashed = true;
    state.damage = 100;
    pushEvent(EVENT_CRASH, { cause, score: state.score });
  }

  return {
    state,
    terrainHeight,
    reset,
    step,
    announce,
    clouds,
    get altitudeFt() { return Math.round((state.y - terrainHeight(state.x, state.z)) * FT_PER_M); },
    get altitudeMslFt() { return Math.round(state.y * FT_PER_M); },
  };
}
