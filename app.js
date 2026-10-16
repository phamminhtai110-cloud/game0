/**
 * NEON DODGE VN - ALL-IN-ONE FIXED (Game + Webhook MBBank 0865085878)
 * Chạy: node app.js  |  Không cần cài thư viện ngoài
 * BẮT BUỘC đặt biến môi trường: WEBHOOK_SECRET
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const BANK_ID = 'MB';
const ACCOUNT_NO = '0865085878';
const DB_FILE = path.join(__dirname, 'database.json');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET || WEBHOOK_SECRET.length < 16) {
  console.error('❌ Thiếu WEBHOOK_SECRET (>=16 ký tự). Ví dụ:');
  console.error('   $env:WEBHOOK_SECRET="my-secret-key-1234567890"; node app.js');
  process.exit(1);
}

const PACK_PRICES = { VIP1: 20000, VIP2: 50000, SVIP: 100000 };

const PROVINCES = Object.freeze([
  'Hà Nội','TP.HCM','Đà Nẵng','Hải Phòng','Nghệ An',
  'Thanh Hóa','Cần Thơ','Bình Dương','Đồng Nai','Tỉnh Khác'
]);
const PROVINCE_SET = new Set(PROVINCES);

let db = {
  vipPlayers: {},
  provinces: {
    'Hà Nội': 142800, 'TP.HCM': 141950, 'Đà Nẵng': 98400,
    'Hải Phòng': 87200, 'Nghệ An': 79500, 'Thanh Hóa': 76100,
    'Cần Thơ': 68300, 'Bình Dương': 64900, 'Đồng Nai': 59200,
    'Tỉnh Khác': 55000
  },
  processedTx: {},
  sessions: {}
};

if (fs.existsSync(DB_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = Object.assign(db, loaded);
    for (const p of PROVINCES) if (typeof db.provinces[p] !== 'number') db.provinces[p] = 50000;
    for (const k of Object.keys(db.provinces)) if (!PROVINCE_SET.has(k)) delete db.provinces[k];
  } catch (e) {
    console.error('⚠️ database.json lỗi, khởi tạo mới:', e.message);
  }
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

setInterval(() => {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const [k, s] of Object.entries(db.sessions)) if (s.startedAt < cutoff) delete db.sessions[k];
  for (const [k, t] of Object.entries(db.processedTx)) if (t < cutoff) delete db.processedTx[k];
  saveDB();
}, 3600 * 1000).unref();

function safeEqual(a, b) {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function parseBody(req, limit = 100000) {
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
}, 60000).unref();

const HTML_GAME = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
  <meta name="monetag" content="a1b2c3d4e5f6g7h8i9j0">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Neon Dodge Việt Nam - Đại Chiến 63 Tỉnh Thành</title>
<meta name="description" content="Trò chơi phản xạ gây nghiện! Đại diện tỉnh thành của bạn vượt qua thử thách 50 điểm trong Neon Dodge.">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#05060a">
<style>
*{box-sizing:border-box;margin:0;padding:0;user-select:none;font-family:system-ui,-apple-system,sans-serif}
body{background:#05060a;color:#fff;overflow:hidden;display:flex;justify-content:center;align-items:center;height:100vh}
#game-container{position:relative;width:100%;max-width:430px;height:100vh;max-height:820px;background:radial-gradient(circle at 50% 30%,#16222f 0%,#05060a 100%);overflow:hidden;box-shadow:0 0 40px rgba(0,255,204,.25)}
canvas{width:100%;height:100%;display:block}
.hud{position:absolute;top:12px;left:12px;right:12px;display:flex;justify-content:space-between;align-items:center;z-index:5;pointer-events:none}
.score-box{font-size:20px;font-weight:900;text-shadow:0 0 10px #00ffcc}
.province-badge{font-size:12px;color:#00ffcc;display:block;font-weight:600}
.vip-btn{background:linear-gradient(45deg,#ffd700,#ff9900);color:#000;padding:7px 14px;border-radius:20px;font-weight:800;font-size:13px;pointer-events:auto;cursor:pointer;box-shadow:0 0 12px rgba(255,215,0,.5)}
.leaderboard-bar{position:absolute;top:62px;left:12px;right:12px;background:rgba(255,255,255,.06);border:1px solid rgba(0,255,204,.25);border-radius:10px;padding:6px 10px;font-size:12px;display:flex;justify-content:space-between;pointer-events:none;z-index:5}
.modal{position:absolute;inset:0;background:rgba(5,6,10,.94);display:none;flex-direction:column;justify-content:center;align-items:center;padding:18px;text-align:center;z-index:20;overflow-y:auto}
.modal.active{display:flex}
.modal h1,.modal h2{font-size:23px;margin-bottom:8px;color:#00ffcc;text-transform:uppercase}
.modal p{font-size:14px;color:#cbd5e1;margin-bottom:14px;line-height:1.45}
select{width:100%;max-width:290px;padding:12px;border-radius:10px;border:2px solid #00ffcc;background:#0f172a;color:#fff;font-size:15px;font-weight:bold;margin-bottom:14px;outline:none}
.btn{width:100%;max-width:290px;padding:13px;margin:5px 0;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer;transition:transform .1s}
.btn:active{transform:scale(.96)}
.btn-primary{background:linear-gradient(45deg,#00ffcc,#0099ff);color:#000;box-shadow:0 0 18px rgba(0,255,204,.45)}
.btn-ad{background:linear-gradient(45deg,#ff6600,#ff0055);color:#fff}
.btn-vip{background:linear-gradient(45deg,#ffd700,#ffae00);color:#000}
.btn-share{background:#1e293b;color:#00ffcc;border:1px solid #00ffcc}
.qr-card{background:#fff;color:#000;padding:12px;border-radius:14px;width:100%;max-width:290px;margin-bottom:10px}
.qr-card img{width:100%;max-width:190px;border-radius:8px}
.bank-info{font-size:12.5px;margin-top:6px;text-align:left;background:#f1f5f9;padding:8px;border-radius:8px;line-height:1.5}
.pack-select{display:flex;gap:6px;margin-bottom:10px;width:100%;max-width:290px}
.pack-btn{flex:1;padding:7px 4px;border-radius:8px;border:1px solid #ffd700;background:transparent;color:#ffd700;cursor:pointer;font-weight:bold;font-size:12px}
.pack-btn.selected{background:#ffd700;color:#000}
.status-wait{font-size:12px;color:#00ffcc;margin-bottom:8px;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
</style>
</head>
<body>
<div id="game-container">
  <div class="hud">
    <div class="score-box">ĐIỂM: <span id="score">0</span>
      <span class="province-badge" id="teamLabel">📍 Đội: TP.HCM</span>
    </div>
    <div class="vip-btn" onclick="openShop()">👑 Nạp VIP / X2</div>
  </div>
  <div class="leaderboard-bar" id="liveRank">
    <span>🥇 Hà Nội: 142.8K</span><span>🥈 TP.HCM: 141.9K</span><span>🥉 Đà Nẵng: 98.4K</span>
  </div>
  <canvas id="gameCanvas"></canvas>

  <div id="startModal" class="modal active">
    <h1>ĐẠI CHIẾN 63 TỈNH THÀNH</h1>
    <p>99% người chơi không vượt qua nổi <b>50 điểm</b>! Chọn tỉnh thành của bạn:</p>
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

  <div id="gameOverModal" class="modal">
    <h2>SUÝT ĐẠT MỐC 50 ĐIỂM!</h2>
    <p>Bạn vừa đóng góp <b id="finalScore" style="color:#00ffcc">0</b> điểm cho <b id="finalTeam" style="color:#ffd700"></b>!</p>
    <button id="reviveBtn" class="btn btn-ad" onclick="watchAdToRevive()">🎬 Xem QC (5s) → Hồi Sinh</button>
    <button class="btn btn-vip" onclick="openShop()">👑 Mua Khiên Bất Tử & X2 Điểm</button>
    <button class="btn btn-share" onclick="shareGame()">📢 Gọi Đồng Hương (+1 Khiên)</button>
    <button class="btn btn-primary" onclick="restartGame()">🔄 Chơi Lại Ngay</button>
  </div>

  <div id="adModal" class="modal">
    <h2>TÀI TRỢ BỞI NHÀ QUẢNG CÁO</h2>
    <p>Hồi sinh miễn phí sau <b id="adTimer" style="color:#ffd700;font-size:18px;">5</b> giây...</p>
    <div style="width:280px;height:180px;background:#0f172a;border:2px dashed #00ffcc;display:flex;flex-direction:column;align-items:center;justify-content:center;margin-bottom:14px;border-radius:12px;padding:12px">
      <b style="color:#00ffcc">[Khung Quảng Cáo]</b>
    </div>
  </div>

  <div id="shopModal" class="modal">
    <h2>NÂNG CẤP VIP TỰ ĐỘNG</h2>
    <p>Quét VietQR, hệ thống <b>tự động kích hoạt VIP</b> sau vài giây:</p>
    <div class="pack-select">
      <button class="pack-btn selected" data-pack="VIP1" data-amount="20000" onclick="selectPack(this)">20.000đ<br><small>X2 Điểm + Xóa QC</small></button>
      <button class="pack-btn" data-pack="VIP2" data-amount="50000" onclick="selectPack(this)">50.000đ<br><small>3 Khiên Bất Tử</small></button>
      <button class="pack-btn" data-pack="SVIP" data-amount="100000" onclick="selectPack(this)">100.000đ<br><small>5 Khiên + Rồng Vàng</small></button>
    </div>
    <div class="qr-card">
      <img id="vietqrImg" src="" alt="VietQR MBBank 0865085878"/>
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
</div>
<script>
(function(){
  'use strict';
  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  canvas.width = 430; canvas.height = 820;
  var BANK_ID = 'MB', ACCOUNT_NO = '0865085878';

  function genCode() {
    var a = new Uint8Array(4);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return 'ND' + Array.from(a, function(b){ return b.toString(16).padStart(2,'0'); }).join('').toUpperCase();
  }
  var savedCode = localStorage.getItem('nd_player_code') || '';
  if (!/^ND[0-9A-F]{8}$/.test(savedCode)) {
    savedCode = genCode();
    localStorage.setItem('nd_player_code', savedCode);
  }

  var score = 0;
  var team = localStorage.getItem('nd_team') || 'TP.HCM';
  var isVip = localStorage.getItem('nd_vip') === 'true';
  var currentPack = localStorage.getItem('nd_pack') || 'VIP1';
  var gameOver = true;
  var revivedThisRun = false;
  var adPlaying = false;
  var paymentCheckInterval = null;
  var sessionToken = null;
  var packState = { amount: 20000, name: 'VIP1' };

  function shieldMax() {
    if (!isVip) return 0;
    return currentPack === 'SVIP' ? 5 : (currentPack === 'VIP2' ? 3 : 1);
  }
  var shield = shieldMax();
  var player = { x: 215, y: 650, radius: 14, targetX: 215 };
  var obstacles = [];
  var frame = 0;

  function movePlayer(clientX) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    player.targetX = Math.max(22, Math.min(canvas.width - 22, (clientX - rect.left) * scaleX));
  }
  window.addEventListener('mousemove', function(e){ movePlayer(e.clientX); });
  window.addEventListener('touchmove', function(e){ movePlayer(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchstart', function(e){ movePlayer(e.touches[0].clientX); }, { passive: true });

  function fetchLeaderboard() {
    fetch('/api/leaderboard').then(function(r){ return r.json(); }).then(function(list){
      if (!list || list.length < 3) return;
      var icons = ['🥇 ','🥈 ','🥉 '];
      var html = '';
      for (var i = 0; i < 3; i++) {
        var kScore = (list[i].score / 1000).toFixed(1) + 'K';
        html += '<span>' + icons[i] + list[i].name + ': ' + kScore + '</span>';
      }
      document.getElementById('liveRank').innerHTML = html;
    }).catch(function(){});
  }
  fetchLeaderboard();
  setInterval(fetchLeaderboard, 10000);

  function requestSession(cb) {
    fetch('/api/start-session', { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(res){ sessionToken = res.token || null; if (cb) cb(); })
      .catch(function(){ sessionToken = null; if (cb) cb(); });
  }

  window.startGame = function() {
    team = document.getElementById('provinceSelect').value;
    localStorage.setItem('nd_team', team);
    document.getElementById('teamLabel').innerText = '📍 Đội: ' + team;
    document.getElementById('startModal').classList.remove('active');
    requestSession(function(){ restartGame(); });
  };

  function spawnObstacle() {
    var spike = (score >= 42 && score <= 50) ? 15 : 0;
    var gap = Math.max(82, 148 - (score * 0.65) - spike);
    var gapX = Math.random() * (canvas.width - gap - 40) + 20;
    obstacles.push({ y: -30, gapX: gapX, gap: gap, height: 22, passed: false });
  }

  function update() {
    if (gameOver) return;
    frame++;
    var speedMultiplier = Math.min(1 + score * 0.026, 4);
    player.x += (player.targetX - player.x) * 0.24;
    if (frame % Math.max(26, Math.floor(62 / speedMultiplier)) === 0) spawnObstacle();

    for (var i = obstacles.length - 1; i >= 0; i--) {
      var obs = obstacles[i];
      obs.y += 5 * speedMultiplier;
      var nearY = (obs.y + obs.height > player.y - player.radius) && (obs.y < player.y + player.radius);
      if (nearY) {
        if (player.x - player.radius < obs.gapX || player.x + player.radius > obs.gapX + obs.gap) {
          if (shield > 0) { shield--; obstacles.splice(i, 1); continue; }
          triggerGameOver(); return;
        }
      }
      if (!obs.passed && obs.y > player.y) {
        obs.passed = true;
        score += isVip ? 2 : 1;
        document.getElementById('score').innerText = score;
      }
      if (obs.y > canvas.height + 50) obstacles.splice(i, 1);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ff0055';
    ctx.shadowBlur = 15; ctx.shadowColor = '#ff0055';
    for (var i = 0; i < obstacles.length; i++) {
      var obs = obstacles[i];
      ctx.fillRect(0, obs.y, obs.gapX, obs.height);
      ctx.fillRect(obs.gapX + obs.gap, obs.y, canvas.width - (obs.gapX + obs.gap), obs.height);
    }
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fillStyle = isVip ? '#ffd700' : '#00ffcc';
    ctx.shadowColor = isVip ? '#ffd700' : '#00ffcc';
    ctx.fill();
    if (shield > 0) {
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius + 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    ctx.shadowBlur = 0;
    requestAnimationFrame(function(){ update(); draw(); });
  }

  function triggerGameOver() {
    gameOver = true;
    document.getElementById('finalScore').innerText = score;
    document.getElementById('finalTeam').innerText = team;
    document.getElementById('reviveBtn').style.display = revivedThisRun ? 'none' : 'block';
    document.getElementById('gameOverModal').classList.add('active');
    if (score > 0 && sessionToken) {
      fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: team, score: score, token: sessionToken })
      }).then(function(){ sessionToken = null; fetchLeaderboard(); }).catch(function(){});
    }
  }

  window.restartGame = function() {
    score = 0; obstacles = []; shield = shieldMax();
    revivedThisRun = false; gameOver = false;
    document.getElementById('score').innerText = '0';
    document.getElementById('gameOverModal').classList.remove('active');
    if (!sessionToken) requestSession(function(){});
  };

  window.watchAdToRevive = function() {
    if (adPlaying) return;
    adPlaying = true;
    document.getElementById('gameOverModal').classList.remove('active');
    var adModal = document.getElementById('adModal');
    adModal.classList.add('active');
    var timeLeft = 5;
    document.getElementById('adTimer').innerText = timeLeft;
    var timer = setInterval(function() {
      timeLeft--;
      document.getElementById('adTimer').innerText = timeLeft;
      if (timeLeft <= 0) {
        clearInterval(timer);
        adModal.classList.remove('active');
        adPlaying = false; revivedThisRun = true;
        obstacles = []; shield = 1; gameOver = false;
      }
    }, 1000);
  };

  function updateVietQR(amount, packName) {
    var memo = packName + ' ' + savedCode;
    var qrUrl = 'https://img.vietqr.io/image/' + BANK_ID + '-' + ACCOUNT_NO + '-compact2.png?amount=' + amount + '&addInfo=' + encodeURIComponent(memo);
    document.getElementById('vietqrImg').src = qrUrl;
    document.getElementById('qrAmount').innerText = amount.toLocaleString('vi-VN') + 'đ';
    document.getElementById('qrMemo').innerText = memo;
  }

  window.selectPack = function(btnEl) {
    document.querySelectorAll('.pack-btn').forEach(function(b){ b.classList.remove('selected'); });
    btnEl.classList.add('selected');
    packState = { amount: parseInt(btnEl.dataset.amount, 10), name: btnEl.dataset.pack };
    updateVietQR(packState.amount, packState.name);
  };

  window.openShop = function() {
    gameOver = true;
    updateVietQR(packState.amount, packState.name);
    document.getElementById('shopModal').classList.add('active');
    if (paymentCheckInterval) clearInterval(paymentCheckInterval);
    paymentCheckInterval = setInterval(checkPaymentStatus, 3000);
  };

  window.closeShop = function() {
    if (paymentCheckInterval) { clearInterval(paymentCheckInterval); paymentCheckInterval = null; }
    document.getElementById('shopModal').classList.remove('active');
    if (!document.getElementById('gameOverModal').classList.contains('active') &&
        !document.getElementById('startModal').classList.contains('active')) {
      gameOver = false;
    }
  };

  function checkPaymentStatus() {
    fetch('/api/check-vip?code=' + encodeURIComponent(savedCode))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if (res.paid) {
          clearInterval(paymentCheckInterval); paymentCheckInterval = null;
          activateVipPrivilege(res.data.pack);
        }
      }).catch(function(){});
  }

  window.confirmPayment = function() {
    fetch('/api/check-vip?code=' + encodeURIComponent(savedCode))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if (res.paid) activateVipPrivilege(res.data.pack);
        else alert('⏳ Đang chờ xác nhận từ MBBank (2-5 giây sau khi chuyển khoản).');
      });
  };

  function activateVipPrivilege(packName) {
    isVip = true;
    currentPack = packName || 'VIP1';
    localStorage.setItem('nd_vip', 'true');
    localStorage.setItem('nd_pack', currentPack);
    shield = Math.max(shield, shieldMax());
    alert('🎉 KÍCH HOẠT ' + currentPack + ' THÀNH CÔNG!');
    closeShop();
  }

  window.shareGame = function() {
    var msg = '🚨 Đội ' + team + ' cần điểm! Tôi đạt ' + score + ' điểm trong Neon Dodge: ' + window.location.href;
    function grantShield() {
      shield = Math.max(shield, 1); obstacles = [];
      document.getElementById('gameOverModal').classList.remove('active');
      gameOver = false;
    }
    if (navigator.share) {
      navigator.share({ title: 'Đại Chiến 63 Tỉnh Thành', text: msg, url: window.location.href })
        .then(grantShield).catch(function(){});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(msg).then(function(){
        alert('Đã sao chép! Dán vào Zalo/Facebook để nhận +1 Khiên.');
        grantShield();
      }).catch(function(){ grantShield(); });
    } else {
      prompt('Sao chép lời kêu gọi:', msg); grantShield();
    }
  };

  draw();
})();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, secure-token');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && pathname === '/') {
    if (!rateLimit(ip, 'page', 120, 60000)) { res.writeHead(429); return res.end('Too many requests'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML_GAME);
  }

  if (req.method === 'GET' && pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('User-agent: *\nAllow: /\n');
  }

  if (req.method === 'GET' && pathname === '/sitemap.xml') {
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    return res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>/</loc></url></urlset>');
  }

  if (req.method === 'GET' && (pathname === '/favicon.ico' || pathname === '/og-image.png')) {
    res.writeHead(204); return res.end();
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    if (!rateLimit(ip, 'lb', 60, 60000)) { res.writeHead(429); return res.end('[]'); }
    const sorted = Object.keys(db.provinces)
      .map(name => ({ name, score: db.provinces[name] }))
      .sort((a, b) => b.score - a.score);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(sorted));
  }

  if (req.method === 'POST' && pathname === '/api/start-session') {
    if (!rateLimit(ip, 'sess', 30, 60000)) { res.writeHead(429); return res.end('{}'); }
    const token = crypto.randomBytes(16).toString('hex');
    db.sessions[token] = { startedAt: Date.now(), used: false };
    saveDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ token }));
  }

  if (req.method === 'POST' && pathname === '/api/score') {
    if (!rateLimit(ip, 'score', 30, 60000)) { res.writeHead(429); return res.end('{}'); }
    const body = await parseBody(req);
    const token = String(body.token || '');
    const team = String(body.team || '');
    const rawScore = Number(body.score);
    if (!token || !PROVINCE_SET.has(team) || !Number.isFinite(rawScore)) {
      res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid input' }));
    }
    const session = db.sessions[token];
    if (!session || session.used) {
      res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid session' }));
    }
    session.used = true;
    const pts = Math.min(500, Math.max(0, Math.floor(rawScore)));
    const elapsed = Date.now() - session.startedAt;
    const maxPlausible = Math.floor(elapsed / 150) + 5;
    const finalPts = Math.min(pts, maxPlausible);
    if (finalPts > 0) {
      db.provinces[team] = (db.provinces[team] || 50000) + finalPts;
      saveDB();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, accepted: finalPts }));
  }

  if (req.method === 'GET' && pathname === '/api/check-vip') {
    if (!rateLimit(ip, 'vip', 20, 60000)) { res.writeHead(429); return res.end('{}'); }
    const code = String(parsedUrl.query.code || '').toUpperCase();
    if (!/^ND[0-9A-F]{8}$/.test(code)) {
      res.writeHead(400); return res.end(JSON.stringify({ paid: false }));
    }
    const vipData = db.vipPlayers[code];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ paid: Boolean(vipData), data: vipData || null }));
  }

  if (req.method === 'POST' && pathname === '/api/webhook/payment') {
    if (!rateLimit(ip, 'webhook', 120, 60000)) { res.writeHead(429); return res.end('{}'); }

    const authHeader = req.headers['authorization'] || '';
    const cassoToken = req.headers['secure-token'] || '';
    const isAuthorized =
      safeEqual(authHeader, 'Apikey ' + WEBHOOK_SECRET) ||
      safeEqual(authHeader, 'Bearer ' + WEBHOOK_SECRET) ||
      safeEqual(cassoToken, WEBHOOK_SECRET);

    if (!isAuthorized) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
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
      const playerMatch = tx.content.match(/ND[0-9A-F]{8}/);
      const packMatch = tx.content.match(/VIP1|VIP2|SVIP/);
      if (playerMatch) {
        const playerCode = playerMatch[0];
        const packName = packMatch ? packMatch[0] : 'VIP1';
        const minAmount = PACK_PRICES[packName] || 20000;
        if (tx.amount >= minAmount) {
          db.vipPlayers[playerCode] = {
            pack: packName, amount: tx.amount, paidAt: new Date().toISOString()
          };
          activated++;
          console.log('[DUYỆT] +' + tx.amount + 'đ -> ' + packName + ' cho ' + playerCode);
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
  console.log('🚀 NEON DODGE VN — FIXED BUILD');
  console.log('👉 Chơi game:    http://localhost:' + PORT);
  console.log('👉 Webhook URL:  http://localhost:' + PORT + '/api/webhook/payment');
  console.log('🔐 WEBHOOK_SECRET đã nạp (' + WEBHOOK_SECRET.length + ' ký tự)');
  console.log('====================================================');
});

process.on('SIGINT', () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {} process.exit(0); });
