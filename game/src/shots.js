// Staged screenshot scenes. Each one plays the real rules forward from a fresh
// world for a fixed number of steps, steered by a scripted driver, so the frame
// is what real play looks like and the same seed always gives the same frame.
// The driver flies with the same inputs a player has: pitch, roll, throttle.
import { STEP } from './config.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

// A small autopilot: hold a target heading and altitude with the real controls.
function autopilot(world, targetHeading, targetAltM, throttle) {
  const s = world.state;
  let headingError = targetHeading - s.heading;
  if (headingError > 180) headingError -= 360;
  if (headingError < -180) headingError += 360;
  const roll = Math.max(-1, Math.min(1, headingError / 25));
  const altError = targetAltM - s.y;
  const pitch = Math.max(-1, Math.min(1, altError / 60));
  return { pitch, roll, throttle, gear: false, flaps: false, brake: false };
}

function drive(world, seconds, driver) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    world.step(STEP, driver(world.state, i));
  }
}

// Put the plane somewhere specific: used to frame a shot exactly.
function place(world, x, y, z, heading, pitch, bank, speed, throttle) {
  const s = world.state;
  s.x = x;
  s.y = y;
  s.z = z;
  s.heading = heading;
  s.pitch = pitch;
  s.bank = bank;
  s.speed = speed;
  s.throttle = throttle;
  s.onGround = false;
  s.airborne = true;
  s.gearDown = false;
}

export function stageShot(name, world) {
  const s = world.state;
  if (name === 'flight') {
    // Cover: mid-course, diving through the valley toward ring 2, the runway
    // still visible behind, sun low on the left.
    world.reset(0);
    world.announce('', 0);
    drive(world, 6, () => ({ pitch: 0.25, roll: 0, throttle: 1, gear: false, flaps: false, brake: false }));
    drive(world, 26, (st) => autopilot(world, 8, 130, 0.92));
    return { screen: SCREEN_PLAY, best: 0 };
  }
  if (name === 'rings') {
    // Threading a ring low over the valley floor, banked hard.
    world.reset(0);
    place(world, -260, 150, 1180, 12, -2, -28, 150, 0.9);
    s.nextRing = 1;
    s.ringsPassed = 1;
    s.rings[0].passed = true;
    s.score = 100;
    s.combo = 1;
    drive(world, 2.2, () => ({ pitch: 0.05, roll: -0.35, throttle: 0.9, gear: false, flaps: false, brake: false }));
    return { screen: SCREEN_PLAY, best: 0 };
  }
  if (name === 'title') {
    // Title screen over a slow scenic pass above the field.
    world.reset(0);
    place(world, -500, 260, -900, 35, 0, 12, 130, 0.7);
    drive(world, 1.5, (st) => autopilot(world, 35, 260, 0.7));
    return { screen: SCREEN_TITLE, best: 0 };
  }
  if (name === 'landing') {
    // Final approach: gear down, flaps down, runway centred, numbers ahead.
    world.reset(2);
    place(world, 6, 105, -1250, 0, -6, 0, 92, 0.42);
    s.gearDown = true;
    s.flapsDown = true;
    drive(world, 3.5, () => ({ pitch: -0.12, roll: 0, throttle: 0.42, gear: false, flaps: false, brake: false }));
    return { screen: SCREEN_PLAY, best: 0 };
  }
  // Default: the opening scene.
  world.reset(0);
  return { screen: SCREEN_TITLE, best: 0 };
}
