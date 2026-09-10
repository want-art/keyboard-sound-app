// 透明悬浮键盘 + 波纹特效
'use strict';

// 键盘布局（与 keymaps.js 一致，浏览器端直接内嵌）
const ROWS = [
  [
    { codes:['esc'], label:'Esc', w:1.4 },
    { codes:['f1'],label:'F1' },{ codes:['f2'],label:'F2' },{ codes:['f3'],label:'F3' },{ codes:['f4'],label:'F4' },
    { codes:['f5'],label:'F5' },{ codes:['f6'],label:'F6' },{ codes:['f7'],label:'F7' },{ codes:['f8'],label:'F8' },
    { codes:['f9'],label:'F9' },{ codes:['f10'],label:'F10' },{ codes:['f11'],label:'F11' },{ codes:['f12'],label:'F12' },
  ],
  [
    { codes:['grave'],label:'`' },{ codes:['num1'],label:'1' },{ codes:['num2'],label:'2' },{ codes:['num3'],label:'3' },
    { codes:['num4'],label:'4' },{ codes:['num5'],label:'5' },{ codes:['num6'],label:'6' },{ codes:['num7'],label:'7' },
    { codes:['num8'],label:'8' },{ codes:['num9'],label:'9' },{ codes:['num0'],label:'0' },{ codes:['minus'],label:'-' },
    { codes:['equal'],label:'=' },{ codes:['backspace'],label:'⌫',w:1.9 },
  ],
  [
    { codes:['tab'],label:'Tab',w:1.5 },{ codes:['q'],label:'Q' },{ codes:['w'],label:'W' },{ codes:['e'],label:'E' },
    { codes:['r'],label:'R' },{ codes:['t'],label:'T' },{ codes:['y'],label:'Y' },{ codes:['u'],label:'U' },
    { codes:['i'],label:'I' },{ codes:['o'],label:'O' },{ codes:['p'],label:'P' },{ codes:['lbracket'],label:'[' },
    { codes:['rbracket'],label:']' },{ codes:['backslash'],label:'\\',w:1.5 },
  ],
  [
    { codes:['capslock'],label:'CAPS',w:1.8 },{ codes:['a'],label:'A' },{ codes:['s'],label:'S' },{ codes:['d'],label:'D' },
    { codes:['f'],label:'F' },{ codes:['g'],label:'G' },{ codes:['h'],label:'H' },{ codes:['j'],label:'J' },
    { codes:['k'],label:'K' },{ codes:['l'],label:'L' },{ codes:['semicolon'],label:';' },{ codes:['quote'],label:'\'' },
    { codes:['enter'],label:'Enter',w:2.2 },
  ],
  [
    { codes:['lshift'],label:'Shift',w:2.2 },{ codes:['z'],label:'Z' },{ codes:['x'],label:'X' },{ codes:['c'],label:'C' },
    { codes:['v'],label:'V' },{ codes:['b'],label:'B' },{ codes:['n'],label:'N' },{ codes:['m'],label:'M' },
    { codes:['comma'],label:',' },{ codes:['period'],label:'.' },{ codes:['slash'],label:'/' },
    { codes:['rshift'],label:'Shift',w:2.2 },
  ],
  [
    { codes:['lctrl'],label:'Ctrl' },{ codes:['lmeta'],label:'Win' },{ codes:['lalt'],label:'Alt' },
    { codes:['space'],label:'',w:6,space:true },
    { codes:['ralt'],label:'Alt' },{ codes:['rmeta'],label:'Win' },{ codes:['rctrl'],label:'Ctrl' },
  ],
];

function launch() {
  const board = document.getElementById('board');
  const fx = document.getElementById('fx');
  const wrap = document.getElementById('wrap');
  const ctx2d = fx.getContext('2d');
  let cfg = { opacity: 0.55, ripple: true };
  let idleTimer = null;

  // ---- canvas 适配 ----
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    fx.width = wrap.clientWidth * dpr; fx.height = wrap.clientHeight * dpr;
    fx.style.width = wrap.clientWidth + 'px'; fx.style.height = wrap.clientHeight + 'px';
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  // ---- 构建键盘 ----
  const keyIndex = {};   // code -> element
  function norm(code) {
    if (!code) return '';
    let c = String(code).trim();
    if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
    if (/^Digit[0-9]$/.test(c)) return 'num' + c.slice(5);
    if (/^F[0-9]+$/.test(c)) return c.toLowerCase();
    const m = { Backspace:'backspace', Tab:'tab', Enter:'enter', Space:'space', CapsLock:'capslock', Escape:'esc',
      ShiftLeft:'lshift', ShiftRight:'rshift', ControlLeft:'lctrl', ControlRight:'rctrl', AltLeft:'lalt', AltRight:'ralt',
      MetaLeft:'lmeta', MetaRight:'rmeta', Minus:'minus', Equal:'equal', BracketLeft:'lbracket', BracketRight:'rbracket',
      Backslash:'backslash', Semicolon:'semicolon', Quote:'quote', Backquote:'grave', Comma:'comma', Period:'period', Slash:'slash' };
    if (m[c]) return m[c];
    const low = c.toLowerCase();
    if (/^[a-z]$/.test(low)) return low;
    if (/^[0-9]$/.test(low)) return 'num' + low;
    return low;
  }
  ROWS.forEach(row => {
    const rowEl = document.createElement('div'); rowEl.className = 'row';
    row.forEach(k => {
      const el = document.createElement('div');
      el.className = 'key' + (k.space ? ' space' : '');
      if (k.w) el.style.setProperty('--w', k.w);
      if (k.label === '') { el.innerHTML = '&nbsp;'; }
      else el.textContent = k.label;
      rowEl.appendChild(el);
      for (const c of k.codes) keyIndex[c] = el;
    });
    board.appendChild(rowEl);
  });

  // ---- 波纹 ----
  const ripples = [];
  let raf = null;
  function centerOf(el) {
    const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    return { x: r.left + r.width / 2 - w.left, y: r.top + r.height / 2 - w.top };
  }
  function spawnRipple(x, y) {
    if (!cfg.ripple) return;
    ripples.push({ x, y, r: 8, a: 0.85 });
    if (!raf) raf = requestAnimationFrame(drawRipples);
  }
  function drawRipples() {
    ctx2d.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight);
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r += 3.2; rp.a -= 0.028;
      if (rp.a <= 0.02 || rp.r > Math.max(wrap.clientWidth, wrap.clientHeight)) { ripples.splice(i, 1); continue; }
      const grad = ctx2d.createRadialGradient(rp.x, rp.y, rp.r * 0.1, rp.x, rp.y, rp.r);
      grad.addColorStop(0, `rgba(120,180,255,${rp.a * 0.05})`);
      grad.addColorStop(0.6, `rgba(110,168,255,${rp.a * 0.35})`);
      grad.addColorStop(1, `rgba(139,92,246,0)`);
      ctx2d.beginPath();
      ctx2d.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx2d.fillStyle = grad;
      ctx2d.fill();
      ctx2d.strokeStyle = `rgba(140,180,255,${rp.a * 0.6})`;
      ctx2d.lineWidth = 2;
      ctx2d.stroke();
    }
    if (ripples.length) raf = requestAnimationFrame(drawRipples);
    else { raf = null; ctx2d.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight); }
  }

  // ---- 点亮 / 空闲淡出 ----
  const pressClass = new Map(); // el -> 当前按下的类名状态
  const pressed = new Set();
  function wake() {
    document.body.classList.remove('idle');
    document.body.classList.add('active');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      document.body.classList.add('idle');
      document.body.classList.remove('active');
    }, 2800);
  }
  function pressKey(code, type) {
    if (!code) return;
    const el = keyIndex[code];
    if (type === 'down') {
      pressed.add(el);
      if (el) { el.classList.add('press'); spawnRipple(centerOf(el).x, centerOf(el).y); }
      else { spawnRipple(wrap.clientWidth / 2, wrap.clientHeight / 2); }
      wake();
    } else {
      if (el) el.classList.remove('press');
      pressed.delete(el);
    }
  }

  // ---- 接收事件 ----
  window.api.on('key', (k) => { if (k.type === 'down' || k.type === 'up') pressKey(norm(k.key), k.type); });
  window.api.on('overlay-config', (c) => {
    cfg = { ...cfg, ...(c || {}) };
    document.documentElement.style.setProperty('--opacity', String(cfg.opacity));
  });

  // 初始化
  resize();
  document.body.classList.add('idle');
  // 主进程广播配置前先给个默认
  document.documentElement.style.setProperty('--opacity', '0.55');
}
launch();