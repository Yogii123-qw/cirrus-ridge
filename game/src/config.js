// Cirrus Ridge: tuning, missions and display constants for the flight game.
// All speeds in knots, altitudes in feet, distances in metres. The game runs in
// a fixed 1/60 s step; these numbers shape how the plane answers the controls.
export const STEP = 1 / 60;
export const BEST_KEY = 'cirrus-ridge-best-v1';

// Flight model.
export const FLIGHT = {
  maxSpeed: 210, // knots at full throttle, level
  cruiseSpeed: 140,
  stallSpeed: 62, // below this the wing stops flying and the nose drops
  takeoffSpeed: 75,
  accelPerSec: 26, // knots gained per second at full throttle
  dragPerSec: 9, // knots lost per second with throttle shut
  climbRate: 2600, // feet per minute at full power, wings level
  sinkRate: 900, // feet per minute gliding, throttle shut
  rollRate: 95, // degrees per second of bank at full aileron
  maxBank: 68, // degrees; past this the turn tightens and the nose drops
  pitchRate: 42, // degrees per second of pitch at full elevator
  maxPitchUp: 32,
  maxPitchDown: -24,
  turnFactor: 0.45, // heading change per second per degree of bank, scaled by speed
  fuelBurn: 0.4, // fuel units per second at full throttle
  fuelCapacity: 100,
  gearDrag: 2, // extra knots lost per second with the gear down
  flapLift: 10, // knots shaved off the stall speed with flaps down
  damagePerHit: 34, // terrain strike damage; 100 ends the flight
  runwayHalfWidth: 14, // metres from centreline to the edge paint
  runwayLength: 900,
  ringRadius: 48, // metres; the ring a pilot must fly through
  ringScore: 100,
  landingBonus: 500,
  perfectLandingBonus: 250,
};

// World layout. The runway lies along the Z axis at x = 0, its centre at z = 0.
// The plane starts parked on it, nose pointing north (+Z). Rings and gates are
// laid out north of the field, over a valley that runs between two ridges.
export const WORLD = {
  size: 5200, // metres across the terrain patch the renderer draws
  gridCells: 36, // terrain mesh cells per side
  cellSize: 150, // metres per terrain cell
  baseHeight: 0,
  ridgeHeight: 620, // metres of relief on the big ridges
  hillHeight: 190,
  seaLevel: -40, // the lake surface in the valley
  runwayZ0: -450,
  runwayZ1: 450,
  startX: 0,
  startZ: -380,
  startHeading: 0, // degrees, 0 = north (+Z)
};

// The three missions. Each one is a different way to fly the same valley.
export const MISSIONS = [
  {
    id: 'rings',
    name: 'Ring Course',
    short: 'Fly all 8 rings in order, then bring her home.',
    rings: 8,
    timeLimit: 0, // no clock; fuel is the limit
    fuel: 120,
    blurb: 'Eight rings over the valley. Clean lines pay double.',
  },
  {
    id: 'canyon',
    name: 'Canyon Time Trial',
    short: 'Ten low gates through the canyon. Beat the clock.',
    rings: 10,
    timeLimit: 240, // seconds; overtime still counts, score falls
    fuel: 100,
    blurb: 'Low, fast, between the walls. One mistake ends it.',
  },
  {
    id: 'landing',
    name: 'Landing Challenge',
    short: 'Take off, fly the circuit, grease the landing.',
    rings: 3, // three gates mark the circuit: climb-out, downwind, final
    timeLimit: 0,
    fuel: 100,
    blurb: 'Touch down on the numbers, soft as snowfall.',
  },
];

// Colours. A late afternoon over green ridges: warm sun, blue distance haze.
export const PALETTE = {
  skyTop: '#2f6fb8',
  skyMid: '#7fb2e0',
  skyHorizon: '#e8d9b0',
  sun: '#fff3c4',
  sunGlow: 'rgba(255, 236, 170, 0.55)',
  grassLow: '#4d7a3a',
  grassHigh: '#6d9a4e',
  field: '#b89a4e',
  rock: '#8a7f74',
  snow: '#eef2f5',
  water: '#3f7fa8',
  runway: '#3c3f45',
  runwayEdge: '#f2f2ea',
  ringNext: '#ffb02e',
  ringPassed: '#37d67a',
  ringFar: '#d8dee6',
  planeBody: '#d8442c',
  planeWing: '#f0ead8',
  planeTrim: '#1d3557',
  hud: '#e8f4ff',
  hudAmber: '#ffb02e',
  hudRed: '#ff5a4e',
  hudGreen: '#37d67a',
  panel: 'rgba(10, 18, 30, 0.72)',
};

// Keyboard. Arrows fly the plane; W/S work the throttle; G gear; F flaps.
export const KEYS = {
  pitchUp: ['ArrowUp'],
  pitchDown: ['ArrowDown'],
  rollLeft: ['ArrowLeft'],
  rollRight: ['ArrowRight'],
  throttleUp: ['KeyW'],
  throttleDown: ['KeyS'],
  gear: ['KeyG'],
  flaps: ['KeyF'],
  brake: ['KeyB'],
  pause: ['KeyP', 'Escape'],
  confirm: ['Enter', 'Space'],
  mute: ['KeyM'],
};
