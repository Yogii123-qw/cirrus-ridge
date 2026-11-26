// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps, and the renderer paints what is there. Screens: title, play,
// paused, over. ?shot=flight|rings|title|landing (with &seed=N) stages that
// scene instead of running the loop, paints it twice and sets window.__shotReady
// for a screenshot.
import { BEST_KEY, MISSIONS, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_COMPLETE, EVENT_CRASH, EVENT_FUEL_EMPTY, EVENT_LAND, EVENT_RING, EVENT_STALL } from './world.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas, world);
const audio = createAudio();

function readBests() {
  try {
    return JSON.parse(window.localStorage.getItem(BEST_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveBests(bests) {
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify(bests));
  } catch {
    // Storage can be off: bests then last this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, readBests(), 0, world.state.time);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  input.attach();
  let screen = SCREEN_TITLE;
  let bests = readBests();
  let selected = 0;
  let accumulator = 0;
  let last = performance.now();
  let lastEventCount = 0;
  let landedAt = 0;

  function announce(message) {
    status.textContent = message;
  }

  function startMission(index) {
    world.reset(index);
    selected = index;
    accumulator = 0;
    input.resetThrottle();
    screen = SCREEN_PLAY;
    audio.resume();
    announce(`Flying ${MISSIONS[index].name}. Good luck, pilot.`);
  }

  function endFlight() {
    screen = SCREEN_OVER;
    const missionId = world.state.mission.id;
    if (world.state.score > (bests[missionId] || 0)) {
      bests[missionId] = world.state.score;
      saveBests(bests);
    }
    announce(`Flight over. Score ${world.state.score}.`);
  }

  function backToTitle() {
    world.reset(selected);
    screen = SCREEN_TITLE;
    announce('Cirrus Ridge. Choose a mission.');
  }

  function handleEvents() {
    const events = world.state.events;
    for (let i = lastEventCount; i < events.length; i += 1) {
      const event = events[i];
      if (event.type === EVENT_RING) audio.chime();
      if (event.type === EVENT_LAND) audio.thud();
      if (event.type === EVENT_CRASH) {
        audio.thud();
        endFlight();
      }
      if (event.type === EVENT_COMPLETE) endFlight();
      if (event.type === EVENT_STALL) audio.alarm();
      if (event.type === EVENT_FUEL_EMPTY) announce('Fuel empty. Glide her down.');
    }
    lastEventCount = events.length;
    // Landed mid-mission (not the landing mission itself): give the pilot a
    // moment on the runway, then show the results panel once.
    if (world.state.landed && !world.state.complete && screen === SCREEN_PLAY) {
      if (!landedAt) landedAt = performance.now();
      if (performance.now() - landedAt > 2500) endFlight();
    } else {
      landedAt = 0;
    }
  }

  function clickMission(mouse) {
    const list = world.state.missionList || [];
    for (const item of list) {
      if (mouse.x >= item.x && mouse.x <= item.x + item.w
        && mouse.y >= item.y && mouse.y <= item.y + item.h) {
        return item.index;
      }
    }
    return -1;
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const inputState = input.read(dt);
    if (inputState.mutePressed) audio.toggleMute();

    if (screen === SCREEN_TITLE) {
      // A living backdrop: the plane circles the field on autopilot, so the
      // title sits over a valley that is already flying.
      const s = world.state;
      if (!s.airborne && s.speed < 1) {
        world.reset(selected);
        s.x = -500;
        s.y = 260;
        s.z = -900;
        s.heading = 35;
        s.speed = 130;
        s.throttle = 0.7;
        s.onGround = false;
        s.airborne = true;
        s.gearDown = false;
      }
      const targetHeading = (35 + world.state.time * 9) % 360;
      let headingError = targetHeading - s.heading;
      if (headingError > 180) headingError -= 360;
      if (headingError < -180) headingError += 360;
      world.step(STEP, {
        pitch: Math.max(-1, Math.min(1, (260 - s.y) / 60)),
        roll: Math.max(-1, Math.min(1, headingError / 25)),
        throttle: 0.7, gear: false, flaps: false, brake: false,
      });
      if (inputState.upPressed) selected = (selected + MISSIONS.length - 1) % MISSIONS.length;
      if (inputState.downPressed) selected = (selected + 1) % MISSIONS.length;
      if (inputState.confirmPressed) startMission(selected);
      const clicked = clickMission(inputState.mouse);
      if (inputState.mouse.clicked && clicked >= 0) {
        audio.resume();
        audio.click();
        startMission(clicked);
      }
      if (inputState.mouse.clicked) audio.resume();
    } else if (screen === SCREEN_PLAY) {
      if (inputState.pausePressed) {
        screen = SCREEN_PAUSED;
      } else {
        if (inputState.gearPressed) {
          world.state.gearDown = !world.state.gearDown;
          audio.click();
        }
        if (inputState.flapsPressed) {
          world.state.flapsDown = !world.state.flapsDown;
          audio.click();
        }
        if (inputState.brake && world.state.onGround) {
          world.state.speed = Math.max(0, world.state.speed - 40 * dt);
        }
        accumulator += dt;
        while (accumulator >= STEP) {
          world.step(STEP, {
            pitch: inputState.pitch,
            roll: inputState.roll,
            throttle: inputState.throttle,
            gear: false, flaps: false, brake: inputState.brake,
          });
          accumulator -= STEP;
        }
        audio.update(world.state);
        handleEvents();
      }
    } else if (screen === SCREEN_PAUSED) {
      if (inputState.pausePressed || inputState.confirmPressed) screen = SCREEN_PLAY;
    } else if (screen === SCREEN_OVER) {
      if (inputState.confirmPressed) startMission(selected);
      if (inputState.pausePressed) backToTitle();
    }

    renderer.draw(world.state, screen, bests, selected, world.state.time);
    requestAnimationFrame(frame);
  }

  backToTitle();
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
