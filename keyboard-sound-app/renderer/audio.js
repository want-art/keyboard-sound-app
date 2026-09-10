// ============ 音频合成引擎：8 套音色 + 多音效重叠 + 变调 + 音量抖动 + 场景/雨声 + 自定义音效包 ============
'use strict';

let ctx = null;

// 混音拓扑:
//   打字命中 hitGain(每次瞬态: 音量抖动x场景x特殊键) -> scene -> volumeGain -> comp -> 扬声器
//   雨声       rainGain(底噪, 循环)                              -> volumeGain -> comp -> 扬声器
let volumeGain = null;   // 持久主音量 + 静音开关
let scene = null;        // 打字命中的汇总母线
let comp = null;
let noiseBuf = null;
let rainNodes = null;    // {stop, gain}

let S = {
  profile: 'blue', volume: 0.85, muted: false, dualSound: true,
  speedPitch: true, speedSensitivity: 1, jitter: 0.45,
  scene: 'none', focusRain: true, nightAuto: true,
  special: {}, specialVolume: {},
  customPack: null,
};
const pack = {};     // slot -> AudioBuffer
const packInfo = {}; // slot -> 文件名

const SPECIAL_KEYS = ['space', 'enter', 'backspace'];

function now() { return ctx ? ctx.currentTime : 0; }

function ensureCtx() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 6;
  comp.connect(ctx.destination);
  volumeGain = ctx.createGain(); volumeGain.connect(comp);
  setVolumeGain();
  scene = ctx.createGain(); scene.connect(volumeGain);
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  applyScene();
}
function setVolumeGain() {
  if (!volumeGain) return;
  try { volumeGain.gain.setValueAtTime(S.muted ? 0 : (S.volume * 0.9), now()); }
  catch (e) { volumeGain.gain.value = S.muted ? 0 : S.volume; }
}

// ---------- 合成单元 ----------
function playOsc(part, out) {
  const f = part.f || 440, dur = part.dur || 0.05, amp = part.amp || 0.3;
  const o = ctx.createOscillator();
  o.type = part.wave || 'sine';
  o.frequency.value = f * (part.pitchMul || 1);
  if (part.detune) o.detune.value = part.detune;
  const t = now();
  if (part.slideTo) {
    o.frequency.setValueAtTime(f * (part.pitchMul || 1), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, part.slideTo * (part.pitchMul || 1)), t + dur);
  }
  const g = ctx.createGain();
  const atk = part.atk != null ? part.atk : 0.002;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + Math.max(0.0002, atk));
  g.gain.setValueAtTime(amp, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dur);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + atk + dur + 0.05);
}
function playNoise(part, out) {
  const dur = part.dur || 0.02, amp = part.amp || 0.3;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.start(now(), Math.random() * (noiseBuf.duration - 0.1));
  src.stop(now() + dur + 0.05);
  let node = src;
  if (part.filterType) {
    const filt = ctx.createBiquadFilter();
    filt.type = part.filterType; filt.frequency.value = part.filterFreq || 2000;
    if (part.filterQ) filt.Q.value = part.filterQ;
    src.connect(filt); node = filt;
  }
  const g = ctx.createGain(); const atk = part.atk || 0.001; const t = now();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(amp, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dur);
  node.connect(g); g.connect(out);
}
function playParts(parts, out) {
  for (const p of parts) {
    if (p._delayed) continue; // 延迟部分另行调度
    if (p.type === 'osc') playOsc(p, out);
    else if (p.type === 'noise') playNoise(p, out);
  }
}
function playDelayed(parts, out, ms) {
  const filtered = parts.filter(p => p._delayed);
  if (!filtered.length) return;
  setTimeout(() => { for (const p of filtered) { if (p.type === 'osc') playOsc(p, out); else if (p.type === 'noise') playNoise(p, out); } }, ms);
}
function playBuffer(buf, rateMul, out) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.max(0.25, rateMul || 1);
  src.connect(out); src.start();
}

// ---------------- 8 套音色配方 ----------------
const PROFILES = {
  // 青轴
  blue: {
    down: [
      { type: 'osc', f: 200, dur: 0.045, amp: 0.30, atk: 0.001 },
      { type: 'osc', f: 540, dur: 0.03, amp: 0.13, atk: 0.001 },
      { type: 'noise', dur: 0.012, amp: 0.5, atk: 0.0008, filterType: 'highpass', filterFreq: 3200 },
      { type: 'noise', dur: 0.02, amp: 0.2, atk: 0.001, filterType: 'bandpass', filterFreq: 1400, filterQ: 0.7 },
    ],
    up: [
      { type: 'noise', dur: 0.01, amp: 0.3, atk: 0.0006, filterType: 'highpass', filterFreq: 4200 },
      { type: 'osc', f: 700, dur: 0.016, amp: 0.12, atk: 0.001 },
    ],
  },
  // 红轴
  red: {
    down: [
      { type: 'osc', f: 135, dur: 0.04, amp: 0.34, atk: 0.001 },
      { type: 'noise', dur: 0.012, amp: 0.14, atk: 0.001, filterType: 'bandpass', filterFreq: 1700, filterQ: 0.8 },
    ],
    up: [
      { type: 'osc', f: 95, dur: 0.018, amp: 0.13, atk: 0.001 },
      { type: 'noise', dur: 0.007, amp: 0.07, atk: 0.0006, filterType: 'highpass', filterFreq: 2600 },
    ],
  },
  // 打字机
  typewriter: {
    down: [
      { type: 'osc', f: 120, dur: 0.06, amp: 0.5, atk: 0.001 },
      { type: 'osc', f: 300, dur: 0.035, amp: 0.14, atk: 0.001, wave: 'square' },
      { type: 'noise', dur: 0.014, amp: 0.5, atk: 0.001, filterType: 'bandpass', filterFreq: 2400, filterQ: 1.2 },
      { type: 'noise', dur: 0.03, amp: 0.22, atk: 0.001, filterType: 'lowpass', filterFreq: 800 },
      { type: 'noise', dur: 0.012, amp: 0.35, atk: 0.001, filterType: 'highpass', filterFreq: 4600, _delayed: true }, // 敲击尾音
    ],
    up: [
      { type: 'noise', dur: 0.011, amp: 0.3, atk: 0.0006, filterType: 'highpass', filterFreq: 4600 },
      { type: 'osc', f: 280, dur: 0.02, amp: 0.16, atk: 0.001 },
    ],
  },
  // 木鱼
  muyu: {
    down: [
      { type: 'osc', f: 640, dur: 0.16, amp: 0.32, atk: 0.001 },
      { type: 'osc', f: 950, dur: 0.12, amp: 0.24, atk: 0.001, detune: -5 },
      { type: 'osc', f: 1330, dur: 0.09, amp: 0.14, atk: 0.001, detune: 7 },
      { type: 'noise', dur: 0.008, amp: 0.18, atk: 0.0006, filterType: 'highpass', filterFreq: 3600 },
      { type: 'osc', f: 720, dur: 0.12, amp: 0.16, atk: 0.001, _delayed: true }, // 桌面回弹
    ],
    up: [],
  },
  // 水滴
  water: {
    down: [
      { type: 'osc', f: 900, slideTo: 520, dur: 0.11, amp: 0.32, atk: 0.001, exp: true },
      { type: 'noise', dur: 0.006, amp: 0.1, atk: 0.0006, filterType: 'highpass', filterFreq: 5000 },
    ],
    up: [
      { type: 'osc', f: 260, slideTo: 200, dur: 0.05, amp: 0.1, atk: 0.001, exp: true },
    ],
  },
  // 钢琴
  piano: (() => {
    const parts = [];
    const base = 261.63, amps = [1, 0.5, 0.34, 0.22, 0.13, 0.08], mults = [1, 2.02, 3.1, 4.15, 5.2, 6.36];
    amps.forEach((a, i) => parts.push({ type: 'osc', wave: 'triangle', f: base * mults[i], dur: 0.55 - i * 0.04, amp: a * 0.4, atk: 0.003, detune: (Math.random() * 10 - 5) }));
    return {
      down: [{ type: 'osc', f: 131, dur: 0.4, amp: 0.3, atk: 0.002 }, ...parts],
      up: [{ type: 'noise', dur: 0.018, amp: 0.14, atk: 0.0006, filterType: 'lowpass', filterFreq: 700 }],
    };
  })(),
  // 八音盒
  musicbox: (() => {
    const parts = [];
    const base = 1046.5, mults = [1, 2.0, 3.0, 4.2], amps = [1, 0.55, 0.38, 0.28];
    mults.forEach((m, i) => parts.push({ type: 'osc', f: base * m, dur: 1.1 - i * 0.16, amp: amps[i] * 0.32, atk: 0.002, detune: (Math.random() * 8 - 4) }));
    return { down: parts, up: [] };
  })(),
  // 麻将
  mahjong: {
    down: [
      { type: 'noise', dur: 0.007, amp: 0.42, atk: 0.0005, filterType: 'highpass', filterFreq: 3800 },
      { type: 'osc', f: 1180, dur: 0.05, amp: 0.3, atk: 0.001 },
      { type: 'osc', f: 1650, dur: 0.035, amp: 0.16, atk: 0.001 },
      { type: 'noise', dur: 0.02, amp: 0.2, atk: 0.001, filterType: 'lowpass', filterFreq: 1000 },
      { type: 'osc', f: 900, dur: 0.04, amp: 0.14, atk: 0.002, _delayed: true },
      { type: 'noise', dur: 0.006, amp: 0.16, atk: 0.002, filterType: 'highpass', filterFreq: 3000, _delayed: true },
    ],
    up: [{ type: 'noise', dur: 0.006, amp: 0.14, atk: 0.0005, filterType: 'highpass', filterFreq: 5000 }],
  },
};
const PROFILE_LABELS = {
  blue: '青轴', red: '红轴', typewriter: '打字机', muyu: '木鱼',
  water: '水滴', piano: '钢琴', musicbox: '八音盒', mahjong: '麻将',
};

// ---------------- 播放入口 ----------------
function playKey(payload) {
  ensureCtx();
  if (!ctx || S.muted) return;
  const { type, key, profile } = payload || {};
  const effectiveProfile = (type === 'down' && profile) ? profile : S.profile;
  const isSpecial = (type === 'down') && SPECIAL_KEYS.includes(key);
  const pitch = (type === 'down') ? (payload.pitch || 1) : 1;

  // 本次命中的瞬态增益 = 主音量下再叠加 场景系数 × 音量抖动 × 特殊键音量
  const hit = ctx.createGain();
  let amp = sceneMultiplier() * jittered();
  if (isSpecial && S.specialVolume[key] != null) amp *= S.specialVolume[key];
  hit.gain.value = amp;
  hit.connect(scene);

  // 决定音源
  let buffer = null, recipe = null;
  if (type === 'down') {
    if (isSpecial && pack[key]) buffer = pack[key];
    else if (pack.down) buffer = pack.down;
    else recipe = (PROFILES[effectiveProfile] || PROFILES.blue).down;
  } else { // up
    if (!S.dualSound) { hit.disconnect(); return; }
    if (pack.up) buffer = pack.up;
    else recipe = (PROFILES[effectiveProfile] || PROFILES.blue).up || [];
  }

  if (buffer) { playBuffer(buffer, pitch, hit); hit.disconnect(); return; }
  if (recipe && recipe.length) {
    playParts(recipe, hit);
    playDelayed(recipe, hit, 40);
  }
  // hit 节点在该批声源结束后自动释放（声源 stop 后 GC 收走）
}

function jittered() {
  if (S.jitter <= 0) return 1;
  const spread = S.jitter * 0.14;
  return 1 + (Math.random() - 0.5) * 2 * spread;
}
function sceneMultiplier() {
  let m = 1;
  if (S.scene === 'focus') m *= 0.55;
  else if (S.scene === 'game') m *= 1.38;
  else if (S.scene === 'night') m *= 0.38;
  if (S.scene !== 'night' && S.nightAuto && isNight()) m *= 0.5;
  return m;
}
function isNight() { const h = new Date().getHours(); return h >= 23 || h < 7; }

// ---------------- 场景底噪：雨声 ----------------
function applyScene() {
  if (!ctx) return;
  if (rainNodes) {
    try { rainNodes.gain.gain.setTargetAtTime(0, now(), 0.12); } catch (e) {}
    const rn = rainNodes; rainNodes = null;
    setTimeout(() => { try { rn.stop(); } catch (e) {} }, 700);
  }
  const enable = S.scene === 'focus' && S.focusRain;
  if (!enable) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = 1.3;
  const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 320;
  const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 700; bpf.Q.value = 0.4;
  const rain = ctx.createGain(); rain.gain.value = 0;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
  const lfoG = ctx.createGain(); lfoG.gain.value = 0.012;
  lfo.connect(lfoG); lfoG.connect(rain.gain);
  src.connect(hpf); hpf.connect(bpf); bpf.connect(rain); rain.connect(volumeGain);
  src.start(); lfo.start();
  rain.gain.setTargetAtTime(S.volume * 0.05, now() + 0.2, 0.5);
  rainNodes = { stop: () => { try { src.stop(); lfo.stop(); } catch (e) {} }, gain: rain };
}

// ---------------- 配置 / 实时事件 ----------------
function updateConfig(c) {
  const s = { ...S, ...c };
  s.special = { ...(S.special || {}), ...(c.special || {}) };
  s.specialVolume = { ...(S.specialVolume || {}), ...(c.specialVolume || {}) };
  const rainChanged = s.scene !== S.scene || s.focusRain !== S.focusRain;
  S = s;
  if (ctx) { setVolumeGain(); if (rainChanged) applyScene(); }
}
function decodeBuf(ab) {
  ensureCtx();
  return ctx.decodeAudioData(ab).catch(() => null);
}

window.api.on('config', updateConfig);
window.api.on('mute', (m) => { S.muted = m; if (ctx) setVolumeGain(); });
window.api.on('key', playKey);
window.api.on('pack', (payload) => {
  for (const [slot, v] of Object.entries(payload)) {
    decodeBuf(v.data).then(buf => { pack[slot] = buf; packInfo[slot] = v.name; });
  }
});
window.api.on('clear-pack', () => { for (const k in pack) delete pack[k]; for (const k in packInfo) delete packInfo[k]; });