// 共享按键映射：DOM code 归一化、悬浮键盘布局、可打印判定、特殊键集合
// code 可能来自 uiohook 的 event.code（DOM 风格），或 UiohookKey 名称（A/Space 风格），
// 统一归一化成小写的规范 token。

function norm(code) {
  if (!code) return '';
  let c = String(code).trim();
  // DOM 风格: KeyA / Digit1 / Backspace / Space
  if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(c)) return 'num' + c.slice(5);
  if (/^F[0-9]+$/.test(c)) return c.toLowerCase();
  const map = {
    Backspace:'backspace', Tab:'tab', Enter:'enter', Space:'space',
    CapsLock:'capslock', Escape:'esc',
    ShiftLeft:'lshift', ShiftRight:'rshift', ControlLeft:'lctrl', ControlRight:'rctrl',
    AltLeft:'lalt', AltRight:'ralt', MetaLeft:'lmeta', MetaRight:'rmeta',
    NumpadEnter:'enter', NumpadAdd:'numpadadd', NumpadSubtract:'numpadsub',
    Minus:'minus', Equal:'equal', BracketLeft:'lbracket', BracketRight:'rbracket',
    Backslash:'backslash', Semicolon:'semicolon', Quote:'quote', Backquote:'grave',
    Comma:'comma', Period:'period', Slash:'slash',
  };
  if (map[c]) return map[c];
  const low = c.toLowerCase();
  if (/^[a-z]$/.test(low)) return low;
  if (/^[0-9]$/.test(low)) return 'num' + low;
  return low;
}

// 特殊键一览（可单独设音效）
const SPECIAL = new Set(['space', 'enter', 'backspace']);

// 悬浮键盘布局。codes 为该键可接受的 norm token 别名。
const ROWS = [
  [
    { codes:['esc'], label:'Esc', w:1.4 },
    { codes:['f1'], label:'F1' }, { codes:['f2'], label:'F2' }, { codes:['f3'], label:'F3' }, { codes:['f4'], label:'F4' },
    { codes:['f5'], label:'F5' }, { codes:['f6'], label:'F6' }, { codes:['f7'], label:'F7' }, { codes:['f8'], label:'F8' },
    { codes:['f9'], label:'F9' }, { codes:['f10'], label:'F10' }, { codes:['f11'], label:'F11' }, { codes:['f12'], label:'F12' },
  ],
  [
    { codes:['grave'], label:'`' }, { codes:['num1'], label:'1' }, { codes:['num2'], label:'2' }, { codes:['num3'], label:'3' },
    { codes:['num4'], label:'4' }, { codes:['num5'], label:'5' }, { codes:['num6'], label:'6' }, { codes:['num7'], label:'7' },
    { codes:['num8'], label:'8' }, { codes:['num9'], label:'9' }, { codes:['num0'], label:'0' }, { codes:['minus'], label:'-' },
    { codes:['equal'], label:'=' }, { codes:['backspace'], label:'⌫', w:1.9 },
  ],
  [
    { codes:['tab'], label:'Tab', w:1.5 }, { codes:['q'],label:'Q' }, { codes:['w'],label:'W' }, { codes:['e'],label:'E' },
    { codes:['r'],label:'R' }, { codes:['t'],label:'T' }, { codes:['y'],label:'Y' }, { codes:['u'],label:'U' },
    { codes:['i'],label:'I' }, { codes:['o'],label:'O' }, { codes:['p'],label:'P' }, { codes:['lbracket'],label:'[' },
    { codes:['rbracket'],label:']' }, { codes:['backslash'],label:'\\', w:1.5 },
  ],
  [
    { codes:['capslock'], label:'CAPS', w:1.8 }, { codes:['a'],label:'A' }, { codes:['s'],label:'S' }, { codes:['d'],label:'D' },
    { codes:['f'],label:'F' }, { codes:['g'],label:'G' }, { codes:['h'],label:'H' }, { codes:['j'],label:'J' },
    { codes:['k'],label:'K' }, { codes:['l'],label:'L' }, { codes:['semicolon'],label:';' }, { codes:['quote'],label:'\'' },
    { codes:['enter'], label:'Enter', w:2.2 },
  ],
  [
    { codes:['lshift'], label:'Shift', w:2.2 }, { codes:['z'],label:'Z' }, { codes:['x'],label:'X' }, { codes:['c'],label:'C' },
    { codes:['v'],label:'V' }, { codes:['b'],label:'B' }, { codes:['n'],label:'N' }, { codes:['m'],label:'M' },
    { codes:['comma'],label:',' }, { codes:['period'],label:'.' }, { codes:['slash'],label:'/' },
    { codes:['rshift'], label:'Shift', w:2.2 },
  ],
  [
    { codes:['lctrl'], label:'Ctrl' }, { codes:['lmeta'], label:'Win' }, { codes:['lalt'], label:'Alt' },
    { codes:['space'], label:'', w:6, space:true },
    { codes:['ralt'], label:'Alt' }, { codes:['rmeta'], label:'Win' }, { codes:['rctrl'], label:'Ctrl' },
  ],
];

// 打印键（用于 WPM/字符统计）：字母、数字、常用标点
function isPrintable(code) {
  return ['grave','minus','equal','lbracket','rbracket','backslash','semicolon','quote','comma','period','slash',
    'space'].includes(code) || (code && /^[a-z0-9]$/.test(code)) || (code && code.startsWith('num'));
}

module.exports = { norm, SPECIAL, ROWS, isPrintable };