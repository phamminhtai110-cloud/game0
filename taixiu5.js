/**
 * TAI XIU VN 5 - FULL FEATURES EDITION
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3005;
const DB_FILE = path.join(__dirname, 'taixiu5-db.json');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!WEBHOOK_SECRET || WEBHOOK_SECRET.length < 16) {
  console.error('Thieu WEBHOOK_SECRET');
  process.exit(1);
}

const MONETAG_META = '<meta name="monetag" content="77d13f3d5476e6baf4972ea41b762054">';
const GOOGLE_META = '<meta name="google-site-verification" content="IMWXPLpcrrsTvEsWP9Du3IOPrNdxe5ZP2CufbgxmzRw">';
const MONETAG_SCRIPTS = '<script src="//upgulpinon.com/1?z=12043589" async></script>
<script src="//upgulpinon.com/1?z=12043590" async></script>
<script src="//upgulpinon.com/1?z=12043588" async></script>
<script src="//upgulpinon.com/1?z=12043591" async></script>';

const VIP_PRICES = { VIP1: 20000, VIP2: 50000, SVIP: 100000 };
const VIP_MULT = { VIP1: 2, VIP2: 2, SVIP: 3 };
const START_COINS = 5000;
const DAILY_REWARD = 1000;
const REFERRAL_BONUS = 2000;
const MIN_BET = 100;
const MAX_BET = 10000;

const ACHIEVEMENTS = [
  { id: 'first_bet', name: 'Van dau tien', icon: '🎯', desc: 'Dat cuoc van dau' },
  { id: 'win_10', name: 'Thang 10 van', icon: '🏆', desc: 'Thang 10 van' },
  { id: 'win_100', name: 'Thang 100 van', icon: '👑', desc: 'Thang 100 van' },
  { id: 'coins_50k', name: 'Ty phu 50K', icon: '💰', desc: 'Co 50.000 xu' },
  { id: 'coins_100k', name: 'Dai gia 100K', icon: '💎', desc: 'Co 100.000 xu' },
  { id: 'bao_1', name: 'Trung Bao', icon: '🎲', desc: 'Trung Bao x30' },
  { id: 'vip_1', name: 'VIP Member', icon: '⭐', desc: 'Nang cap VIP' },
  { id: 'streak_5', name: 'Chuoi 5', icon: '🔥', desc: 'Thang 5 van lien tiep' }
];

const PROVINCES = ['Ha Noi','TP.HCM','Da Nang','Hai Phong','Nghe An','Thanh Hoa','Can Tho','Binh Duong','Dong Nai','Tinh Khac'];
const PROVINCE_LABEL = {
  'Ha Noi':'Ha Noi','TP.HCM':'TP.HCM','Da Nang':'Da Nang','Hai Phong':'Hai Phong',
  'Nghe An':'Nghe An','Thanh Hoa':'Thanh Hoa','Can Tho':'Can Tho','Binh Duong':'Binh Duong',
  'Dong Nai':'Dong Nai','Tinh Khac':'Tinh Khac'
};
const PROVINCE_SET = new Set(PROVINCES);

let db = { players: {}, provinces: {}, processedTx: {}, sessions: {} };
PROVINCES.forEach(p => db.provinces[p] = 0);

if (fs.existsSync(DB_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = Object.assign(db, loaded);
    PROVINCES.forEach(p => { if (typeof db.provinces[p] !== 'number') db.provinces[p] = 0; });
  } catch (e) {}
}

let saveTimer = null;
function saveDB() {
  if (saveTimer) return;
  saveTimer = setTimeout(function() {
    saveTimer = null;
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); } catch (e) {}
  }, 500);
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function parseBody(req, limit) {
  limit = limit || 100000;
  return new Promise(function(resolve) {
    let body = '', dead = false;
    req.on('data', function(c) {
      if (dead) return;
      body += c;
      if (body.length > limit) { dead = true; try { req.destroy(); } catch (e) {} }
    });
    req.on('end', function() {
      if (dead) return resolve({});
      try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); }
    });
    req.on('error', function() { resolve({}); });
  });
}

const rateBuckets = new Map();
function rateLimit(ip, key, max, winMs) {
  const id = ip + ':' + key;
  const now = Date.now();
  let r = rateBuckets.get(id);
  if (!r || now > r.resetAt) { r = { count: 0, resetAt: now + winMs }; rateBuckets.set(id, r); }
  r.count++;
  return r.count <= max;
}

function rollDice() { return [crypto.randomInt(1,7), crypto.randomInt(1,7), crypto.randomInt(1,7)]; }

function classify(d) {
  const sum = d[0] + d[1] + d[2];
  const allSame = d[0] === d[1] && d[1] === d[2];
  let result;
  if (allSame) result = 'bao';
  else if (sum >= 4 && sum <= 10) result = 'xiu';
  else if (sum >= 11 && sum <= 17) result = 'tai';
  else result = 'khac';
  return { sum: sum, allSame: allSame, result: result };
}

function getPlayer(code) {
  if (!db.players[code]) {
    db.players[code] = {
      coins: START_COINS,
      totalWon: 0,
      totalBet: 0,
      totalPlays: 0,
      totalWins: 0,
      streak: 0,
      maxStreak: 0,
      team: 'TP.HCM',
      vipPack: '',
      level: 1,
      xp: 0,
      achievements: [],
      lastDaily: 0,
      lastReward: 0,
      referral: null,
      referredBy: null,
      betHistory: [],
      createdAt: Date.now()
    };
    saveDB();
  }
  return db.players[code];
}

function issueToken(code) {
  const t = crypto.randomBytes(16).toString('hex');
  db.sessions[t] = { playerCode: code, createdAt: Date.now(), used: false };
  saveDB();
  return t;
}

function grantAchievement(pl, achId) {
  if (!pl.achievements) pl.achievements = [];
  if (pl.achievements.indexOf(achId) >= 0) return false;
  const ach = ACHIEVEMENTS.find(function(a) { return a.id === achId; });
  if (!ach) return false;
  pl.achievements.push(achId);
  return true;
}

function calcLevel(xp) {
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}

const CSS = 'body{font-family:system-ui,sans-serif;background:#0a0e14;color:#fff;margin:0;padding:0;line-height:1.5}'
  + 'header{background:linear-gradient(135deg,#e11d48,#be123c);padding:12px;position:sticky;top:0;z-index:10}'
  + '.hdr{max-width:900px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}'
  + '.logo{font-weight:900;font-size:18px}.logo small{display:block;font-size:10px;opacity:.85;letter-spacing:1px}'
  + '.nav a{color:#fff;text-decoration:none;padding:6px 10px;border-radius:6px;font-size:12px;margin-left:2px}'
  + '.nav a:hover{background:rgba(255,255,255,.15)}'
  + '.container{max-width:900px;margin:0 auto;padding:12px}'
  + '.ad-slot{background:#111;border:1px dashed #333;border-radius:8px;padding:20px;text-align:center;min-height:90px;margin:12px 0;color:#555;font-size:11px;display:flex;align-items:center;justify-content:center}'
  + 'footer{text-align:center;padding:20px;font-size:11px;color:#666}footer a{color:#999;text-decoration:none;margin:0 6px}'
  + '.card{background:#111;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #222}'
  + '.card h2{font-size:16px;margin:0 0 10px;color:#ffd700}'
  + '.dice-row{display:flex;gap:14px;justify-content:center;margin:20px 0}'
  + '.die{width:70px;height:70px;background:#fff;border-radius:12px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);padding:10px;gap:2px;box-shadow:0 4px 20px rgba(255,215,0,.2);transition:transform .2s}'
  + '.die.rolling{animation:shake .1s infinite}'
  + '@keyframes shake{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(8deg)}}'
  + '.die.vip{background:linear-gradient(135deg,#ffd700,#ff9500)}'
  + '.pip{background:#1a1a2e;border-radius:50%}'
  + '.sum{font-size:42px;font-weight:900;text-align:center;color:#ffd700;text-shadow:0 0 20px currentColor;min-height:50px}'
  + '.sum.tai{color:#ff0055}.sum.xiu{color:#00ffcc}.sum.bao{color:#ffd700}'
  + '.result{text-align:center;font-size:16px;font-weight:900;text-transform:uppercase;letter-spacing:2px;min-height:24px;margin-bottom:12px;transition:opacity .3s}'
  + '.result.win{color:#00ff88}.result.lose{color:#ff4444}.result.bao{color:#ffd700}'
  + '.bet-chips{display:flex;gap:8px;justify-content:center;margin-bottom:12px;flex-wrap:wrap}'
  + '.chip{padding:8px 14px;border-radius:8px;border:1px solid #ffd700;background:transparent;color:#ffd700;font-weight:700;cursor:pointer;font-size:13px;transition:all .15s}'
  + '.chip.active{background:#ffd700;color:#000;box-shadow:0 0 12px rgba(255,215,0,.6)}'
  + '.actions{display:flex;gap:10px;margin-bottom:8px}'
  + '.act{flex:1;padding:18px;border:none;border-radius:12px;font-size:17px;font-weight:900;cursor:pointer;letter-spacing:1.5px;position:relative}'
  + '.act:disabled{opacity:.4}'
  + '.act.tai{background:linear-gradient(135deg,#ff0055,#ff0080);color:#fff}'
  + '.act.xiu{background:linear-gradient(135deg,#00ffcc,#00b8ff);color:#000}'
  + '.act .mult{position:absolute;top:5px;right:8px;font-size:10px;background:rgba(0,0,0,.3);padding:2px 6px;border-radius:6px}'
  + '.bao-btn{width:100%;padding:12px;border:none;border-radius:12px;font-weight:900;font-size:15px;cursor:pointer;background:linear-gradient(135deg,#ffd700,#ff9500);color:#000;letter-spacing:1.5px;margin-top:8px}'
  + '.stats{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}'
  + '.stat{flex:1;min-width:80px;background:#111;border:1px solid #222;border-radius:10px;padding:8px;text-align:center}'
  + '.stat .lbl{font-size:10px;color:#94a3b8;text-transform:uppercase}'
  + '.stat .val{font-size:16px;font-weight:900;color:#ffd700;margin-top:4px}'
  + '.btn{padding:12px 20px;border:none;border-radius:10px;font-weight:800;cursor:pointer;font-size:14px}'
  + '.btn-primary{background:linear-gradient(45deg,#ffd700,#ff9500);color:#000}'
  + '.btn-secondary{background:#1e293b;color:#ffd700;border:1px solid #ffd700}'
  + '.btn-sm{padding:6px 12px;font-size:12px}'
  + '.content-page{padding:20px;max-width:900px;margin:0 auto}'
  + '.content-page h1{color:#ffd700;font-size:22px;margin-bottom:12px}'
  + '.content-page h2{color:#f59e0b;font-size:17px;margin-top:20px;margin-bottom:8px}'
  + '.content-page p{margin-bottom:10px;color:#cbd5e1}'
  + '.content-page ul{padding-left:24px;color:#cbd5e1}'
  + '.lb-table{width:100%;border-collapse:collapse;font-size:13px}'
  + '.lb-table th{background:#1a1a2e;color:#ffd700;padding:10px;text-align:left;font-size:11px;text-transform:uppercase}'
  + '.lb-table td{padding:10px;border-bottom:1px solid #1a1a2e;color:#cbd5e1}'
  + '.history{text-align:center;padding:10px;color:#64748b;font-size:12px}'
  + '.h-item{display:inline-block;padding:3px 8px;border-radius:6px;margin:0 2px;font-weight:700}'
  + '.h-item.tai{background:rgba(255,0,85,.2);color:#ff5577}'
  + '.h-item.xiu{background:rgba(0,255,204,.2);color:#00ffcc}'
  + '.h-item.bao{background:rgba(255,215,0,.2);color:#ffd700}'
  + '.toast-container{position:fixed;top:80px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:320px}'
  + '.toast{background:#111;border:1px solid #333;border-left:4px solid #ffd700;border-radius:8px;padding:12px 16px;color:#fff;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,.5);animation:slideIn .3s ease-out}'
  + '.toast.success{border-left-color:#00ff88}.toast.error{border-left-color:#ff4444}.toast.info{border-left-color:#00b8ff}'
  + '@keyframes slideIn{from{transform:translateX(400px);opacity:0}to{transform:translateX(0);opacity:1}}'
  + '.achievements{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}'
  + '.ach{background:#1a1a2e;border:1px solid #333;border-radius:10px;padding:10px;text-align:center;opacity:.4;transition:all .3s}'
  + '.ach.unlocked{opacity:1;border-color:#ffd700;background:linear-gradient(135deg,#1a1a2e,#2a2000)}'
  + '.ach .icon{font-size:28px}'
  + '.ach .name{font-size:11px;font-weight:800;color:#ffd700;margin-top:4px}'
  + '.ach .desc{font-size:10px;color:#94a3b8;margin-top:2px}'
  + '.level-bar{background:#1a1a2e;border-radius:8px;padding:12px;margin-bottom:12px}'
  + '.level-bar .lvl{font-size:14px;font-weight:900;color:#ffd700}'
  + '.level-bar .progress{background:#0f172a;height:8px;border-radius:4px;margin-top:8px;overflow:hidden}'
  + '.level-bar .fill{background:linear-gradient(90deg,#ffd700,#ff9500);height:100%;transition:width .3s}'
  + '.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:9998;padding:20px}'
  + '.modal-overlay.active{display:flex}'
  + '.modal-box{background:#111;border:1px solid #333;border-radius:16px;padding:24px;max-width:360px;width:100%;text-align:center}'
  + '.modal-box h3{color:#ffd700;margin-bottom:12px;font-size:18px}'
  + '@media(max-width:600px){.nav a{padding:4px 6px;font-size:11px}.die{width:54px;height:54px}.sum{font-size:32px}.toast-container{left:16px;right:16px;max-width:none}}';

function htmlLayout(opts) {
  return '<!DOCTYPE html>\n<html lang="vi">\n<head>\n'
    + '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<title>' + opts.title + '</title>\n'
    + '<meta name="description" content="' + opts.desc + '">\n'
    + '<meta name="robots" content="index, follow">\n'
    + '<link rel="canonical" href="https://taixiu-vn.onrender.com' + (opts.canonical || '/') + '">\n'
    + GOOGLE_META + '\n' + MONETAG_META + '\n' + MONETAG_SCRIPTS + '\n'
    + '<style>' + CSS + '</style>\n</head>\n<body>\n'
    + '<header><div class="hdr">\n'
    + '<div class="logo">TAI XIU VN 5<small>DAI CHIEN 63 TINH THANH</small></div>\n'
    + '<nav class="nav">\n'
    + '<a href="/">Choi</a>\n'
    + '<a href="/thanh-tich">Thanh tich</a>\n'
    + '<a href="/bxh">BXH</a>\n'
    + '<a href="/huong-dan">Huong dan</a>\n'
    + '</nav>\n</div></header>\n'
    + '<main>' + opts.content + '</main>\n'
    + '<footer>© 2026 Tai Xiu VN 5 · Game chi mang tinh giai tri<br><a href="/">Choi</a>·<a href="/thanh-tich">Thanh tich</a>·<a href="/bxh">BXH</a></footer>\n'
    + '<div class="toast-container" id="toastContainer"></div>\n'
    + '<script>' + (opts.script || '') + '</script>\n'
    + '</body>\n</html>';
}

function renderGame() {
  const content = '<div class="container">\n'
    + '<div class="ad-slot">QUANG CAO</div>\n'
    + '<div class="stats">\n'
    + '<div class="stat"><div class="lbl">Xu</div><div class="val" id="coinsVal">0</div></div>\n'
    + '<div class="stat"><div class="lbl">Tinh</div><div class="val" id="teamVal" style="font-size:11px">TP.HCM</div></div>\n'
    + '<div class="stat"><div class="lbl">VIP</div><div class="val" id="vipVal" style="font-size:11px">--</div></div>\n'
    + '<div class="stat"><div class="lbl">Cap</div><div class="val" id="levelVal">1</div></div>\n'
    + '</div>\n'
    + '<div class="level-bar">\n'
    + '<div class="lvl">Cap <span id="levelText">1</span> · XP <span id="xpText">0</span></div>\n'
    + '<div class="progress"><div class="fill" id="xpFill" style="width:0%"></div></div>\n'
    + '</div>\n'
    + '<div class="card">\n'
    + '<div class="dice-row"><div class="die" id="d0"></div><div class="die" id="d1"></div><div class="die" id="d2"></div></div>\n'
    + '<div class="sum" id="sumEl">--</div>\n'
    + '<div class="result" id="resEl"></div>\n'
    + '<div class="history">Lich su: <span id="histList" style="color:#64748b">chua co</span></div>\n'
    + '</div>\n'
    + '<div class="ad-slot">QUANG CAO</div>\n'
    + '<div class="card">\n'
    + '<div class="bet-chips" id="chipRow">\n'
    + '<button class="chip active" data-amt="100">100</button>\n'
    + '<button class="chip" data-amt="500">500</button>\n'
    + '<button class="chip" data-amt="1000">1K</button>\n'
    + '<button class="chip" data-amt="5000">5K</button>\n'
    + '<button class="chip" data-amt="10000">10K</button>\n'
    + '</div>\n'
    + '<div class="actions">\n'
    + '<button class="act xiu" id="btnXiu" onclick="bet(\'xiu\')">XIU<span class="mult" id="mx">x2</span></button>\n'
    + '<button class="act tai" id="btnTai" onclick="bet(\'tai\')">TAI<span class="mult" id="mt">x2</span></button>\n'
    + '</div>\n'
    + '<button class="bao-btn" id="btnBao" onclick="bet(\'bao\')">🎲 BAO · x30 (tong 3 hoac 18)</button>\n'
    + '</div>\n'
    + '<div class="card" style="display:flex;gap:8px;flex-wrap:wrap">\n'
    + '<button class="btn btn-primary btn-sm" onclick="claimDaily()">🎁 Diem danh</button>\n'
    + '<button class="btn btn-secondary btn-sm" onclick="openShop()">👑 Nap VIP</button>\n'
    + '<button class="btn btn-secondary btn-sm" onclick="showReferral()">👥 Moi ban</button>\n'
    + '<button class="btn btn-secondary btn-sm" onclick="showHelp()">❓ Huong dan</button>\n'
    + '</div>\n'
    + '</div>\n'
    + '<div class="modal-overlay" id="modalOverlay" onclick="closeModal(event)">\n'
    + '<div class="modal-box" id="modalBox" onclick="event.stopPropagation()"></div>\n'
    + '</div>';

  const script = [
    '(function(){',
    '  var code = localStorage.getItem("tx5_code") || "";',
    '  if (!/^TX[0-9A-F]{8}$/.test(code)) {',
    '    var a = new Uint8Array(4);',
    '    (window.crypto || window.msCrypto).getRandomValues(a);',
    '    code = "TX" + Array.from(a, function(b){ return b.toString(16).padStart(2,"0"); }).join("").toUpperCase();',
    '    localStorage.setItem("tx5_code", code);',
    '  }',
    '  window.__code = code;',
    '  var state = { coins: 0, team: "TP.HCM", vip: "", bet: 100, rolling: false, token: null, level: 1, xp: 0 };',
    '  var hist = [];',
    '  function fmt(n) { return n.toLocaleString("vi-VN"); }',
    '  function toast(msg, type) {',
    '    var c = document.getElementById("toastContainer");',
    '    var t = document.createElement("div");',
    '    t.className = "toast " + (type || "info");',
    '    t.textContent = msg;',
    '    c.appendChild(t);',
    '    setTimeout(function(){ t.style.opacity = "0"; t.style.transform = "translateX(400px)"; setTimeout(function(){ t.remove(); }, 300); }, 3500);',
    '  }',
    '  window.showToast = toast;',
    '  function updateUI() {',
    '    document.getElementById("coinsVal").textContent = fmt(state.coins);',
    '    document.getElementById("teamVal").textContent = state.team;',
    '    document.getElementById("vipVal").textContent = state.vip || "--";',
    '    document.getElementById("levelVal").textContent = state.level;',
    '    document.getElementById("levelText").textContent = state.level;',
    '    document.getElementById("xpText").textContent = fmt(state.xp);',
    '    var nextXp = Math.pow(state.level, 2) * 50;',
    '    var prevXp = Math.pow(state.level - 1, 2) * 50;',
    '    var pct = Math.min(100, Math.max(0, (state.xp - prevXp) / (nextXp - prevXp) * 100));',
    '    document.getElementById("xpFill").style.width = pct + "%";',
    '    var m = state.vip === "SVIP" ? 3 : (state.vip ? 2 : 1);',
    '    document.getElementById("mt").textContent = "x" + m;',
    '    document.getElementById("mx").textContent = "x" + m;',
    '    document.querySelectorAll(".die").forEach(function(d){ d.classList.toggle("vip", state.vip === "SVIP"); });',
    '    var d = state.rolling || state.coins < state.bet;',
    '    document.getElementById("btnTai").disabled = d;',
    '    document.getElementById("btnXiu").disabled = d;',
    '    document.getElementById("btnBao").disabled = state.rolling || state.coins < state.bet;',
    '  }',
    '  function renderDie(el, v) {',
    '    var pips = {1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};',
    '    el.innerHTML = "";',
    '    var on = pips[v] || [];',
    '    for (var i=0;i<9;i++) { var p = document.createElement("div"); p.className = "pip"; p.style.visibility = on.indexOf(i)>=0 ? "visible" : "hidden"; el.appendChild(p); }',
    '  }',
    '  var audioCtx = null;',
    '  function beep(freq, dur, vol) {',
    '    try {',
    '      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();',
    '      var osc = audioCtx.createOscillator();',
    '      var gain = audioCtx.createGain();',
    '      osc.frequency.value = freq;',
    '      gain.gain.value = vol || 0.05;',
    '      osc.connect(gain); gain.connect(audioCtx.destination);',
    '      osc.start();',
    '      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);',
    '      osc.stop(audioCtx.currentTime + dur);',
    '    } catch(e) {}',
    '  }',
    '  function playRoll() { beep(800, 0.05, 0.03); }',
    '  function playWin() { beep(1200, 0.15, 0.08); setTimeout(function(){ beep(1600, 0.2, 0.08); }, 150); }',
    '  function playLose() { beep(300, 0.3, 0.05); }',
    '  function playBao() { beep(1500, 0.1, 0.1); setTimeout(function(){ beep(1800, 0.1, 0.1); }, 100); setTimeout(function(){ beep(2200, 0.3, 0.1); }, 200); }',
    '  function animate(target, cb) {',
    '    state.rolling = true; updateUI();',
    '    var dice = [document.getElementById("d0"), document.getElementById("d1"), document.getElementById("d2")];',
    '    dice.forEach(function(el){ el.classList.add("rolling"); });',
    '    var f = 0;',
    '    var iv = setInterval(function() {',
    '      f++;',
    '      if (f % 2 === 0) playRoll();',
    '      dice.forEach(function(el) { renderDie(el, 1 + Math.floor(Math.random()*6)); });',
    '      if (f >= 12) {',
    '        clearInterval(iv);',
    '        dice.forEach(function(el){ el.classList.remove("rolling"); });',
    '        dice.forEach(function(el,i){ renderDie(el, target[i]); });',
    '        cb();',
    '      }',
    '    }, 60);',
    '  }',
    '  function showResult(dice, won, payout) {',
    '    var sum = dice[0]+dice[1]+dice[2];',
    '    var allSame = dice[0]===dice[1] && dice[1]===dice[2];',
    '    var cls = allSame ? "bao" : (sum>=11 ? "tai" : (sum>=4 ? "xiu" : "khac"));',
    '    var s = document.getElementById("sumEl");',
    '    s.textContent = sum; s.className = "sum " + cls;',
    '    var r = document.getElementById("resEl");',
    '    if (allSame && won) { r.textContent = "BAO x30 +" + fmt(payout); r.className = "result bao"; playBao(); }',
    '    else if (won) { r.textContent = "THANG +" + fmt(payout); r.className = "result win"; playWin(); }',
    '    else { r.textContent = "THUA -" + fmt(state.bet); r.className = "result lose"; playLose(); }',
    '    hist.unshift(cls); if (hist.length>10) hist.pop();',
    '    var hl = document.getElementById("histList");',
    '    if (hist.length === 0) hl.textContent = "chua co";',
    '    else hl.innerHTML = hist.map(function(c){ return \'<span class="h-item \'+c+\'">\'+(c==="tai"?"T":c==="xiu"?"X":"B")+"</span>"; }).join("");',
    '    state.rolling = false; updateUI();',
    '  }',
    '  window.bet = function(side) {',
    '    if (state.rolling || state.coins < state.bet) return;',
    '    fetch("/api/bet", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({code:code,team:state.team,side:side,amount:state.bet,token:state.token}) })',
    '      .then(function(r){return r.json()}).then(function(res){',
    '        if (!res.success) { toast(res.error||"Loi", "error"); return; }',
    '        state.coins = res.coins; state.token = res.newToken; state.xp = res.xp; state.level = res.level;',
    '        animate(res.dice, function(){ showResult(res.dice, res.won, res.payout); });',
    '        if (res.newAchievements && res.newAchievements.length > 0) {',
    '          res.newAchievements.forEach(function(ach) {',
    '            setTimeout(function() { toast("🏆 " + ach.icon + " " + ach.name, "success"); }, 500);',
    '          });',
    '        }',
    '        if (res.levelUp) toast("🎉 Len cap " + res.level + "!", "success");',
    '      }).catch(function(){ toast("Loi ket noi", "error"); });',
    '  };',
    '  window.openShop = function() {',
    '    var memo = "VIP1 " + code;',
    '    var q = "https://img.vietqr.io/image/MB-0865085878-compact2.png?amount=20000&addInfo=" + encodeURIComponent(memo);',
    '    showModal("<h3>Nap VIP</h3><img src=\'" + q + "\' style=\'max-width:280px;border-radius:12px;margin:12px 0\'><p style=\'font-size:13px;color:#94a3b8\'>Noi dung: <b style=\'color:#ffd700\'>" + memo + "</b></p><p style=\'font-size:12px;color:#64748b;margin-top:8px\'>Quet QR bang app MBBank</p><button class=\'btn btn-primary\' style=\'margin-top:12px\' onclick=\'closeModalForce()\'>Dong</button>");',
    '  };',
    '  window.claimDaily = function() {',
    '    fetch("/api/daily", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({code:code}) })',
    '      .then(function(r){return r.json()}).then(function(res){',
    '        if (res.success) { state.coins = res.coins; updateUI(); toast("🎁 +" + fmt(res.amount) + " xu diem danh!", "success"); }',
    '        else toast(res.error || "Hom nay da diem danh", "info");',
    '      });',
    '  };',
    '  window.showReferral = function() {',
    '    var link = window.location.origin + "?ref=" + code;',
    '    showModal("<h3>Moi ban</h3><p style=\'font-size:13px;color:#94a3b8\'>Chia se link nay. Ca ban va nguoi moi deu nhan " + fmt(2000) + " xu!</p><input type=\'text\' value=\'" + link + "\' style=\'width:100%;padding:10px;border-radius:8px;background:#0a0e14;color:#ffd700;border:1px solid #333;font-size:11px;margin:12px 0\' onclick=\'this.select()\' readonly><button class=\'btn btn-primary\' onclick=\'copyReferral()\'>Copy link</button> <button class=\'btn btn-secondary\' onclick=\'closeModalForce()\'>Dong</button>");',
    '  };',
    '  window.copyReferral = function() {',
    '    var input = document.querySelector(".modal-box input");',
    '    input.select(); document.execCommand("copy"); toast("Da copy link!", "success");',
    '  };',
    '  window.showHelp = function() {',
    '    showModal("<h3>Huong dan</h3><div style=\'text-align:left;font-size:13px;color:#cbd5e1;line-height:1.7\'><p><b>TAI:</b> tong 11-17, x2 (x3 VIP)</p><p><b>XIU:</b> tong 4-10, x2 (x3 VIP)</p><p><b>BAO:</b> 3 xuc xac giong nhau, x30</p><p><b>Diem danh:</b> 1.000 xu/ngay</p><p><b>Moi ban:</b> +2.000 xu</p></div><button class=\'btn btn-primary\' style=\'margin-top:12px\' onclick=\'closeModalForce()\'>Dong</button>");',
    '  };',
    '  window.showModal = function(html) {',
    '    document.getElementById("modalBox").innerHTML = html;',
    '    document.getElementById("modalOverlay").classList.add("active");',
    '  };',
    '  window.closeModal = function(e) { if (e && e.target && e.target.id === "modalOverlay") closeModalForce(); };',
    '  window.closeModalForce = function() { document.getElementById("modalOverlay").classList.remove("active"); };',
    '  function loadMe() {',
    '    fetch("/api/me?code=" + encodeURIComponent(code)).then(function(r){return r.json()}).then(function(res){',
    '      state.coins = res.coins; state.team = res.team; state.vip = res.vip; state.token = res.token; state.xp = res.xp || 0; state.level = res.level || 1; updateUI();',
    '    }).catch(function(){});',
    '  }',
    '  document.querySelectorAll(".chip").forEach(function(c) {',
    '    c.addEventListener("click", function() {',
    '      document.querySelectorAll(".chip").forEach(function(x){x.classList.remove("active")});',
    '      c.classList.add("active"); state.bet = parseInt(c.dataset.amt, 10); updateUI();',
    '    });',
    '  });',
    '  var params = new URLSearchParams(window.location.search);',
    '  var ref = params.get("ref");',
    '  if (ref && /^TX[0-9A-F]{8}$/.test(ref) && ref !== code) {',
    '    fetch("/api/referral", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({code:code, ref:ref}) })',
    '      .then(function(r){return r.json()}).then(function(res){',
    '        if (res.success) { toast("🎉 +" + fmt(2000) + " xu tu link moi!", "success"); loadMe(); }',
    '      }).catch(function(){});',
    '  }',
    '  loadMe();',
    '})();'
  ].join('\n');

  return htmlLayout({
    title: 'Tai Xiu Online 5 - Game Tai Xiu Mien Phi, Dua Top 63 Tinh',
    desc: 'Choi Tai Xiu online mien phi, co Bao, diem danh, thanh tich, moi ban, VIP. Dua top 63 tinh thanh!',
    canonical: '/',
    content: content,
    script: script
  });
}

function renderThanhTich() {
  const content = '<div class="content-page">\n'
    + '<h1>Thanh Tich Cua Ban</h1>\n'
    + '<div id="profile">Dang tai...</div>\n'
    + '<h2>Huy Hieu</h2>\n'
    + '<div class="achievements" id="achGrid">Dang tai...</div>\n'
    + '<h2>Lich Su Van Choi</h2>\n'
    + '<div id="betHistory">Dang tai...</div>\n'
    + '</div>';

  const script = [
    '(function(){',
    '  var code = localStorage.getItem("tx5_code") || "";',
    '  if (!/^TX[0-9A-F]{8}$/.test(code)) { document.getElementById("profile").textContent = "Ban chua choi van nao."; return; }',
    '  fetch("/api/profile?code=" + code).then(function(r){return r.json()}).then(function(p){',
    '    var html = "<div class=\'card\'>"',
    '      + "<p><b>Ma:</b> " + code + "</p>"',
    '      + "<p><b>Cap:</b> " + (p.level||1) + " · XP " + (p.xp||0) + "</p>"',
    '      + "<p><b>Xu:</b> " + (p.coins||0).toLocaleString("vi-VN") + "</p>"',
    '      + "<p><b>Tong cuoc:</b> " + (p.totalPlays||0) + " van</p>"',
    '      + "<p><b>Thang:</b> " + (p.totalWins||0) + " van</p>"',
    '      + "<p><b>Chuoi thang dai nhat:</b> " + (p.maxStreak||0) + "</p>"',
    '      + "<p><b>Tong thang:</b> " + (p.totalWon||0).toLocaleString("vi-VN") + " xu</p>"',
    '      + "<p><b>VIP:</b> " + (p.vipPack||"Chua co") + "</p>"',
    '      + "</div>";',
    '    document.getElementById("profile").innerHTML = html;',
    '    var achs = p.allAchievements || [];',
    '    var unlocked = p.achievements || [];',
    '    document.getElementById("achGrid").innerHTML = achs.map(function(a){',
    '      var u = unlocked.indexOf(a.id) >= 0;',
    '      return \'<div class="ach \'+(u?"unlocked":"")+\'"><div class="icon">\'+a.icon+\'</div><div class="name">\'+a.name+\'</div><div class="desc">\'+a.desc+\'</div></div>\';',
    '    }).join("");',
    '    var hist = p.betHistory || [];',
    '    if (hist.length === 0) { document.getElementById("betHistory").innerHTML = "<p style=\'color:#64748b\'>Chua co van nao.</p>"; return; }',
    '    var rows = hist.slice(0, 20).map(function(h){',
    '      var t = new Date(h.t).toLocaleString("vi-VN");',
    '      var cls = h.won ? "win" : "lose";',
    '      var color = h.won ? "#00ff88" : "#ff4444";',
    '      var sign = h.won ? "+" : "-";',
    '      return \'<tr><td style="font-size:11px;color:#64748b">\'+t+\'</td><td>\'+h.side.toUpperCase()+\'</td><td>\'+h.sum+\'</td><td style="color:\'+color+\';font-weight:700">\'+sign+h.amount.toLocaleString("vi-VN")+\'</td></tr>\';',
    '    }).join("");',
    '    document.getElementById("betHistory").innerHTML = \'<div class="card"><table class="lb-table"><thead><tr><th>Thoi gian</th><th>Cua</th><th>Tong</th><th>Ket qua</th></tr></thead><tbody>\'+rows+\'</tbody></table></div>\';',
    '  }).catch(function(){ document.getElementById("profile").textContent = "Loi tai du lieu."; });',
    '})();'
  ].join('\n');

  return htmlLayout({
    title: 'Thanh Tich Ca Nhan - Tai Xiu VN 5',
    desc: 'Xem thanh tich ca nhan: cap do, huy hieu, lich su van cuoc.',
    canonical: '/thanh-tich',
    content: content,
    script: script
  });
}

function renderBXH() {
  const sorted = Object.keys(db.provinces).map(function(n) { return { name: PROVINCE_LABEL[n] || n, score: db.provinces[n] }; }).sort(function(a,b) { return b.score - a.score; });
  const rows = sorted.map(function(p, i) {
    const medal = ['1.','2.','3.'][i] || (i+1)+'.';
    return '<tr><td>' + medal + '</td><td><b>' + p.name + '</b></td><td style="color:#ffd700;font-weight:700">' + p.score.toLocaleString('vi-VN') + ' xu</td></tr>';
  }).join('');
  const content = '<div class="content-page">\n'
    + '<h1>Bang Xep Hang 63 Tinh Thanh</h1>\n'
    + '<p>Tong xu thang cua tung tinh thanh. Cap nhat realtime.</p>\n'
    + '<div class="card"><table class="lb-table"><thead><tr><th>#</th><th>Tinh Thanh</th><th>Tong Xu</th></tr></thead>\n'
    + '<tbody>' + rows + '</tbody></table></div>\n'
    + '</div>';
  return htmlLayout({
    title: 'BXH Tai Xiu 63 Tinh Thanh - Realtime',
    desc: 'Bang xep hang Tai Xiu 63 tinh thanh Vietnam.',
    canonical: '/bxh',
    content: content
  });
}

function renderHuongDan() {
  const content = '<div class="content-page">\n'
    + '<h1>Huong Dan Choi Tai Xiu</h1>\n'
    + '<p>Tai Xiu (Sic Bo) la tro choi dua tren tong diem ba vien xuc xac. Nguoi choi dat cuoc vao cua Tai hoac Xiu.</p>\n'
    + '<h2>Luat choi</h2>\n'
    + '<ul><li><b>Tai:</b> Tong 11-17, thang x2 (x3 VIP)</li>'
    + '<li><b>Xiu:</b> Tong 4-10, thang x2 (x3 VIP)</li>'
    + '<li><b>Bao:</b> 3 xuc xac giong nhau, thang x30</li></ul>\n'
    + '<h2>Tinh nang</h2>\n'
    + '<ul><li><b>Diem danh:</b> +1.000 xu/ngay</li>'
    + '<li><b>Moi ban:</b> +2.000 xu cho ca 2</li>'
    + '<li><b>Cap do:</b> Tang XP moi van, len cap</li>'
    + '<li><b>Huy hieu:</b> 8 huy hieu de mo khoa</li></ul>\n'
    + '<h2>Meo</h2>\n'
    + '<ul><li>Quan ly von: cuoc 1-5% so xu</li>'
    + '<li>Tan dung VIP: he so x2/x3</li>'
    + '<li>Choi Bao khi co nhieu xu: rui ro cao, thuong lon</li></ul>\n'
    + '</div>';
  return htmlLayout({
    title: 'Huong Dan Choi Tai Xiu - Luat Choi, Meo Hay',
    desc: 'Huong dan day du: luat, meo, tinh nang diem danh, moi ban, cap do.',
    canonical: '/huong-dan',
    content: content
  });
}

const server = http.createServer(async function(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderGame());
  }
  if (req.method === 'GET' && pathname === '/thanh-tich') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderThanhTich());
  }
  if (req.method === 'GET' && pathname === '/bxh') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderBXH());
  }
  if (req.method === 'GET' && pathname === '/huong-dan') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderHuongDan());
  }

  if (req.method === 'GET' && pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('User-agent: *\nAllow: /\nSitemap: https://taixiu-vn.onrender.com/sitemap.xml\n');
  }

  if (req.method === 'GET' && pathname === '/sitemap.xml') {
    const urls = ['/', '/thanh-tich', '/bxh', '/huong-dan'];
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + urls.map(function(u) { return '  <url><loc>https://taixiu-vn.onrender.com' + u + '</loc></url>'; }).join('\n')
      + '\n</urlset>';
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    return res.end(xml);
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    const sorted = Object.keys(db.provinces).map(function(n) { return { name: PROVINCE_LABEL[n] || n, score: db.provinces[n] }; }).sort(function(a,b) { return b.score - a.score; });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(sorted));
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    const code = String(parsed.query.code || '').toUpperCase();
    if (!/^TX[0-9A-F]{8}$/.test(code)) { res.writeHead(400); return res.end('{}'); }
    const pl = getPlayer(code);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ coins: pl.coins, team: pl.team, vip: pl.vipPack, xp: pl.xp, level: pl.level, token: issueToken(code) }));
  }

  if (req.method === 'GET' && pathname === '/api/profile') {
    const code = String(parsed.query.code || '').toUpperCase();
    if (!/^TX[0-9A-F]{8}$/.test(code)) { res.writeHead(400); return res.end('{}'); }
    const pl = getPlayer(code);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      coins: pl.coins, level: pl.level, xp: pl.xp,
      totalPlays: pl.totalPlays, totalWins: pl.totalWins,
      maxStreak: pl.maxStreak, totalWon: pl.totalWon,
      vipPack: pl.vipPack, achievements: pl.achievements || [],
      betHistory: (pl.betHistory || []).slice(-30).reverse(),
      allAchievements: ACHIEVEMENTS
    }));
  }

  if (req.method === 'POST' && pathname === '/api/bet') {
    if (!rateLimit(ip, 'bet', 60, 60000)) { res.writeHead(429); return res.end('{"success":false,"error":"Ban cuoc qua nhanh"}'); }
    const b = await parseBody(req);
    const code = String(b.code || '').toUpperCase();
    const team = String(b.team || '');
    const side = String(b.side || '');
    const amount = Math.floor(Number(b.amount) || 0);
    const token = String(b.token || '');

    if (!/^TX[0-9A-F]{8}$/.test(code) || !PROVINCE_SET.has(team) || ['tai','xiu','bao'].indexOf(side) < 0) {
      res.writeHead(400); return res.end('{"success":false,"error":"Du lieu khong hop le"}');
    }
    if (amount < MIN_BET || amount > MAX_BET) {
      res.writeHead(400); return res.end('{"success":false,"error":"Cuoc phai tu 100 den 10000 xu"}');
    }
    const sess = db.sessions[token];
    if (!sess || sess.playerCode !== code || sess.used) {
      res.writeHead(400); return res.end('{"success":false,"error":"Phien het han, tai lai trang"}');
    }
    sess.used = true;

    const pl = getPlayer(code);
    if (pl.coins < amount) { res.writeHead(400); return res.end('{"success":false,"error":"Khong du xu"}'); }
    pl.team = team;

    const dice = rollDice();
    const cls = classify(dice);
    const mult = VIP_MULT[pl.vipPack] || 1;

    let won = false, payout = 0;
    if (side === 'bao') {
      if (cls.allSame) { won = true; payout = amount * 30 * mult; }
    } else if (cls.allSame) {
      if (side === 'tai' || side === 'xiu') { won = true; payout = amount * 30 * mult; }
    } else if ((cls.result === 'tai' && side === 'tai') || (cls.result === 'xiu' && side === 'xiu')) {
      won = true; payout = amount * 2 * mult;
    } else if (!cls.allSame && (cls.sum === 3 || cls.sum === 18) && (side === 'tai' || side === 'xiu')) {
      payout = amount;
    }

    let delta = won ? (payout - amount) : (payout === amount ? 0 : -amount);
    pl.coins += delta;

    pl.totalPlays = (pl.totalPlays || 0) + 1;
    pl.totalBet = (pl.totalBet || 0) + amount;
    if (won) {
      pl.totalWins = (pl.totalWins || 0) + 1;
      pl.streak = (pl.streak || 0) + 1;
      if (pl.streak > (pl.maxStreak || 0)) pl.maxStreak = pl.streak;
    } else {
      pl.streak = 0;
    }

    pl.xp = (pl.xp || 0) + (won ? 10 : 3);
    const oldLevel = pl.level || 1;
    pl.level = calcLevel(pl.xp);
    const levelUp = pl.level > oldLevel;

    if (won && payout > amount) {
      const profit = payout - amount;
      db.provinces[team] = (db.provinces[team] || 0) + profit;
      pl.totalWon = (pl.totalWon || 0) + profit;
    }

    if (!pl.betHistory) pl.betHistory = [];
    pl.betHistory.push({ t: Date.now(), side: side, sum: cls.sum, amount: amount, won: won, payout: payout });
    if (pl.betHistory.length > 100) pl.betHistory = pl.betHistory.slice(-100);

    const newAch = [];
    if (pl.totalPlays === 1 && grantAchievement(pl, 'first_bet')) newAch.push(ACHIEVEMENTS.find(function(a){return a.id==='first_bet';}));
    if (pl.totalWins >= 10 && grantAchievement(pl, 'win_10')) newAch.push(ACHIEVEMENTS.find(function(a){return a.id==='win_10';}));
    if (pl.totalWins >= 100 && grantAchievement(pl, 'win_100')) newAch.push(ACHIEVEMENTS.find(function(a){return a.id==='win_100';}));
    if (pl.coins >= 50000 && grantAchievement(pl, 'coins_50k')) newAch.push(ACHIEVEMENTS.find(function(a){return a.id==='coins_50k';}));
    if (pl.coins >= 100000 && grantAchievement(pl, 'coins_100k')) newAch.push(ACHIEVEMENTS.find(function(a){return a.id==='coins_100k';}));
    if (cls.allSame && won && grantAchievement(pl, 'bao_1')) newAch.push(ACHIEVEMENTS.find(function(a){return a.id==='bao_1';}));
    if (pl.vipPack && grantAchievement(pl, 'vip_1')) newAch.push(ACHIEVEMENTS.find(function(a){return a.id==='vip_1';}));
    if (pl.streak >= 5 && grantAchievement(pl, 'streak_5')) newAch.push(ACHIEVEMENTS.find(function(a){return a.id==='streak_5';}));

    const newToken = issueToken(code);
    saveDB();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true, dice: dice, sum: cls.sum, allSame: cls.allSame,
      won: won, payout: payout, coins: pl.coins, newToken: newToken,
      xp: pl.xp, level: pl.level, levelUp: levelUp,
      newAchievements: newAch.filter(Boolean)
    }));
  }

  if (req.method === 'POST' && pathname === '/api/daily') {
    const b = await parseBody(req);
    const code = String(b.code || '').toUpperCase();
    if (!/^TX[0-9A-F]{8}$/.test(code)) { res.writeHead(400); return res.end('{}'); }
    const pl = getPlayer(code);
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;
    if (pl.lastDaily && (now - pl.lastDaily) < dayMs) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Hom nay da diem danh, quay lai sau!' }));
    }
    pl.lastDaily = now;
    pl.coins += DAILY_REWARD;
    saveDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, coins: pl.coins, amount: DAILY_REWARD }));
  }

  if (req.method === 'POST' && pathname === '/api/referral') {
    const b = await parseBody(req);
    const code = String(b.code || '').toUpperCase();
    const ref = String(b.ref || '').toUpperCase();
    if (!/^TX[0-9A-F]{8}$/.test(code) || !/^TX[0-9A-F]{8}$/.test(ref) || code === ref) {
      res.writeHead(400); return res.end('{}');
    }
    const pl = getPlayer(code);
    if (pl.referredBy) { res.writeHead(200); return res.end('{"success":false,"error":"Da dung link moi"}'); }
    const refPl = getPlayer(ref);
    pl.referredBy = ref;
    pl.coins += REFERRAL_BONUS;
    refPl.coins += REFERRAL_BONUS;
    saveDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, coins: pl.coins }));
  }

  if (req.method === 'GET' && pathname === '/api/check-vip') {
    const code = String(parsed.query.code || '').toUpperCase();
    if (!/^TX[0-9A-F]{8}$/.test(code)) { res.writeHead(400); return res.end('{"paid":false}'); }
    const pl = db.players[code];
    if (pl && pl.vipPack) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ paid: true, data: { pack: pl.vipPack } }));
    }
    res.writeHead(200); return res.end('{"paid":false}');
  }

  if (req.method === 'POST' && pathname === '/api/webhook/payment') {
    const auth = req.headers['authorization'] || '';
    const ct = req.headers['secure-token'] || '';
    const ok = safeEqual(auth, 'Apikey ' + WEBHOOK_SECRET) || safeEqual(auth, 'Bearer ' + WEBHOOK_SECRET) || safeEqual(ct, WEBHOOK_SECRET);
    if (!ok) { res.writeHead(401); return res.end('{"success":false}'); }

    const b = await parseBody(req);
    const txs = [];
    if (b && b.transferAmount && b.content) {
      if (!b.transferType || b.transferType === 'in') {
        txs.push({ id: String(b.id || b.referenceCode || ''), amount: Number(b.transferAmount), content: String(b.content).toUpperCase() });
      }
    } else if (b && Array.isArray(b.data)) {
      b.data.forEach(function(it) { txs.push({ id: String(it.id || it.tid || ''), amount: Number(it.amount), content: String(it.description || '').toUpperCase() }); });
    }

    let activated = 0;
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (!Number.isFinite(tx.amount) || tx.amount <= 0) continue;
      const key = tx.id || crypto.createHash('md5').update(tx.amount + '|' + tx.content).digest('hex');
      if (db.processedTx[key]) continue;
      const pm = tx.content.match(/TX[0-9A-F]{8}/);
      const pk = tx.content.match(/VIP1|VIP2|SVIP/);
      if (pm) {
        const code = pm[0];
        const pack = pk ? pk[0] : 'VIP1';
        const min = VIP_PRICES[pack] || 20000;
        if (tx.amount >= min) {
          const pl = getPlayer(code);
          pl.vipPack = pack;
          if (grantAchievement(pl, 'vip_1')) {}
          activated++;
          console.log('[VIP] +' + tx.amount + 'd -> ' + pack + ' cho ' + code);
        }
      }
      db.processedTx[key] = Date.now();
    }
    if (txs.length) saveDB();
    res.writeHead(200); return res.end(JSON.stringify({ success: true, activated: activated }));
  }

  if (pathname === '/favicon.ico' || pathname === '/og-image.png') {
    res.writeHead(204); return res.end();
  }

  res.writeHead(404); res.end('404 Not Found');
});

server.listen(PORT, function() {
  console.log('====================================================');
  console.log('TAI XIU VN 5 - FULL FEATURES');
  console.log('Web:        http://localhost:' + PORT);
  console.log('Thanh tich: http://localhost:' + PORT + '/thanh-tich');
  console.log('BXH:        http://localhost:' + PORT + '/bxh');
  console.log('Huong dan:  http://localhost:' + PORT + '/huong-dan');
  console.log('Webhook:    http://localhost:' + PORT + '/api/webhook/payment');
  console.log('====================================================');
});

process.on('SIGINT', function() { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch(e) {} process.exit(0); });
process.on('SIGTERM', function() { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch(e) {} process.exit(0); });