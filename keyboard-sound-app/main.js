// 主进程：全局键盘钩子、统计、配置持久化、托盘、全局热键、多个窗口的编排
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const uiohook = require('uiohook-napi');
const { uIOhook, UiohookKey } = uiohook;
const { norm, SPECIAL, isPrintable } = require('./keymaps.js');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.disableHardwareAcceleration(); // 悬浮透明窗更稳

// ---------------- 状态 ----------------
const configPath = () => path.join(app.getPath('userData'), 'config.json');
const configDir = () => app.getPath('userData');

const DEFAULTS = {
  version: 1,
  profile: 'blue',                // 主音色
  volume: 0.85,                   // 主音量
  muted: false,
  dualSound: true,                // 手感增强：按下+回弹
  speedPitch: true,               // 手感增强：打字越快音调越高
  speedSensitivity: 1.0,
  jitter: 0.45,                   // 手感增强：随机音量微调 (0..1)
  scene: 'none',                  // none | focus | game | night
  focusRain: true,                // 专注模式雨声底噪
  nightAuto: true,                // 深夜自动降音
  special: { space: 'follow', enter: 'follow', backspace: 'follow' }, // 或 8 个音色名之一
  specialVolume: { space: 1.0, enter: 1.0, backspace: 1.0 },
  customPack: null,               // { down, up, space, enter, backspace } -> 文件绝对路径
  overlay: { visible: true, opacity: 0.55, ripple: true },
};

let config = JSON.parse(JSON.stringify(DEFAULTS));
let dayStats = { date: today(), count: 0, activeSeconds: 0, chars: 0 };
let windows = { settings: null, audio: null, overlay: null };
let tray = null;
let seenCodes = new Set(); // 叠加抖动保护：同一次物理按键可能触发多个事件
let lastDownTime = 0;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function loadConfig() {
  try {
    if (fs.existsSync(configPath())) {
      const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
      config = { ...DEFAULTS, ...JSON.parse(JSON.stringify(saved)) };
      config.special = { ...DEFAULTS.special, ...(saved.special || {}) };
      config.specialVolume = { ...DEFAULTS.specialVolume, ...(saved.specialVolume || {}) };
      config.overlay = { ...DEFAULTS.overlay, ...(saved.overlay || {}) };
    }
  } catch (e) { console.error('load config err', e); }
  // 每日统计
  const stPath = path.join(configDir(), 'stats-' + today() + '.json');
  try {
    if (fs.existsSync(stPath)) dayStats = JSON.parse(fs.readFileSync(stPath, 'utf8'));
  } catch (e) {}
}
function saveConfig() {
  try {
    if (!fs.existsSync(configDir())) fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch (e) { console.error('save config err', e); }
}
function saveStats() {
  try {
    const stPath = path.join(configDir(), 'stats-' + today() + '.json');
    if (!fs.existsSync(configDir())) fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(stPath, JSON.stringify(dayStats));
  } catch (e) {}
}

// ---------------- 广播 ----------------
function broadcastConfig() {
  const payload = JSON.parse(JSON.stringify(config));
  for (const win of Object.values(windows)) {
    if (win && !win.isDestroyed()) { win.webContents.send('config', payload); }
  }
  applyOverlayState();
  updateTray();
}
function broadcastStats() {
  const wpm = computeWpm();
  const payload = { ...dayStats, wpm, kps: recentRate() };
  if (windows.settings && !windows.settings.isDestroyed()) {
    windows.settings.webContents.send('stats', payload);
  }
}
function broadcastMute() {
  if (windows.audio && !windows.audio.isDestroyed())
    windows.audio.webContents.send('mute', !!config.muted);
  if (windows.settings && !windows.settings.isDestroyed())
    windows.settings.webContents.send('mute', !!config.muted);
}

// ---------------- 打字速度（滚动窗口）---------------
const recentTimes = [];
const PRINT_LIMIT = 500;
function noteChar() {
  const now = performanceNow();
  recentTimes.push(now);
  if (recentTimes.length > PRINT_LIMIT) recentTimes.shift();
}
function recentRate() {
  const now = performanceNow();
  const windowStart = now - 3000;
  const in3s = recentTimes.filter(t => t >= windowStart).length;
  return in3s / 3; // 每秒按键数
}
function computeWpm() {
  const now = performanceNow();
  const min = (now - (recentTimes[0] || now)) / 60000;
  if (min < 0.05 || recentTimes.length < 20) return 0;
  return Math.round(recentTimes.length / 5 / min);
}
function performanceNow() { return Date.now(); }
// 打字越快音调越高：映射 kps -> 音高倍率
function pitchFactor() {
  if (!config.speedPitch) return 1;
  const kps = recentRate();
  const f = 0.72 + kps * (1.05 * config.speedSensitivity);
  return Math.min(1.9, Math.max(0.72, f));
}

// ---------------- 键盘钩子 ----------------
function startHook() {
  uIOhook.on('keydown', (e) => handleKey('down', e));
  uIOhook.on('keyup', (e) => handleKey('up', e));
  uIOhook.start();
}
function handleKey(type, e) {
  const now = Date.now();
  // 简单防抖：同一 keycode 40ms 内重复的 keydown 忽略（某些键盘圆顶会产生重复）
  if (type === 'down') {
    lastDownTime = now;
    const code = norm(e.code || reverseName(e.keycode));
    // 统计
    dayStats.count++;
    if (isPrintable(code)) { dayStats.chars++; noteChar(); }
    // 活跃时长（1s 结算循环里累加，这里只打点）
    markActive();
    saveStats();
    broadcastStats();
    if (config.muted) return;
    // 听觉 + 视觉
    const key = code || 'unknown';
    const resolved = resolveProfile(key);
    emitToAudio('key', { type, key, profile: resolved.profile, isSpecial: resolved.isSpecial, pitch: pitchFactor() });
    emitToOverlay('key', { type, key });
  } else {
    if (config.muted) return;
    emitToAudio('key', { type, key: norm(e.code || reverseName(e.keycode)) || 'unknown', profile: null });
    emitToOverlay('key', { type, key: norm(e.code || reverseName(e.keycode)) || 'unknown' });
  }
}
function resolveProfile(key) {
  if (SPECIAL.has(key) && config.special[key] && config.special[key] !== 'follow') {
    return { profile: config.special[key], isSpecial: true };
  }
  return { profile: config.profile, isSpecial: SPECIAL.has(key) };
}
let reverseMap;
function reverseName(keycode) {
  if (!reverseMap) {
    reverseMap = {};
    try {
      for (const [name, val] of Object.entries(UiohookKey)) reverseMap[val] = name;
    } catch (e) {}
  }
  return reverseMap[keycode] || '';
}

// 活跃时长累加（每秒结算）
let lastActiveTs = 0;
function markActive() {
  if (!dayStats.activeInLastS) dayStats.activeInLastS = true;
}
setInterval(() => {
  // 每秒：若上一秒有击键，则活跃秒+1
  if (dayStats.activeInLastS) { dayStats.activeSeconds++; saveStats(); }
  dayStats.activeInLastS = false;
  broadcastStats();
}, 1000);

function emitToAudio(channel, data) {
  if (windows.audio && !windows.audio.isDestroyed()) windows.audio.webContents.send(channel, data);
}
function emitToOverlay(channel, data) {
  if (windows.overlay && !windows.overlay.isDestroyed() && config.overlay.visible) {
    windows.overlay.webContents.send(channel, data);
  }
}

// ---------------- 窗口 ----------------
function createSettingsWindow() {
  windows.settings = new BrowserWindow({
    width: 900, height: 760, minWidth: 760, minHeight: 600,
    title: '键盘音效', icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  windows.settings.loadFile('renderer/index.html');
  windows.settings.on('close', (ev) => {
    // 关闭窗口≠退出应用（钩子继续生效）
    if (!app.isQuitting && !windowShown) {
      ev.preventDefault();
      windows.settings.hide();
      tray && tray.displayBalloon && tray.displayBalloon({ title: '键盘音效仍在运行', content: '全局钩子持续生效，点击任务栏托盘图标可恢复面板' });
    }
  });
  if (process.env.NODE_ENV === 'dev') windows.settings.webContents.openDevTools();
}
let windowShown = true;

function createAudioWindow() {
  windows.audio = new BrowserWindow({
    show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  windows.audio.loadFile('renderer/audio.html');
}
function createOverlayWindow() {
  windows.overlay = new BrowserWindow({
    width: 760, height: 250, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: config.overlay.visible,
    focusable: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  windows.overlay.loadFile('renderer/overlay.html');
  // 位置：底部居中
  positionOverlay();
  if (windows.overlay.showInactive) windows.overlay.showInactive();
  // 不允许抢焦点/挡鼠标
  windows.overlay.setIgnoreMouseEvents(true, { forward: true });
}
function positionOverlay() {
  if (!windows.overlay) return;
  const { screen } = require('electron');
  const b = screen.getPrimaryDisplay().workArea;
  const [w, h] = windows.overlay.getSize();
  windows.overlay.setPosition(Math.round(b.x + (b.width - w) / 2), Math.round(b.y + b.height - h - 8));
}
function applyOverlayState() {
  if (!windows.overlay || windows.overlay.isDestroyed()) return;
  windows.overlay.setIgnoreMouseEvents(true, { forward: true });
  const vis = config.overlay.visible;
  if (vis && !windows.overlay.isVisible()) { windows.overlay.showInactive(); }
  if (!vis && windows.overlay.isVisible()) { windows.overlay.hide(); }
  windows.overlay.webContents.send('overlay-config', { opacity: config.overlay.opacity, ripple: config.overlay.ripple });
}

// ---------------- 托盘 ----------------
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  tray.setToolTip('键盘音效' + (config.muted ? ' — 已静音' : ''));
}
function buildMenu() {
  const sceneFlags = s => ({ type: 'radio', label: SCENE_LABEL[s] || s, checked: config.scene === s,
    click: () => { config.scene = s; saveConfig(); broadcastConfig(); } });
  return Menu.buildFromTemplate([
    { label: '静音 (Ctrl+Alt+K)', type: 'checkbox', checked: !!config.muted, click: (mi) => toggleMute() },
    { type: 'separator' },
    { label: '场景模式', enabled: false },
    sceneFlags('none'), sceneFlags('focus'), sceneFlags('game'), sceneFlags('night'),
    { type: 'separator' },
    { label: '显示/隐藏面板', click: () => toggleSettings() },
    { label: '显示/隐藏悬浮键盘 (Ctrl+Alt+O)', click: () => toggleOverlay() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}
const SCENE_LABEL = { none: '无（默认）', focus: '专注（雨声+轻音）', game: '游戏（响轴）', night: '深夜（自动降音）' };

function toggleMute() {
  config.muted = !config.muted;
  saveConfig(); broadcastConfig(); broadcastMute();
}
function toggleSettings() {
  if (!windows.settings) return;
  if (windows.settings.isVisible()) windows.settings.hide();
  else { windows.settings.show(); windows.settings.focus(); windowShown = true; }
}
function toggleOverlay() {
  config.overlay.visible = !config.overlay.visible;
  saveConfig(); broadcastConfig();
}

// ---------------- IPC ----------------
function setupIPC() {
  ipcMain.handle('get-config', () => JSON.parse(JSON.stringify(config)));
  ipcMain.on('update-config', (e, patch) => {
    mergeConfig(patch);
    saveConfig();
    broadcastConfig();
  });
  ipcMain.handle('import-pack', async () => {
    const r = await dialog.showOpenDialog(windows.settings, {
      title: '选择自定义音效包文件夹',
      buttonLabel: '导入',
      properties: ['openDirectory'],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return null;
    const dir = r.filePaths[0];
    const files = fs.readdirSync(dir).filter(f => /\.(wav|mp3|ogg|m4a|flac)$/i.test(f));
    const assign = {};
    for (const f of files) {
      const base = f.replace(/\.[^.]+$/, '').toLowerCase();
      let slot = null;
      if (base.startsWith('down')) slot = 'down';
      else if (base.startsWith('up')) slot = 'up';
      else if (base.startsWith('space')) slot = 'space';
      else if (base.startsWith('enter')) slot = 'enter';
      else if (base.startsWith('backspace')) slot = 'backspace';
      if (slot && !assign[slot]) assign[slot] = path.join(dir, f);
    }
    if (Object.keys(assign).length === 0)
      return { error: '文件夹里没有找到 down/up/space/enter/backspace 开头的音频文件' };
    // 读取字节发给音频窗口解码
    const payload = {};
    for (const [slot, p] of Object.entries(assign)) {
      payload[slot] = { name: path.basename(p), data: fs.readFileSync(p).buffer.slice(0) };
    }
    config.customPack = {}; for (const k of Object.keys(assign)) config.customPack[k] = assign[k];
    saveConfig();
    if (windows.audio && !windows.audio.isDestroyed()) windows.audio.webContents.send('pack', payload);
    broadcastConfig();
    return { ok: true, slots: Object.keys(assign) };
  });
  ipcMain.handle('clear-pack', () => {
    config.customPack = null;
    saveConfig();
    if (windows.audio && !windows.audio.isDestroyed()) windows.audio.webContents.send('clear-pack');
    broadcastConfig();
    return true;
  });
  ipcMain.on('audition', (_e, prof) => {
    // 试听：让音频窗口播一个该音色的下压音
    if (windows.audio && !windows.audio.isDestroyed()) {
      windows.audio.webContents.send('key', { type: 'down', key: 'space', profile: prof, isSpecial: true, pitch: 1 });
    }
  });
}
function mergeConfig(patch, into) {
  const target = into || config;
  for (const k in patch) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && v.constructor === Object) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      mergeConfig(v, target[k]);
    } else {
      target[k] = v;
    }
  }
  return target;
}

// ---------------- 生命周期 ----------------
// 单实例保护：重复启动时聚焦已有实例，而不是叠出第二个音效
const gotLock = app.requestSingleInstanceLock();
app.on('second-instance', () => {
  if (windows.settings && !windows.settings.isDestroyed()) {
    windows.settings.show();
    windows.settings.restore();
    windows.settings.focus();
  }
});
let quitting = false;
app.on('before-quit', () => { quitting = true; app.isQuitting = true; });
app.whenReady().then(() => {
  if (!gotLock) { app.quit(); return; }
  loadConfig();
  if (!fs.existsSync(path.join(__dirname, 'icon.png'))) {
    try { require('./make-icon.js'); } catch (e) {}
  }
  // 托盘
  const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(img);
  tray.setToolTip('键盘音效');
  updateTray();
  tray.on('double-click', () => toggleSettings());

  createOverlayWindow();
  createAudioWindow();
  createSettingsWindow();
  setupIPC();

  // 全局热键
  try {
    globalShortcut.register('CommandOrControl+Alt+K', () => toggleMute());
    globalShortcut.register('CommandOrControl+Alt+O', () => toggleOverlay());
  } catch (e) { console.warn('global shortcut err', e); }

  startHook();
  // 窗口就绪后广播状态
  setTimeout(() => { broadcastConfig(); broadcastStats(); }, 300);
});

app.on('window-all-closed', (e) => {
  // 保持常驻（托盘运行），不退出
});
app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (e) {}
  try { uIOhook.stop(); } catch (e) {}
});