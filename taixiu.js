/**
 * TAI XIU VN - ALL-IN-ONE SINGLE FILE
 * Chạy: WEBHOOK_SECRET=<secret> node taixiu.js
 * Port mặc định: 3001 (để chạy song song với Neon Dodge trên 3000)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// ================= 1. CẤU HÌNH =================
const PORT = process.env.PORT || 3001;
const BANK_ID = 'MB';
const ACCOUNT_NO = '0865085878';
const DB_FILE = path.join(__dirname, 'taixiu-db.json');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET || WEBHOOK_SECRET.length < 16) {
  console.error('❌ Thiếu WEBHOOK_SECRET (>=16 ký tự)');
  process.exit(1);
}

const PACK_PRICES = { VIP1: 20000, VIP2: 50000, SVIP: 100000 };
const VIP_MULTIPLIER = { VIP1: 2, VIP2: 2, SVIP: 3 };
const START_COINS = 10000;
const MIN_BET = 100;
const MAX_BET = 5000;

const PROVINCES = Object.freeze([
  'Hà Nội','TP.HCM','Đà Nẵng','Hải Phòng','Nghệ An',
  'Thanh Hóa','Cần Thơ','Bình Dương','Đồng Nai','Tỉnh Khác'
]);
const PROVINCE_SET = new Set(PROVINCES);

// ================= 2. DATABASE =================
let db = {
  players: {},      // code -> { coins, totalWon, team, vipPack, vips: [], createdAt }
  provinces: {},    // team -> total won coins
  processedTx: {},
  sessions: {}      // token -> { playerCode, createdAt, used }
};

PROVINCES.forEach(p => db.provinces[p] = 0);

if (fs.existsSync(DB_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = Object.assign(db, loaded);
    PROVINCES.forEach(p => { if (typeof db.provinces[p] !== 'number') db.provinces[p] = 0; });
    for (const k of Object.keys(db.provinces)) if (!PROVINCE_SET.has(k)) delete db.provinces[k];
  } catch (e) { console.error('⚠️ DB lỗi, khởi tạo mới:', e.message); }
}

let saveTimer = null;
function saveDB() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); }
    catch (e) { console.error('Lỗi lưu DB:', e.message); }
  }, 500);
}

// Dọn session cũ mỗi giờ
setInterval(() => {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const [k, s] of Object.entries(db.sessions)) if (s.createdAt < cutoff) delete db.sessions[k];
  for (const [k, t] of Object.entries(db.processedTx)) if (t < cutoff) delete db.processedTx[k];
  saveDB();
}, 3600 * 1000).unref();

// ================= 3. HELPERS =================
function safeEqual(a, b) {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function parseBody(req, limit = 100_000) {
  return new Promise(resolve => {
    let body = '', dead = false;
    req.on('data', c => {
      if (dead) return;
      body += c;
      if (body.length > limit) { dead = true; body = ''; try { req.destroy(); } catch {} }
    });
    req.on('end', () => {
      if (dead) return resolve({});
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
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
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rateBuckets) if (now > r.resetAt) rateBuckets.delete(k);
}, 60_000).unref();

function rollDice() {
  return [0, 0, 0].map(() => 1 + crypto.randomInt(6));
}

function classifyDice(dice) {
  const sum = dice[0] + dice[1] + dice[2];
  const allSame = dice[0] === dice[1] && dice[1] === dice[2];
  let result;
  if (allSame) result = 'bao';           // Bão (triple)
  else if (sum >= 4 && sum <= 10) result = 'xiu';
  else if (sum >= 11 && sum <= 17) result = 'tai';
  else result = 'khac';                  // 3 hoặc 18 (không bão thì hòa)
  return { sum, allSame, result };
}

// ================= 4. HTML GAME =================
const HTML_GAME = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
  <meta name="monetag" content="77d13f3d5476e6baf4972ea41b762054">
  <script src="//upgulpinon.com/1?z=12043589" async></script>
  <script src="//upgulpinon.com/1?z=12043590" async></script>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Tài Xỉu Việt Nam - Đại Chiến 63 Tỉnh Thành</title>
<meta name="description" content="Game Tài Xỉu online miễn phí, đua top 63 tỉnh thành. Chơi ngay không cần tải!">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#0a0e14">
<style>
*{box-sizing:border-box;margin:0;padding:0;user-select:none;font-family:system-ui,-apple-system,sans-serif}
body{background:#0a0e14;color:#fff;overflow:hidden;display:flex;justify-content:center;align-items:center;height:100vh}
#app{position:relative;width:100%;max-width:430px;height:100vh;max-height:820px;background:radial-gradient(circle at 50% 20%,#1a0a2e 0%,#0a0e14 100%);overflow:hidden;display:flex;flex-direction:column;box-shadow:0 0 40px rgba(255,0,128,.3)}
.header{padding:12px 14px;display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,215,0,.15)}
.brand{font-size:15px;font-weight:900;color:#ffd700;text-shadow:0 0 10px rgba(255,215,0,.6);letter-spacing:.5px}
.brand small{display:block;font-size:10px;color:#a78bfa;letter-spacing:1px;font-weight:500}
.vip-btn{background:linear-gradient(45deg,#ffd700,#ff9500);color:#000;padding:6px 12px;border-radius:14px;font-weight:800;font-size:11px;cursor:pointer;box-shadow:0 0 10px rgba(255,215,0,.5)}
.coins-bar{padding:10px 14px;display:flex;justify-content:space-between;background:rgba(255,0,128,.06);border-bottom:1px solid rgba(255,0,128,.15)}
.coin-box{font-size:13px;font-weight:700}
.coin-box .label{color:#94a3b8;font-size:10px;display:block;text-transform:uppercase;letter-spacing:.5px}
.coin-box .value{color:#ffd700;font-size:18px;font-weight:900;text-shadow:0 0 8px rgba(255,215,0,.5)}
.team-box{font-size:13px;font-weight:700;text-align:right}
.team-box .label{color:#94a3b8;font-size:10px;display:block;text-transform:uppercase;letter-spacing:.5px}
.team-box .value{color:#00ffcc}

.dice-area{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;gap:18px}
.dice-row{display:flex;gap:14px;justify-content:center}
.die{width:80px;height:80px;background:linear-gradient(135deg,#fff 0%,#e2e8f0 100%);border-radius:14px;box-shadow:0 4px 20px rgba(0,0,0,.4),inset 0 -4px 8px rgba(0,0,0,.1);position:relative;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);padding:10px;gap:2px}
.die.vip-gold{background:linear-gradient(135deg,#ffd700 0%,#ff9500 100%)}
.pip{width:100%;height:100%;border-radius:50%;background:#1a1a2e;box-shadow:inset 0 2px 4px rgba(0,0,0,.3)}
.die.rolling{animation:shake .15s infinite}
@keyframes shake{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(8deg)}}
.sum-display{font-size:42px;font-weight:900;text-shadow:0 0 20px currentColor;transition:all .3s}
.sum-display.tai{color:#ff0055}
.sum-display.xiu{color:#00ffcc}
.sum-display.bao{color:#ffd700}
.result-label{font-size:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:0;transition:opacity .3s}
.result-label.show{opacity:1}
.result-label.tai{color:#ff0055}
.result-label.xiu{color:#00ffcc}
.result-label.bao{color:#ffd700}
.result-label.win{color:#00ff88}
.result-label.lose{color:#ff4444}

.bet-section{padding:16px 14px;background:rgba(255,255,255,.03);border-top:1px solid rgba(255,215,0,.15)}
.bet-amount{display:flex;gap:8px;margin-bottom:12px;justify-content:center}
.bet-chip{flex:1;max-width:90px;padding:8px 6px;border-radius:10px;border:1px solid rgba(255,215,0,.4);background:rgba(255,215,0,.06);color:#ffd700;font-weight:800;font-size:12px;cursor:pointer;text-align:center;transition:all .15s}
.bet-chip.active{background:#ffd700;color:#000;box-shadow:0 0 14px rgba(255,215,0,.6)}
.bet-buttons{display:flex;gap:10px}
.bet-btn{flex:1;padding:18px 10px;border:none;border-radius:14px;font-size:18px;font-weight:900;cursor:pointer;letter-spacing:1px;transition:transform .1s;position:relative;overflow:hidden}
.bet-btn:active{transform:scale(.96)}
.bet-btn:disabled{opacity:.4;cursor:not-allowed}
.bet-btn.tai{background:linear-gradient(135deg,#ff0055,#ff0080);color:#fff;box-shadow:0 0 20px rgba(255,0,85,.5)}
.bet-btn.xiu{background:linear-gradient(135deg,#00ffcc,#00b8ff);color:#000;box-shadow:0 0 20px rgba(0,255,204,.5)}
.bet-btn small{display:block;font-size:10px;font-weight:500;opacity:.8;letter-spacing:0}
.bet-btn .mult{position:absolute;top:4px;right:6px;font-size:9px;background:rgba(0,0,0,.3);padding:2px 6px;border-radius:8px}

.history{padding:8px 14px 12px;font-size:11px;color:#94a3b8;text-align:center;background:rgba(0,0,0,.3)}
.history span{display:inline-block;margin:0 3px;padding:3px 8px;border-radius:6px;font-weight:700}
.history .tai{background:rgba(255,0,85,.2);color:#ff0055}
.history .xiu{background:rgba(0,255,204,.2);color:#00ffcc}
.history .bao{background:rgba(255,215,0,.2);color:#ffd700}

.modal{position:absolute;inset:0;background:rgba(10,14,20,.96);display:none;flex-direction:column;justify-content:center;align-items:center;padding:20px;text-align:center;z-index:20;overflow-y:auto}
.modal.active{display:flex}
.modal h1,.modal h2{color:#ffd700;text-transform:uppercase;margin-bottom:10px;font-size:22px}
.modal p{color:#cbd5e1;font-size:13px;line-height:1.5;margin-bottom:14px}
.btn{width:100%;max-width:300px;padding:13px;margin:5px 0;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer}
.btn:active{transform:scale(.96)}
.btn-primary{background:linear-gradient(45deg,#ffd700,#ff9500);color:#000}
.btn-share{background:#1e293b;color:#00ffcc;border:1px solid #00ffcc}
select{width:100%;max-width:300px;padding:12px;border-radius:10px;border:2px solid #ffd700;background:#0f172a;color:#fff;font-size:14px;font-weight:bold;margin-bottom:14px;outline:none}
.qr-card{background:#fff;color:#000;padding:12px;border-radius:14px;width:100%;max-width:300px;margin-bottom:10px}
.qr-card img{width:100%;max-width:200px}
.bank-info{font-size:12px;text-align:left;background:#f1f5f9;padding:8px;border-radius:8px;line-height:1.5;margin-top:6px}
.pack-select{display:flex;gap:6px;margin-bottom:10px;width:100%;max-width:300px}
.pack-btn{flex:1;padding:8px 4px;border-radius:8px;border:1px solid #ffd700;background:transparent;color:#ffd700;cursor:pointer;font-weight:bold;font-size:11px}
.pack-btn.selected{background:#ffd700;color:#000}
.status-wait{font-size:12px;color:#00ffcc;margin-bottom:8px;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.leaderboard{margin-top:12px;width:100%;max-width:320px;background:rgba(255,255,255,.03);border:1px solid rgba(255,215,0,.15);border-radius:10px;padding:10px;font-size:12px}
.leaderboard .row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.leaderboard .row:last-child{border-bottom:none}
.vip-badge{background:linear-gradient(45deg,#ffd700,#ff9500);color:#000;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:800;margin-left:6px}
</style>
</head>
<body>
<div id="app">
  <div class="header">
    <div class="brand">🎲 TÀI XỈU VN<small>ĐẠI CHIẾN 63 TỈNH THÀNH</small></div>
    <div class="vip-btn" onclick="openShop()">👑 NẠP VIP</div>
  </div>

  <div class="coins-bar">
    <div class="coin-box">
      <span class="label">💰 Số dư</span>
      <span class="value" id="coinsDisplay">0</span>
    </div>
    <div class="team-box">
      <span class="label">📍 Đội</span>
      <span class="value" id="teamDisplay">TP.HCM</span>
      <span id="vipBadge"></span>
    </div>
  </div>

  <div class="dice-area">
    <div class="dice-row" id="diceRow">
      <div class="die" id="die0"></div>
      <div class="die" id="die1"></div>
      <div class="die" id="die2"></div>
    </div>
    <div class="sum-display" id="sumDisplay">—</div>
    <div class="result-label" id="resultLabel"></div>
  </div>

  <div class="bet-section">
    <div class="bet-amount" id="betAmount">
      <div class="bet-chip active" data-amount="100">100</div>
      <div class="bet-chip" data-amount="500">500</div>
      <div class="bet-chip" data-amount="1000">1K</div>
      <div class="bet-chip" data-amount="2000">2K</div>
      <div class="bet-chip" data-amount="5000">5K</div>
    </div>
    <div class="bet-buttons">
      <button class="bet-btn xiu" id="btnXiu" onclick="placeBet('xiu')">
        XỈU <span class="mult" id="multXiu">x2</span>
        <small>4 - 10</small>
      </button>
      <button class="bet-btn tai" id="btnTai" onclick="placeBet('tai')">
        TÀI <span class="mult" id="multTai">x2</span>
        <small>11 - 17</small>
      </button>
    </div>
  </div>

  <div class="history" id="history">
    <span style="color:#64748b">Lịch sử:</span> <span id="historyList">Chưa có</span>
  </div>

  <!-- Modal bắt đầu: chọn tỉnh -->
  <div id="startModal" class="modal active">
    <h1>🎲 TÀI XỈU VN</h1>
    <p>Chào mừng! Bạn có <b style="color:#ffd700">10.000 xu</b> khởi đầu.<br>Chọn tỉnh thành của bạn để cùng tranh tài:</p>
    <select id="provinceSelect">
      <option value="TP.HCM">🔥 Đội TP. Hồ Chí Minh</option>
      <option value="Hà Nội">🔥 Đội Hà Nội</option>
      <option value="Đà Nẵng">🌊 Đội Đà Nẵng</option>
      <option value="Hải Phòng">⚓ Đội Hải Phòng</option>
      <option value="Nghệ An">🦁 Đội Nghệ An</option>
      <option value="Thanh Hóa">⚡ Đội Thanh Hóa</option>
      <option value="Cần Thơ">🌾 Đội Cần Thơ</option>
      <option value="Bình Dương">🚀 Đội Bình Dương</option>
      <option value="Đồng Nai">💎 Đội Đồng Nai</option>
      <option value="Tỉnh Khác">🇻🇳 Các Tỉnh Thành Khác</option>
    </select>
    <button class="btn btn-primary" onclick="startGame()">🚀 BẮT ĐẦU CHIẾN ĐẤU</button>
  </div>

  <!-- Modal hết xu -->
  <div id="brokeModal" class="modal">
    <h2>😭 HẾT XU RỒI!</h2>
    <p>Bạn đã thua hết 10.000 xu khởi đầu.<br>Nhận thêm 5.000 xu miễn phí hoặc nâng cấp VIP:</p>
    <button class="btn btn-primary" onclick="claimBonus()">🎁 NHẬN 5.000 XU MIỄN PHÍ</button>
    <button class="btn btn-share" onclick="openShop()">👑 NẠP VIP (X2 → X3 THẮNG)</button>
  </div>

  <!-- Modal shop VIP -->
  <div id="shopModal" class="modal">
    <h2>👑 NÂNG CẤP VIP</h2>
    <p>Quét QR bên dưới, hệ thống <b>tự động mở khóa VIP</b> sau vài giây:</p>
    <div class="pack-select">
      <button class="pack-btn selected" data-pack="VIP1" data-amount="20000" onclick="selectPack(this)">20.000đ<br><small>X2 Tiền Thắng</small></button>
      <button class="pack-btn" data-pack="VIP2" data-amount="50000" onclick="selectPack(this)">50.000đ<br><small>X2 + Xúc Xắc Bạc</small></button>
      <button class="pack-btn" data-pack="SVIP" data-amount="100000" onclick="selectPack(this)">100.000đ<br><small>X3 + Xúc Xắc Vàng</small></button>
    </div>
    <div class="qr-card">
      <img id="vietqrImg" src="" alt="VietQR MBBank"/>
      <div class="bank-info">
        <div>🏦 Ngân hàng: <b>MBBank</b></div>
        <div>💳 Số TK: <b>0865085878</b></div>
        <div>💰 Số tiền: <b id="qrAmount">20.000đ</b></div>
        <div>📝 Nội dung: <b id="qrMemo" style="color:#d97706"></b></div>
      </div>
    </div>
    <div class="status-wait">🔄 Đang chờ xác nhận từ MBBank...</div>
    <button class="btn btn-primary" onclick="confirmPayment()">✅ Kiểm Tra Ngay</button>
    <button class="btn btn-share" onclick="closeShop()">Quay Lại Game</button>
  </div>

  <!-- Modal BXH -->
  <div id="rankModal" class="modal">
    <h2>🏆 BẢNG XẾP HẠNG TỈNH</h2>
    <div class="leaderboard" id="rankList"></div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="closeRank()">Đóng</button>
  </div>
</div>

<script>
(function(){
  'use strict';

  var savedCode = localStorage.getItem('tx_player_code') || '';
  if (!/^TX[0-9A-F]{8}$/.test(savedCode)) {
    var a = new Uint8Array(4);
    (window.crypto || window.msCrypto).getRandomValues(a);
    savedCode = 'TX' + Array.from(a, b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
    localStorage.setItem('tx_player_code', savedCode);
  }

  var state = {
    coins: 0,
    team: localStorage.getItem('tx_team') || 'TP.HCM',
    vipPack: localStorage.getItem('tx_vip') || '',
    betAmount: 100,
    rolling: false,
    token: null
  };

  var packState = { amount: 20000, name: 'VIP1' };
  var paymentCheckInterval = null;
  var historyArr = [];

  function fmt(n) { return n.toLocaleString('vi-VN'); }

  function updateUI() {
    document.getElementById('coinsDisplay').textContent = fmt(state.coins);
    document.getElementById('teamDisplay').textContent = state.team;
    document.getElementById('vipBadge').innerHTML = state.vipPack
      ? '<span class="vip-badge">' + state.vipPack + '</span>' : '';
    var mult = state.vipPack === 'SVIP' ? 3 : (state.vipPack ? 2 : 1);
    document.getElementById('multTai').textContent = 'x' + mult;
    document.getElementById('multXiu').textContent = 'x' + mult;
    document.querySelectorAll('.die').forEach(function(d) {
      d.classList.toggle('vip-gold', state.vipPack === 'SVIP');
    });
    var disabled = state.rolling || state.coins < state.betAmount;
    document.getElementById('btnTai').disabled = disabled;
    document.getElementById('btnXiu').disabled = disabled;
  }

  function renderDie(el, value) {
    var pips = {
      1: [4], 2: [0,8], 3: [0,4,8], 4: [0,2,6,8], 5: [0,2,4,6,8], 6: [0,2,3,5,6,8]
    };
    el.innerHTML = '';
    var on = pips[value] || [];
    for (var i = 0; i < 9; i++) {
      var p = document.createElement('div');
      p.className = 'pip';
      p.style.visibility = on.indexOf(i) >= 0 ? 'visible' : 'hidden';
      el.appendChild(p);
    }
  }

  function animateRoll(targetDice, callback) {
    state.rolling = true;
    updateUI();
    var dice = document.querySelectorAll('.die');
    dice.forEach(function(d) { d.classList.add('rolling'); });
    var frames = 0;
    var interval = setInterval(function() {
      frames++;
      dice.forEach(function(d) { renderDie(d, 1 + Math.floor(Math.random() * 6)); });
      if (frames >= 12) {
        clearInterval(interval);
        dice.forEach(function(d, i) {
          d.classList.remove('rolling');
          renderDie(d, targetDice[i]);
        });
        callback();
      }
    }, 60);
  }

  function showResult(dice, bet, won, payout) {
    var sum = dice[0] + dice[1] + dice[2];
    var allSame = dice[0] === dice[1] && dice[1] === dice[2];
    var cls = allSame ? 'bao' : (sum >= 11 ? 'tai' : (sum >= 4 ? 'xiu' : 'khac'));

    var sumEl = document.getElementById('sumDisplay');
    sumEl.textContent = sum;
    sumEl.className = 'sum-display ' + cls;

    var label = document.getElementById('resultLabel');
    if (allSame) {
      label.textContent = '🎉 BÃO! x30';
      label.className = 'result-label show bao';
    } else if (won) {
      label.textContent = '✅ THẮNG +' + fmt(payout);
      label.className = 'result-label show win';
    } else {
      label.textContent = '❌ THUA -' + fmt(state.betAmount);
      label.className = 'result-label show lose';
    }

    historyArr.unshift(cls);
    if (historyArr.length > 10) historyArr.pop();
    var hl = document.getElementById('historyList');
    if (historyArr.length === 0) hl.textContent = 'Chưa có';
    else hl.innerHTML = historyArr.map(function(c) {
      return '<span class="' + c + '">' + (c === 'tai' ? 'T' : c === 'xiu' ? 'X' : 'B') + '</span>';
    }).join('');

    state.rolling = false;
    updateUI();
  }

  function placeBet(side) {
    if (state.rolling) return;
    if (state.coins < state.betAmount) return;

    fetch('/api/bet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: savedCode,
        team: state.team,
        side: side,
        amount: state.betAmount,
        token: state.token
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (!res.success) {
        alert(res.error || 'Lỗi kết nối, thử lại!');
        return;
      }
      state.coins = res.coins;
      state.token = res.newToken;
      var oldCoins = state.coins;
      animateRoll(res.dice, function() {
        showResult(res.dice, side, res.won, res.payout);
        if (res.coins <= 0) {
          setTimeout(function() {
            document.getElementById('brokeModal').classList.add('active');
          }, 800);
        }
      });
    })
    .catch(function() { alert('Lỗi kết nối!'); });
  }

  function fetchMe() {
    fetch('/api/me?code=' + encodeURIComponent(savedCode))
      .then(function(r) { return r.json(); })
      .then(function(res) {
        state.coins = res.coins;
        if (res.team) state.team = res.team;
        if (res.vipPack) state.vipPack = res.vipPack;
        state.token = res.token;
        updateUI();
      })
      .catch(function() {});
  }

  window.startGame = function() {
    state.team = document.getElementById('provinceSelect').value;
    localStorage.setItem('tx_team', state.team);
    fetch('/api/set-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: savedCode, team: state.team })
    }).then(function() {
      document.getElementById('startModal').classList.remove('active');
      updateUI();
    }).catch(function() {
      document.getElementById('startModal').classList.remove('active');
    });
  };

  window.claimBonus = function() {
    fetch('/api/bonus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: savedCode })
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.success) {
        state.coins = res.coins;
        state.token = res.newToken;
        updateUI();
        document.getElementById('brokeModal').classList.remove('active');
        alert('🎁 Đã nhận +5.000 xu!');
      } else {
        alert(res.error || 'Không thể nhận bonus lúc này!');
      }
    });
  };

  function updateVietQR(amount, packName) {
    var memo = packName + ' ' + savedCode;
    var qrUrl = 'https://img.vietqr.io/image/' + 'MB' + '-' + '0865085878' + '-compact2.png?amount=' + amount + '&addInfo=' + encodeURIComponent(memo);
    document.getElementById('vietqrImg').src = qrUrl;
    document.getElementById('qrAmount').textContent = amount.toLocaleString('vi-VN') + 'đ';
    document.getElementById('qrMemo').textContent = memo;
  }

  window.selectPack = function(btnEl) {
    document.querySelectorAll('.pack-btn').forEach(function(b) { b.classList.remove('selected'); });
    btnEl.classList.add('selected');
    packState = { amount: parseInt(btnEl.dataset.amount, 10), name: btnEl.dataset.pack };
    updateVietQR(packState.amount, packState.name);
  };

  window.openShop = function() {
    updateVietQR(packState.amount, packState.name);
    document.getElementById('shopModal').classList.add('active');
    if (paymentCheckInterval) clearInterval(paymentCheckInterval);
    paymentCheckInterval = setInterval(checkPaymentStatus, 3000);
  };

  window.closeShop = function() {
    if (paymentCheckInterval) { clearInterval(paymentCheckInterval); paymentCheckInterval = null; }
    document.getElementById('shopModal').classList.remove('active');
  };

  function checkPaymentStatus() {
    fetch('/api/check-vip?code=' + encodeURIComponent(savedCode))
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.paid) {
          clearInterval(paymentCheckInterval); paymentCheckInterval = null;
          activateVipPrivilege(res.data.pack);
        }
      });
  }

  window.confirmPayment = function() {
    fetch('/api/check-vip?code=' + encodeURIComponent(savedCode))
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.paid) activateVipPrivilege(res.data.pack);
        else alert('⏳ Đang chờ xác nhận từ MBBank (2-5 giây sau khi chuyển khoản).');
      });
  };

  function activateVipPrivilege(pack) {
    state.vipPack = pack;
    localStorage.setItem('tx_vip', pack);
    alert('🎉 KÍCH HOẠT ' + pack + ' THÀNH CÔNG!\\nBạn được x' + (pack === 'SVIP' ? 3 : 2) + ' tiền thắng cược.');
    closeShop();
    updateUI();
  }

  window.closeRank = function() {
    document.getElementById('rankModal').classList.remove('active');
  };

  function showRank() {
    fetch('/api/leaderboard')
      .then(function(r) { return r.json(); })
      .then(function(list) {
        var html = '';
        list.slice(0, 10).forEach(function(item, i) {
          var medal = ['🥇','🥈','🥉'][i] || (i + 1) + '.';
          html += '<div class="row"><span>' + medal + ' ' + item.name + '</span><span style="color:#ffd700">' + fmt(item.score) + ' xu</span></div>';
        });
        document.getElementById('rankList').innerHTML = html;
        document.getElementById('rankModal').classList.add('active');
      });
  }

  // Bấm số dư để xem BXH
  document.querySelector('.team-box').addEventListener('click', showRank);
  document.querySelector('.team-box').style.cursor = 'pointer';

  // Bet chips
  document.querySelectorAll('.bet-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.querySelectorAll('.bet-chip').forEach(function(c) { c.classList.remove('active'); });
      chip.classList.add('active');
      state.betAmount = parseInt(chip.dataset.amount, 10);
      updateUI();
    });
  });

  // Init
  fetchMe();
})();
</script>
</body>
</html>`;

// ================= 5. HTTP SERVER =================
function getPlayer(code) {
  if (!db.players[code]) {
    db.players[code] = {
      coins: START_COINS,
      totalWon: 0,
      team: null,
      vipPack: '',
      bonusClaimed: 0,
      createdAt: Date.now()
    };
    saveDB();
  }
  return db.players[code];
}

function issueToken(code) {
  const token = crypto.randomBytes(16).toString('hex');
  db.sessions[token] = { playerCode: code, createdAt: Date.now(), used: false };
  saveDB();
  return token;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, secure-token');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Trang chủ
  if (req.method === 'GET' && pathname === '/') {
    if (!rateLimit(ip, 'page', 120, 60_000)) { res.writeHead(429); return res.end('Too many requests'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML_GAME);
  }

  if (req.method === 'GET' && pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('User-agent: *\nAllow: /\n');
  }

  if (req.method === 'GET' && (pathname === '/favicon.ico' || pathname === '/og-image.png')) {
    res.writeHead(204); return res.end();
  }

  // BXH tỉnh
  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    if (!rateLimit(ip, 'lb', 60, 60_000)) { res.writeHead(429); return res.end('[]'); }
    const sorted = Object.keys(db.provinces)
      .map(name => ({ name, score: db.provinces[name] }))
      .sort((a, b) => b.score - a.score);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(sorted));
  }

  // Thông tin player
  if (req.method === 'GET' && pathname === '/api/me') {
    if (!rateLimit(ip, 'me', 120, 60_000)) { res.writeHead(429); return res.end('{}'); }
    const code = String(parsedUrl.query.code || '').toUpperCase();
    if (!/^TX[0-9A-F]{8}$/.test(code)) { res.writeHead(400); return res.end('{}'); }
    const player = getPlayer(code);
    const token = issueToken(code);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      coins: player.coins,
      team: player.team,
      vipPack: player.vipPack,
      token: token
    }));
  }

  // Set team
  if (req.method === 'POST' && pathname === '/api/set-team') {
    const body = await parseBody(req);
    const code = String(body.code || '').toUpperCase();
    const team = String(body.team || '');
    if (!/^TX[0-9A-F]{8}$/.test(code) || !PROVINCE_SET.has(team)) {
      res.writeHead(400); return res.end('{}');
    }
    const player = getPlayer(code);
    player.team = team;
    saveDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  // Bonus khi hết xu
  if (req.method === 'POST' && pathname === '/api/bonus') {
    if (!rateLimit(ip, 'bonus', 5, 3600_000)) { res.writeHead(429); return res.end('{"success":false,"error":"Vượt giới hạn nhận bonus"}'); }
    const body = await parseBody(req);
    const code = String(body.code || '').toUpperCase();
    if (!/^TX[0-9A-F]{8}$/.test(code)) { res.writeHead(400); return res.end('{}'); }
    const player = getPlayer(code);
    if (player.coins > 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Bạn vẫn còn xu, không cần bonus!' }));
    }
    player.coins += 5000;
    player.bonusClaimed = (player.bonusClaimed || 0) + 1;
    const token = issueToken(code);
    saveDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, coins: player.coins, newToken: token }));
  }

  // Đặt cược
  if (req.method === 'POST' && pathname === '/api/bet') {
    if (!rateLimit(ip, 'bet', 60, 60_000)) { res.writeHead(429); return res.end('{"success":false,"error":"Bạn cược quá nhanh"}'); }
    const body = await parseBody(req);
    const code = String(body.code || '').toUpperCase();
    const team = String(body.team || '');
    const side = String(body.side || '');
    const amount = Math.floor(Number(body.amount) || 0);
    const token = String(body.token || '');

    if (!/^TX[0-9A-F]{8}$/.test(code)) {
      res.writeHead(400); return res.end(JSON.stringify({ success: false, error: 'Mã player không hợp lệ' }));
    }
    if (!PROVINCE_SET.has(team)) {
      res.writeHead(400); return res.end(JSON.stringify({ success: false, error: 'Tỉnh không hợp lệ' }));
    }
    if (!['tai', 'xiu'].includes(side)) {
      res.writeHead(400); return res.end(JSON.stringify({ success: false, error: 'Cửa cược không hợp lệ' }));
    }
    if (amount < MIN_BET || amount > MAX_BET) {
      res.writeHead(400); return res.end(JSON.stringify({ success: false, error: `Cược phải từ ${MIN_BET} đến ${MAX_BET} xu` }));
    }
    // Xác thực session token
    const sess = db.sessions[token];
    if (!sess || sess.playerCode !== code || sess.used) {
      res.writeHead(400); return res.end(JSON.stringify({ success: false, error: 'Phiên chơi hết hạn, tải lại trang' }));
    }
    sess.used = true;

    const player = getPlayer(code);
    if (player.coins < amount) {
      res.writeHead(400); return res.end(JSON.stringify({ success: false, error: 'Không đủ xu' }));
    }
    if (team !== player.team) player.team = team;

    // Roll dice
    const dice = rollDice();
    const { sum, allSame, result } = classifyDice(dice);

    // Xác định thắng/thua
    let won = false;
    let payout = 0;
    const multiplier = VIP_MULTIPLIER[player.vipPack] || 1;

    if (allSame) {
      // Bão: cược bất kỳ đều thắng x30
      won = true;
      payout = amount * 30 * multiplier;
    } else if ((result === 'tai' && side === 'tai') || (result === 'xiu' && side === 'xiu')) {
      won = true;
      payout = amount * 2 * multiplier;
    } else if (result === 'khac' && !allSame && (sum === 3 || sum === 18)) {
      // 3 hoặc 18 không bão: hòa, trả lại tiền
      won = false;
      payout = amount;  // hoàn tiền
    }

    if (won) {
      player.coins += (payout - amount);  // Đã trừ vốn, cộng lãi
    } else if (payout === amount) {
      // Hòa, không trừ không cộng
    } else {
      player.coins -= amount;
    }

    // Cập nhật thành tích tỉnh (chỉ tính lãi ròng dương)
    const netProfit = player.coins - (player.coins - (won ? payout - amount : (payout === amount ? 0 : -amount)));
    if (won && payout > amount) {
      const profit = payout - amount;
      db.provinces[team] = (db.provinces[team] || 0) + profit;
      player.totalWon = (player.totalWon || 0) + profit;
    }

    const newToken = issueToken(code);
    saveDB();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      dice: dice,
      sum: sum,
      allSame: allSame,
      won: won,
      payout: payout,
      coins: player.coins,
      newToken: newToken
    }));
  }

  // Kiểm tra VIP
  if (req.method === 'GET' && pathname === '/api/check-vip') {
    if (!rateLimit(ip, 'vip', 20, 60_000)) { res.writeHead(429); return res.end('{}'); }
    const code = String(parsedUrl.query.code || '').toUpperCase();
    if (!/^TX[0-9A-F]{8}$/.test(code)) { res.writeHead(400); return res.end('{"paid":false}'); }
    const player = db.players[code];
    if (player && player.vipPack) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ paid: true, data: { pack: player.vipPack } }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ paid: false }));
  }

  // Webhook SePay / Casso
  if (req.method === 'POST' && pathname === '/api/webhook/payment') {
    if (!rateLimit(ip, 'webhook', 120, 60_000)) { res.writeHead(429); return res.end('{}'); }

    const authHeader = req.headers['authorization'] || '';
    const cassoToken = req.headers['secure-token'] || '';
    const isAuthorized =
      safeEqual(authHeader, 'Apikey ' + WEBHOOK_SECRET) ||
      safeEqual(authHeader, 'Bearer ' + WEBHOOK_SECRET) ||
      safeEqual(cassoToken, WEBHOOK_SECRET);

    if (!isAuthorized) {
      res.writeHead(401); return res.end('{"success":false}');
    }

    const body = await parseBody(req);
    const transactions = [];

    if (body && body.transferAmount && body.content) {
      if (!body.transferType || body.transferType === 'in') {
        transactions.push({
          id: String(body.id || body.referenceCode || ''),
          amount: Number(body.transferAmount),
          content: String(body.content).toUpperCase()
        });
      }
    } else if (body && Array.isArray(body.data)) {
      body.data.forEach(item => {
        transactions.push({
          id: String(item.id || item.tid || ''),
          amount: Number(item.amount),
          content: String(item.description || '').toUpperCase()
        });
      });
    }

    let activated = 0;
    for (const tx of transactions) {
      if (!Number.isFinite(tx.amount) || tx.amount <= 0) continue;
      const txKey = tx.id || crypto.createHash('md5').update(tx.amount + '|' + tx.content).digest('hex');
      if (db.processedTx[txKey]) continue;

      // Nhận cả mã ND (Neon Dodge) và TX (Tài Xỉu) - vì cùng dùng chung tài khoản
      const playerMatch = tx.content.match(/TX[0-9A-F]{8}/);
      const packMatch = tx.content.match(/VIP1|VIP2|SVIP/);

      if (playerMatch) {
        const playerCode = playerMatch[0];
        const packName = packMatch ? packMatch[0] : 'VIP1';
        const minAmount = PACK_PRICES[packName] || 20000;
        if (tx.amount >= minAmount) {
          const player = getPlayer(playerCode);
          player.vipPack = packName;
          activated++;
          console.log(`[TÀI XỈU - DUYỆT] +${tx.amount}đ -> ${packName} cho ${playerCode}`);
        }
      }
      db.processedTx[txKey] = Date.now();
    }
    if (transactions.length) saveDB();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, activated }));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log('🎲 TÀI XỈU VN — ĐÃ KHỞI ĐỘNG');
  console.log('👉 Chơi:        http://localhost:' + PORT);
  console.log('👉 Webhook:     http://localhost:' + PORT + '/api/webhook/payment');
  console.log('🔐 WEBHOOK_SECRET: đã nạp (' + WEBHOOK_SECRET.length + ' ký tự)');
  console.log('====================================================');
});

process.on('SIGINT', () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {} process.exit(0); });