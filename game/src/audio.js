// Synthesised sound: no audio files. A WebAudio graph built on the first user
// gesture: engine drone tied to throttle and speed, wind tied to airspeed, and
// short cues for rings, touchdown, warnings and clicks. Mute toggles it all.
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let engineFilter = null;
  let windSource = null;
  let windGain = null;
  let windFilter = null;
  let muted = false;
  let started = false;

  function ensure() {
    if (started) return;
    started = true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);

      // Engine: two detuned saws through a low-pass, pitch follows throttle.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 52;
      engineOsc2 = ctx.createOscillator();
      engineOsc2.type = 'sawtooth';
      engineOsc2.frequency.value = 55;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineOsc2.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      engineOsc2.start();

      // Wind: looped noise through a band-pass, loudness follows airspeed.
      const len = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
      windSource = ctx.createBufferSource();
      windSource.buffer = buffer;
      windSource.loop = true;
      windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 700;
      windFilter.Q.value = 0.6;
      windGain = ctx.createGain();
      windGain.gain.value = 0;
      windSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);
      windSource.start();
    } catch {
      ctx = null;
    }
  }

  function resume() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  // Called every frame with the live flight state; the drone and wind follow.
  function update(state) {
    if (!ctx || !engineOsc) return;
    const t = ctx.currentTime;
    const rpm = 40 + state.throttle * 90 + state.speed * 0.25;
    engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
    engineOsc2.frequency.setTargetAtTime(rpm * 1.01 + 3, t, 0.08);
    engineFilter.frequency.setTargetAtTime(320 + state.throttle * 900, t, 0.1);
    engineGain.gain.setTargetAtTime(state.airborne || state.throttle > 0.05 ? 0.05 + state.throttle * 0.06 : 0, t, 0.1);
    windGain.gain.setTargetAtTime(Math.min(0.16, state.speed * 0.0009), t, 0.12);
    windFilter.frequency.setTargetAtTime(500 + state.speed * 4, t, 0.15);
  }

  function tone(freq, dur, type, vol, when) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (when || 0);
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol || 0.2, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function chime() {
    tone(880, 0.35, 'sine', 0.22, 0);
    tone(1318, 0.5, 'sine', 0.18, 0.09);
  }

  function thud() {
    tone(70, 0.3, 'sine', 0.4, 0);
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.15);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.3;
    src.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  function alarm() {
    tone(1046, 0.12, 'square', 0.08, 0);
    tone(1046, 0.12, 'square', 0.08, 0.18);
  }

  function click() {
    tone(1200, 0.05, 'square', 0.06, 0);
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  return { ensure, resume, update, chime, thud, alarm, click, toggleMute };
}
