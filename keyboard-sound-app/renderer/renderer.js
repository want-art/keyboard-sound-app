// 设置面板渲染逻辑
'use strict';

const PROFILES = [
  { id: 'blue', emoji: '🩵', name: '青轴', desc: '清晰清脆 · 段落' },
  { id: 'red', emoji: '🔴', name: '红轴', desc: '线性柔和 · 安静' },
  { id: 'typewriter', emoji: '🖋', name: '打字机', desc: '金属撞击' },
  { id: 'muyu', emoji: '🪵', name: '木鱼', desc: '空心木质叩叩' },
  { id: 'water', emoji: '💧', name: '水滴', desc: '下行滴答' },
  { id: 'piano', emoji: '🎹', name: '钢琴', desc: '低音木质泛音' },
  { id: 'musicbox', emoji: '🎶', name: '八音盒', desc: '明亮延音' },
  { id: 'mahjong', emoji: '🀄', name: '麻将', desc: '干脆瓷片咔' },
];
const SCENES = [
  { id: 'none', emoji: '⚙️', name: '默认', desc: '按当前音色' },
  { id: 'focus', emoji: '🌧️', name: '专注', desc: '雨声底噪 + 轻音' },
  { id: 'game', emoji: '🎮', name: '游戏', desc: '响轴更脆' },
  { id: 'night', emoji: '🌙', name: '深夜', desc: '自动降音' },
];
const SPECIAL_LABEL = { space: '空格 Space', enter: '回车 Enter', backspace: '退格 Backspace' };
const SPECIAL_KEY_LIST = ['space', 'enter', 'backspace'];
const SPEC = {}; // key -> { sel, range, val } 持久引用

let S = null;              // 当前配置
let syncing = false;       // 防止回读冲突

const $ = (id) => document.getElementById(id);

// 音量抖动的开关映射：开=幅度存储值，关=0（保存前还原）
let jitterEnabled = true;

function updateLocal(v) {
  v.special = v.special || {};
  v.specialVolume = v.specialVolume || {};
  v.overlay = v.overlay || {};
  return v;
}
function emit(patch) {
  window.api.updateConfig(patch);
  // 本地同步，避免等待回读
  merge(S, updateLocal(patch));
  render();
}
function merge(a, b) { if (!b) return; for (const k in b) a[k] = b[k]; return a; }

// ---------- 构建 ----------
function buildProfiles() {
  const grid = $('profileGrid'); grid.innerHTML = '';
  for (const p of PROFILES) {
    const el = document.createElement('div');
    el.className = 'profile' + (S.profile === p.id ? ' active' : '');
    el.innerHTML = `<div class="emoji">${p.emoji}</div><div class="name">${p.name}</div><div class="desc">${p.desc}</div>`;
    el.addEventListener('click', () => { emit({ profile: p.id }); window.api.audition(p.id); });
    grid.appendChild(el);
  }
}
function buildScenes() {
  const grid = $('sceneGrid'); grid.innerHTML = '';
  for (const sc of SCENES) {
    const el = document.createElement('div');
    el.className = 'scene' + (S.scene === sc.id ? ' active' : '');
    el.innerHTML = `<div class="emoji">${sc.emoji}</div><div class="name">${sc.name}</div><div class="desc">${sc.desc}</div>`;
    el.addEventListener('click', () => emit({ scene: sc.id }));
    grid.appendChild(el);
  }
  $('scenePill').textContent = SCENES.find(s => s.id === S.scene)?.name || '无场景';
}
function buildSpecial() {
  const row = $('specialRow'); row.innerHTML = '';
  for (const key of SPECIAL_KEY_LIST) {
    const box = document.createElement('div');
    box.className = 'spec-key';
    const opts = [{ v: 'follow', t: '跟随主音色' }].concat(PROFILES.map(p => ({ v: p.id, t: p.name })));
    const sel = docSelect(opts, null, (v) => {
      S.special[key] = v;
      if (v === 'follow') S.specialVolume[key] = 1;
      emit({ special: { ...S.special }, specialVolume: { ...S.specialVolume } });
    });
    const vol = document.createElement('input'); vol.type = 'range'; vol.min = 0; vol.max = 200; vol.step = 5;
    const volVal = document.createElement('span'); volVal.className = 'val'; volVal.style.minWidth = '36px';
    vol.addEventListener('input', () => {
      const v = vol.value / 100;
      S.specialVolume[key] = v;
      volVal.textContent = Math.round(v * 100) + '%';
      emit({ specialVolume: { ...S.specialVolume } });
    });
    box.innerHTML = `<label>${SPECIAL_LABEL[key]}</label>`;
    box.appendChild(sel);
    const mini = document.createElement('div'); mini.className = 'spec-mini';
    mini.append(vol, volVal);
    box.appendChild(mini);
    row.appendChild(box);
    SPEC[key] = { sel, range: vol, val: volVal };
  }
  syncSpecial();
}
function syncSpecial() {
  for (const key of SPECIAL_KEY_LIST) {
    const c = SPEC[key]; if (!c) continue;
    const cur = S.special[key] || 'follow';
    c.sel.value = cur;
    c.range.value = Math.round((S.specialVolume[key] || 1) * 100);
    c.val.textContent = Math.round((S.specialVolume[key] || 1) * 100) + '%';
  }
}
function docSelect(opts, val, onchange) {
  const sel = document.createElement('select');
  for (const o of opts) { const op = document.createElement('option'); op.value = o.v; op.textContent = o.t; if (o.v === val) op.selected = true; sel.appendChild(op); }
  sel.addEventListener('change', () => onchange(sel.value));
  return sel;
}
// 仅当选项缺失时补充（跟随主音色 + 8 音色）
// docSelect 首次调用时 val=null（不预选），由 syncSpecial 设置

// ---------- 控制绑定 ----------
function bindControls() {
  $('vol').addEventListener('input', (e) => emit({ volume: +e.target.value / 100 }));
  $('mute').addEventListener('change', (e) => emit({ muted: e.target.checked }));
  $('dualSound').addEventListener('change', (e) => emit({ dualSound: e.target.checked }));
  $('speedPitch').addEventListener('change', (e) => emit({ speedPitch: e.target.checked }));
  $('sens').addEventListener('input', (e) => emit({ speedSensitivity: +e.target.value }));
  $('jitter').addEventListener('change', (e) => {
    jitterEnabled = e.target.checked;
    $('jitterAmt').disabled = !jitterEnabled;
    emit({ jitter: jitterEnabled ? Math.max(0.05, +$('jitterAmt').value / 100) : 0 });
  });
  $('jitterAmt').addEventListener('input', (e) => {
    if (jitterEnabled) emit({ jitter: +e.target.value / 100 });
  });
  $('focusRain').addEventListener('change', (e) => emit({ focusRain: e.target.checked }));
  $('nightAuto').addEventListener('change', (e) => emit({ nightAuto: e.target.checked }));
  $('overlayVis').addEventListener('change', (e) => emit({ overlay: { ...S.overlay, visible: e.target.checked } }));
  $('opacity').addEventListener('input', (e) => {
    S.overlay.opacity = +e.target.value / 100;
    emit({ overlay: { ...S.overlay } });
  });
  $('ripple').addEventListener('change', (e) => emit({ overlay: { ...S.overlay, ripple: e.target.checked } }));

  $('importPackBtn').addEventListener('click', async () => {
    const r = await window.api.importPack();
    if (r) {
      if (r.error) alert('导入失败：' + r.error);
      else { $('packInfo').textContent = '已导入音效包：' + (r.slots || []).join(' / ') + '。'; }
    }
  });
  $('clearPackBtn').addEventListener('click', async () => {
    await window.api.clearPack();
    $('packInfo').textContent = '已清除音效包，恢复合成音色。';
  });
}

// ---------- 渲染到控件 ----------
function render() {
  syncing = true;
  $('vol').value = Math.round(S.volume * 100);
  $('volVal').textContent = Math.round(S.volume * 100) + '%';
  $('mute').checked = !!S.muted;
  $('dualSound').checked = !!S.dualSound;
  $('speedPitch').checked = !!S.speedPitch;
  $('sens').value = S.speedSensitivity;
  $('sensVal').textContent = S.speedSensitivity.toFixed(2) + '×';
  jitterEnabled = S.jitter > 0;
  $('jitter').checked = jitterEnabled;
  $('jitterAmt').value = Math.round((S.jitter > 0 ? S.jitter : 0.45) * 100);
  $('jitterAmtVal').textContent = Math.round((S.jitter > 0 ? S.jitter : 0.45) * 100) + '%';
  $('jitterAmt').disabled = !jitterEnabled;
  $('focusRain').checked = !!S.focusRain;
  $('nightAuto').checked = !!S.nightAuto;
  $('overlayVis').checked = !!S.overlay.visible;
  $('opacity').value = Math.round(S.overlay.opacity * 100);
  $('opacityVal').textContent = Math.round(S.overlay.opacity * 100) + '%';
  $('ripple').checked = !!S.overlay.ripple;
  $('runPill').textContent = S.muted ? '● 已静音' : '● 运行中';
  $('runPill').style.background = S.muted ? '#2b2830' : '#0f2b1a';
  buildProfiles();
  buildScenes();
  syncSpecial();
  syncing = false;
}

// ---------- 统计 ----------
function renderStats(st) {
  if (!st) return;
  $('statCount').textContent = (st.count || 0).toLocaleString();
  $('statWpm').textContent = st.wpm || 0;
  const mins = Math.round((st.activeSeconds || 0) / 60);
  $('statActive').innerHTML = mins + '<span class="unit">分</span>';
}

// ---------- 监听 ----------
window.api.on('config', (c) => {
  if (syncing) return;
  S = updateLocal(c);
  render();
});
window.api.on('stats', renderStats);
window.api.on('mute', (m) => { S.muted = m; if (!syncing) render(); });

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'k') e.preventDefault();
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'o') e.preventDefault();
});

// ---------- 启动 ----------
(async function init() {
  S = updateLocal(await window.api.getConfig());
  bindControls();
  buildSpecial();
  render();
})();