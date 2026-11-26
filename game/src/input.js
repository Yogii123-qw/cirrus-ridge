// Keyboard and mouse input. The game reads a snapshot each frame: pitch and
// roll as -1..1, throttle as 0..1, and edge-triggered toggles for gear, flaps,
// brake and pause. Arrow keys and space never scroll the page while flying.
import { KEYS } from './config.js';

function matches(list, code) {
  return list.indexOf(code) !== -1;
}

export function createInput(canvas) {
  const keys = new Set();
  const edges = new Set();
  let mouse = { x: 0, y: 0, clicked: false };
  let attached = false;

  function onKeyDown(event) {
    const all = [
      ...KEYS.pitchUp, ...KEYS.pitchDown, ...KEYS.rollLeft, ...KEYS.rollRight,
      ...KEYS.throttleUp, ...KEYS.throttleDown, ...KEYS.gear, ...KEYS.flaps,
      ...KEYS.brake, ...KEYS.pause, ...KEYS.confirm, ...KEYS.mute,
    ];
    if (matches(all, event.code)) event.preventDefault();
    if (!event.repeat) edges.add(event.code);
    keys.add(event.code);
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onMouseMove(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  }

  function onMouseDown(event) {
    onMouseMove(event);
    mouse.clicked = true;
  }

  function attach() {
    if (attached) return;
    attached = true;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
  }

  function detach() {
    if (!attached) return;
    attached = false;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
  }

  // Read the controls for one frame. `throttle` is the target the flight model
  // eases toward; holding W raises it, S lowers it, and it stays where left.
  let throttle = 0;
  function read(dt) {
    const pitchUp = KEYS.pitchUp.some((c) => keys.has(c));
    const pitchDown = KEYS.pitchDown.some((c) => keys.has(c));
    const rollLeft = KEYS.rollLeft.some((c) => keys.has(c));
    const rollRight = KEYS.rollRight.some((c) => keys.has(c));
    const throttleUp = KEYS.throttleUp.some((c) => keys.has(c));
    const throttleDown = KEYS.throttleDown.some((c) => keys.has(c));
    if (throttleUp) throttle = Math.min(1, throttle + dt * 0.9);
    if (throttleDown) throttle = Math.max(0, throttle - dt * 0.9);
    const snapshot = {
      pitch: (pitchUp ? 1 : 0) - (pitchDown ? 1 : 0),
      roll: (rollRight ? 1 : 0) - (rollLeft ? 1 : 0),
      throttle,
      gearPressed: KEYS.gear.some((c) => edges.has(c)),
      flapsPressed: KEYS.flaps.some((c) => edges.has(c)),
      brake: KEYS.brake.some((c) => keys.has(c)),
      pausePressed: KEYS.pause.some((c) => edges.has(c)),
      confirmPressed: KEYS.confirm.some((c) => edges.has(c)),
      mutePressed: KEYS.mute.some((c) => edges.has(c)),
      upPressed: KEYS.pitchUp.some((c) => edges.has(c)),
      downPressed: KEYS.pitchDown.some((c) => edges.has(c)),
      mouse: { x: mouse.x, y: mouse.y, clicked: mouse.clicked },
    };
    edges.clear();
    mouse.clicked = false;
    return snapshot;
  }

  function resetThrottle() {
    throttle = 0;
  }

  return { attach, detach, read, resetThrottle };
}
