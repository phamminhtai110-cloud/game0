/**
 * TAI XIU VIP PRO - Self-Advertising Edition
 * Cháº¡y: WEBHOOK_SECRET=<secret> node taixiu2.js
 * Port: 3002
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3002;
const BANK_ID = 'MB';
const ACCOUNT_NO = '0865085878';
const DB_FILE = path.join(__dirname, 'taixiu2-db.json');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET || WEBHOOK_SECRET.length < 16) {
  console.error('âŒ Thiáº¿u WEBHOOK_SECRET (>=16 kÃ½ tá»±)');
  process.exit(1);
}

const PACK_PRICES = { VIP1: 20000, VIP2: 50000, SVIP: 100000 };
const VIP_MULTIPLIER = { VIP1: 2, VIP2: 2, SVIP: 3 };
const START_COINS = 5000;
const MIN_BET = 100;
const MAX_BET = 10000;

// ================= Cáº¤U HÃŒNH QUáº¢NG CÃO Tá»° QUáº¢N =================
// ÄÃ¢y lÃ  cÃ¡c "quáº£ng cÃ¡o" cá»§a báº¡n â€” tá»± quáº£ng cÃ¡o chÃ©o game mÃ¬nh
const SELF_ADS = [
  {
    id: 'neon-dodge',
    title: 'ðŸš€ NEON DODGE â€” Äáº¡i Chiáº¿n 63 Tá»‰nh ThÃ nh',
    desc: '99% ngÆ°á»i chÆ¡i khÃ´ng qua ná»•i 50 Ä‘iá»ƒm!',
    url: 'https://neon-dodge-vn.onrender.com',
    emoji: 'ðŸŽ®',
    bg: 'linear-gradient(135deg, #00ffcc 0%, #0099ff 100%)',
    duration: 5
  },
  {
    id: 'taixiu-1',
    title: 'ðŸŽ² TÃ€I Xá»ˆU CLASSIC',
    desc: 'Game xÃºc xáº¯c truyá»n thá»‘ng, 10.000 xu khá»Ÿi Ä‘áº§u!',
    url: 'https://taixiu-vn.onrender.com',
    emoji: 'ðŸŽ²',
    bg: 'linear-gradient(135deg, #ff0055 0%, #ff9500 100%)',
    duration: 5
  },
  {
    id: 'share',
    title: 'ðŸ“¢ CHIA Sáºº Äá»‚ NHáº¬N 2.000 XU',
    desc: 'Má»i báº¡n bÃ¨ chÆ¡i cÃ¹ng, nháº­n thÃªm xu miá»…n phÃ­!',
    url: '',  // Special: trigger share
    emoji: 'ðŸŽ',
    bg: 'linear-gradient(135deg, #ffd700 0%, #ff9500 100%)',
    duration: 3
  }
];

const PROVINCES = Object.freeze([
  'HÃ  Ná»™i','TP.HCM','ÄÃ  Náºµng','Háº£i PhÃ²ng','Nghá»‡ An',
  'Thanh HÃ³a','Cáº§n ThÆ¡','BÃ¬nh DÆ°Æ¡ng','Äá»“ng Nai','Tá»‰nh KhÃ¡c'
]);
const PROVINCE_SET = new Set(PROVINCES);

let db = {
  players: {},
  provinces: {},
  processedTx: {},
  sessions: {},
  adStats: { impressions: 0, rewards: 0, clicks: 0 }
};

PROVINCES.forEach(p => db.provinces[p] = 0);

if (fs.existsSync(DB_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = Object.assign(db, loaded);
    PROVINCES.forEach(p => { if (typeof db.provinces[p] !== 'number') db.provinces[p] = 0; });
  } catch (e) { console.error('âš ï¸ DB lá»—i:', e.message); }
}

let saveTimer = null;
function saveDB() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); } catch {}
  }, 500);
}

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

function rollDice() { return [0, 0, 0].map(() => 1 + crypto.randomInt(6)); }
function classifyDice(d) {
  const sum = d[0] + d[1] + d[2];
  const allSame = d[0] === d[1] && d[1] === d[2];
  let result;
  if (allSame) result = 'bao';
  else if (sum >= 4 && sum <= 10) result = 'xiu';
  else if (sum >= 11 && sum <= 17) result = 'tai';
  else result = 'khac';
  return { sum, allSame, result };
}

// ================= HTML =================
const HTML_GAME = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
  <meta name="monetag" content="77d13f3d5476e6baf4972ea41b762054">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>ðŸŽ° TÃ i Xá»‰u VIP Pro - Äáº¡i Chiáº¿n 63 Tá»‰nh</title>
<meta name="description" content="TÃ i Xá»‰u VIP Pro - Game xÃºc xáº¯c cao cáº¥p, Ä‘ua top 63 tá»‰nh thÃ nh. ChÆ¡i ngay!">
<style>
*{box-sizing:border-box;margin:0;padding:0;user-select:none;font-family:system-ui,-apple-system,sans-serif;-webkit-tap-highlight-color:transparent}
body{background:#000;color:#fff;overflow:hidden;display:flex;justify-content:center;align-items:center;height:100vh}
#app{position:relative;width:100%;max-width:430px;height:100vh;max-height:820px;background:radial-gradient(ellipse at 50% 0%,#2a1500 0%,#0a0500 60%);overflow:hidden;display:flex;flex-direction:column}
#app::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 30%,rgba(255,215,0,.08) 0%,transparent 60%);pointer-events:none}

.topbar{padding:10px 14px;display:flex;justify-content:space-between;align-items:center;background:linear-gradient(180deg,rgba(255,215,0,.08),transparent);border-bottom:1px solid rgba(255,215,0,.2);z-index:2}
.brand{font-size:13px;font-weight:900;color:#ffd700;text-shadow:0 0 12px rgba(255,215,0,.7);letter-spacing:1px}
.brand small{display:block;font-size:9px;color:#f59e0b;letter-spacing:2px;font-weight:500;margin-top:1px}
.top-actions{display:flex;gap:6px}
.icon-btn{background:rgba(255,215,0,.1);border:1px solid rgba(255,215,0,.3);color:#ffd700;width:34px;height:34px;border-radius:10px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.icon-btn:active{transform:scale(.94)}

.stats-bar{display:flex;padding:8px 14px;gap:8px;background:rgba(0,0,0,.4);border-bottom:1px solid rgba(255,215,0,.1);z-index:2}
.stat{flex:1;text-align:center;padding:6px;border-radius:8px;background:rgba(255,215,0,.05);border:1px solid rgba(255,215,0,.15)}
.stat .lbl{font-size:8px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px}
.stat .val{font-size:14px;font-weight:900;color:#ffd700;margin-top:2px;text-shadow:0 0 8px rgba(255,215,0,.5)}

/* ================= AD SLOT (native ad) ================= */
.ad-slot{position:relative;margin:8px 12px;border-radius:12px;overflow:hidden;cursor:pointer;transition:transform .15s;z-index:2;border:1px solid rgba(255,215,0,.2)}
.ad-slot:active{transform:scale(.98)}
.ad-slot .inner{padding:10px 12px;display:flex;align-items:center;gap:10px;position:relative}
.ad-slot .emoji{font-size:28px;flex-shrink:0}
.ad-slot .text{flex:1;min-width:0}
.ad-slot .title{font-size:12px;font-weight:800;color:#000;text-shadow:0 1px 0 rgba(255,255,255,.3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ad-slot .desc{font-size:10px;color:rgba(0,0,0,.7);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ad-slot .cta{background:rgba(0,0,0,.3);color:#fff;font-size:10px;font-weight:800;padding:5px 10px;border-radius:8px;flex-shrink:0}
.ad-label{position:absolute;top:4px;right:6px;background:rgba(0,0,0,.6);color:#fff;font-size:8px;padding:1px 5px;border-radius:4px;font-weight:600;letter-spacing:.5px}
.ad-close{position:absolute;top:4px;left:6px;background:rgba(0,0,0,.5);color:#fff;font-size:10px;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer}

/* Dice area */
.play-area{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:14px;gap:14px;position:relative;z-index:1}
.dice-row{display:flex;gap:14px}
.die{width:76px;height:76px;background:linear-gradient(135deg,#fff 0%,#e2e8f0 100%);border-radius:16px;box-shadow:0 6px 24px rgba(255,215,0,.3),inset 0 -4px 8px rgba(0,0,0,.15);display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);padding:10px;gap:2px;transition:all .2s}
.die.vip{background:linear-gradient(135deg,#ffd700 0%,#ff9500 100%);box-shadow:0 6px 30px rgba(255,215,0,.6)}
.die.rolling{animation:shake .12s infinite}
@keyframes shake{0%,100%{transform:rotate(-10deg) scale(1.05)}50%{transform:rotate(10deg) scale(1.05)}}
.pip{width:100%;height:100%;border-radius:50%;background:#1a1a2e;box-shadow:inset 0 2px 4px rgba(0,0,0,.4)}

.sum{font-size:44px;font-weight:900;color:#ffd700;text-shadow:0 0 24px currentColor;transition:all .3s;min-height:52px}
.sum.tai{color:#ff0055}.sum.xiu{color:#00ffcc}.sum.bao{color:#ffd700}
.result{font-size:15px;font-weight:900;letter-spacing:2px;text-transform:uppercase;opacity:0;transition:opacity .3s;min-height:20px}
.result.show{opacity:1}
.result.win{color:#00ff88;text-shadow:0 0 12px #00ff88}
.result.lose{color:#ff4444}
.result.bao{color:#ffd700;text-shadow:0 0 14px #ffd700}

/* Rewarded ad button */
.reward-btn{margin:0 12px 8px;padding:10px;background:linear-gradient(135deg,#ffd700,#ff9500);color:#000;border:none;border-radius:10px;font-weight:900;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 0 18px rgba(255,215,0,.5);z-index:2;position:relative}
.reward-btn:active{transform:scale(.97)}
.reward-btn:disabled{opacity:.4;filter:grayscale(1)}

/* Bet section */
.bet-section{padding:12px;background:linear-gradient(0deg,rgba(255,215,0,.08),transparent);border-top:1px solid rgba(255,215,0,.2);z-index:2}
.chips{display:flex;gap:6px;margin-bottom:10px;justify-content:center}
.chip{flex:1;max-width:70px;padding:8px 4px;border-radius:10px;border:1px solid rgba(255,215,0,.4);background:rgba(255,215,0,.06);color:#ffd700;font-weight:800;font-size:11px;cursor:pointer;transition:all .15s}
.chip.active{background:#ffd700;color:#000;box-shadow:0 0 14px rgba(255,215,0,.6)}
.actions{display:flex;gap:8px}
.act{flex:1;padding:16px 8px;border:none;border-radius:14px;font-size:17px;font-weight:900;cursor:pointer;letter-spacing:1.5px;position:relative}
.act:active{transform:scale(.96)}
.act:disabled{opacity:.4}
.act.tai{background:linear-gradient(135deg,#ff0055,#ff0080);color:#fff;box-shadow:0 6px 20px rgba(255,0,85,.5)}
.act.xiu{background:linear-gradient(135deg,#00ffcc,#00b8ff);color:#000;box-shadow:0 6px 20px rgba(0,255,204,.5)}
.act small{display:block;font-size:9px;font-weight:600;opacity:.85;letter-spacing:0;margin-top:2px}
.act .mult{position:absolute;top:5px;right:6px;font-size:9px;background:rgba(0,0,0,.4);padding:2px 6px;border-radius:8px}

/* History */
.history{padding:6px 12px 10px;font-size:10px;text-align:center;color:#94a3b8;background:rgba(0,0,0,.5);z-index:2}
.history .h-item{display:inline-block;margin:0 2px;padding:3px 8px;border-radius:6px;font-weight:800;font-size:11px}
.history .tai{background:rgba(255,0,85,.25);color:#ff5577}
.history .xiu{background:rgba(0,255,204,.25);color:#00ffcc}
.history .bao{background:rgba(255,215,0,.25);color:#ffd700}

/* Modals */
.modal{position:absolute;inset:0;background:rgba(0,0,0,.96);display:none;flex-direction:column;justify-content:center;align-items:center;padding:20px;text-align:center;z-index:30;overflow-y:auto}
.modal.active{display:flex}
.modal h1,.modal h2{color:#ffd700;text-transform:uppercase;margin-bottom:10px;font-size:22px;letter-spacing:1px}
.modal p{color:#cbd5e1;font-size:13px;line-height:1.5;margin-bottom:12px}
.btn{width:100%;max-width:300px;padding:13px;margin:4px 0;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;letter-spacing:.5px}
.btn:active{transform:scale(.96)}
.btn-primary{background:linear-gradient(45deg,#ffd700,#ff9500);color:#000}
.btn-secondary{background:#1e293b;color:#ffd700;border:1px solid #ffd700}
.btn-danger{background:#7f1d1d;color:#fff}
select{width:100%;max-width:300px;padding:12px;border-radius:10px;border:2px solid #ffd700;background:#0f172a;color:#fff;font-size:14px;font-weight:bold;margin-bottom:12px;outline:none}

.qr-card{background:#fff;color:#000;padding:12px;border-radius:14px;width:100%;max-width:300px;margin-bottom:10px}
.qr-card img{width:100%;max-width:180px}
.bank-info{font-size:12px;text-align:left;background:#f1f5f9;padding:8px;border-radius:8px;line-height:1.5;margin-top:6px}
.pack-select{display:flex;gap:6px;margin-bottom:10px;width:100%;max-width:300px}
.pack-btn{flex:1;padding:8px 4px;border-radius:8px;border:1px solid #ffd700;background:transparent;color:#ffd700;cursor:pointer;font-weight:bold;font-size:10px}
.pack-btn.selected{background:#ffd700;color:#000}
.status-wait{font-size:11px;color:#ffd700;margin-bottom:8px;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* Rewarded ad modal */
#adModal{background:rgba(0,0,0,.98)}
.ad-view{width:100%;max-width:340px;background:linear-gradient(135deg,#1a0a2e 0%,#0a0500 100%);border:2px solid #ffd700;border-radius:16px;padding:24px;position:relative;overflow:hidden}
.ad-view::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 30%,rgba(255,215,0,.15),transparent 70%);pointer-events:none}
.ad-view .ad-emoji{font-size:72px;margin-bottom:14px;filter:drop-shadow(0 0 20px rgba(255,215,0,.6))}
.ad-view .ad-title{font-size:18px;font-weight:900;color:#ffd700;margin-bottom:6px}
.ad-view .ad-desc{font-size:13px;color:#cbd5e1;margin-bottom:18px;line-height:1.4}
.ad-view .ad-cta{display:inline-block;background:linear-gradient(45deg,#ffd700,#ff9500);color:#000;padding:11px 24px;border-radius:12px;font-size:14px;font-weight:900;text-decoration:none;margin-bottom:14px;box-shadow:0 0 20px rgba(255,215,0,.5)}
.ad-view .ad-timer{font-size:12px;color:#94a3b8}
.ad-view .ad-timer b{color:#ffd700;font-size:16px}
.ad-progress{height:4px;background:rgba(255,215,0,.2);border-radius:2px;overflow:hidden;margin-top:12px}
.ad-progress .bar{height:100%;background:linear-gradient(90deg,#ffd700,#ff9500);width:0%;transition:width .3s linear}

.leaderboard{margin-top:12px;width:100%;max-width:320px;background:rgba(255,215,0,.05);border:1px solid rgba(255,215,0,.2);border-radius:10px;padding:10px;font-size:12px;text-align:left}
.leaderboard .row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,215,0,.08)}
.leaderboard .row:last-child{border-bottom:none}
</style>

</head>
<body>
<div id="app">
  <!-- Top bar -->
  <div class="topbar">
    <div class="brand">ðŸŽ° TÃ€I Xá»ˆU VIP PRO<small>Äáº I CHIáº¾N 63 Tá»ˆNH THÃ€NH</small></div>
    <div class="top-actions">
      <button class="icon-btn" onclick="showRank()" title="BXH">ðŸ†</button>
      <button class="icon-btn" onclick="openShop()" title="VIP">ðŸ‘‘</button>
    </div>
  </div>

  <!-- Stats -->
  <div class="stats-bar">
    <div class="stat"><div class="lbl">ðŸ’° Xu</div><div class="val" id="coinsVal">0</div></div>
    <div class="stat"><div class="lbl">ðŸ“ Tá»‰nh</div><div class="val" id="teamVal" style="font-size:11px">TP.HCM</div></div>
    <div class="stat"><div class="lbl">ðŸ‘‘ VIP</div><div class="val" id="vipVal" style="font-size:11px">â€”</div></div>
  </div>

  <!-- SELF-AD SLOT #1 (top banner) -->
  <div class="ad-slot" id="adTop" onclick="clickAd('top')">
    <div class="inner" id="adTopInner"></div>
    <div class="ad-label">Quáº£ng cÃ¡o</div>
  </div>

  <!-- Dice area -->
  <div class="play-area">
    <div class="dice-row">
      <div class="die" id="d0"></div>
      <div class="die" id="d1"></div>
      <div class="die" id="d2"></div>
    </div>
    <div class="sum" id="sumEl">â€”</div>
    <div class="result" id="resEl"></div>
  </div>

  <!-- Rewarded ad button -->
  <button class="reward-btn" id="rewardBtn" onclick="openRewardedAd()">ðŸŽ XEM QC NHáº¬N +1.000 XU</button>

  <!-- Bet section -->
  <div class="bet-section">
    <div class="chips" id="chipRow">
      <div class="chip active" data-amt="100">100</div>
      <div class="chip" data-amt="500">500</div>
      <div class="chip" data-amt="1000">1K</div>
      <div class="chip" data-amt="5000">5K</div>
      <div class="chip" data-amt="10000">10K</div>
    </div>
    <div class="actions">
      <button class="act xiu" id="btnXiu" onclick="bet('xiu')">Xá»ˆU<span class="mult" id="mx">x2</span><small>4-10</small></button>
      <button class="act tai" id="btnTai" onclick="bet('tai')">TÃ€I<span class="mult" id="mt">x2</span><small>11-17</small></button>
    </div>
  </div>

  <!-- History -->
  <div class="history">Lá»‹ch sá»­: <span id="histList" style="color:#64748b">chÆ°a cÃ³</span></div>

  <!-- Start modal -->
  <div class="modal active" id="startModal">
    <h1>ðŸŽ° TÃ€I Xá»ˆU VIP PRO</h1>
    <p>ChÃ o má»«ng! Báº¡n cÃ³ <b style="color:#ffd700">5.000 xu</b> khá»Ÿi Ä‘áº§u.<br>Chá»n tá»‰nh thÃ nh Ä‘á»ƒ cÃ¹ng tranh tÃ i:</p>
    <select id="provSelect">
      <option value="TP.HCM">ðŸ”¥ TP. Há»“ ChÃ­ Minh</option>
      <option value="HÃ  Ná»™i">ðŸ”¥ HÃ  Ná»™i</option>
      <option value="ÄÃ  Náºµng">ðŸŒŠ ÄÃ  Náºµng</option>
      <option value="Háº£i PhÃ²ng">âš“ Háº£i PhÃ²ng</option>
      <option value="Nghá»‡ An">ðŸ¦ Nghá»‡ An</option>
      <option value="Thanh HÃ³a">âš¡ Thanh HÃ³a</option>
      <option value="Cáº§n ThÆ¡">ðŸŒ¾ Cáº§n ThÆ¡</option>
      <option value="BÃ¬nh DÆ°Æ¡ng">ðŸš€ BÃ¬nh DÆ°Æ¡ng</option>
      <option value="Äá»“ng Nai">ðŸ’Ž Äá»“ng Nai</option>
      <option value="Tá»‰nh KhÃ¡c">ðŸ‡»ðŸ‡³ Tá»‰nh KhÃ¡c</option>
    </select>
    <button class="btn btn-primary" onclick="startGame()">ðŸš€ Báº®T Äáº¦U</button>
  </div>

  <!-- Broke modal -->
  <div class="modal" id="brokeModal">
    <h2>ðŸ˜­ Háº¾T XU!</h2>
    <p>Xem quáº£ng cÃ¡o Ä‘á»ƒ nháº­n thÃªm xu hoáº·c náº¡p VIP:</p>
    <button class="btn btn-primary" onclick="openRewardedAd()">ðŸŽ XEM QC +2.000 XU</button>
    <button class="btn btn-secondary" onclick="openShop()">ðŸ‘‘ Náº P VIP</button>
  </div>

  <!-- Shop modal -->
  <div class="modal" id="shopModal">
    <h2>ðŸ‘‘ NÃ‚NG Cáº¤P VIP</h2>
    <p>QuÃ©t QR, há»‡ thá»‘ng <b>tá»± Ä‘á»™ng má»Ÿ khÃ³a VIP</b>:</p>
    <div class="pack-select">
      <button class="pack-btn selected" data-pack="VIP1" data-amt="20000" onclick="selectPack(this)">20K<br><small>x2 tháº¯ng</small></button>
      <button class="pack-btn" data-pack="VIP2" data-amt="50000" onclick="selectPack(this)">50K<br><small>x2 + báº¡c</small></button>
      <button class="pack-btn" data-pack="SVIP" data-amt="100000" onclick="selectPack(this)">100K<br><small>x3 + vÃ ng</small></button>
    </div>
    <div class="qr-card">
      <img id="qrImg" src="" alt="VietQR"/>
      <div class="bank-info">
        <div>ðŸ¦ MBBank</div>
        <div>ðŸ’³ <b>0865085878</b></div>
        <div>ðŸ’° <b id="qrAmt">20.000Ä‘</b></div>
        <div>ðŸ“ <b id="qrMemo" style="color:#d97706"></b></div>
      </div>
    </div>
    <div class="status-wait">ðŸ”„ Äang chá» xÃ¡c nháº­n...</div>
    <button class="btn btn-primary" onclick="checkPay()">âœ… Kiá»ƒm Tra</button>
    <button class="btn btn-secondary" onclick="closeModal('shopModal')">Quay Láº¡i</button>
  </div>

  <!-- Rank modal -->
  <div class="modal" id="rankModal">
    <h2>ðŸ† BXH Tá»ˆNH THÃ€NH</h2>
    <div class="leaderboard" id="rankList"></div>
    <button class="btn btn-primary" style="margin-top:14px" onclick="closeModal('rankModal')">ÄÃ³ng</button>
  </div>

  <!-- Rewarded AD Modal -->
  <div class="modal" id="adModal">
    <div class="ad-view">
      <div class="ad-emoji" id="adEmoji">ðŸŽ</div>
      <div class="ad-title" id="adTitle"></div>
      <div class="ad-desc" id="adDesc"></div>
      <a class="ad-cta" id="adCta" href="#" target="_blank" onclick="clickAd('rewarded')">CHÆ I NGAY</a>
      <div class="ad-timer">ÄÃ³ng sau <b id="adTimer">5</b>s</div>
      <div class="ad-progress"><div class="bar" id="adBar"></div></div>
    </div>
  </div>
</div>

<script>
(function(){
  'use strict';

  var savedCode = localStorage.getItem('tx2_code') || '';
  if (!/^TX[0-9A-F]{8}$/.test(savedCode)) {
    var a = new Uint8Array(4);
    (window.crypto || window.msCrypto).getRandomValues(a);
    savedCode = 'TX' + Array.from(a, b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
    localStorage.setItem('tx2_code', savedCode);
  }

  var state = {
    coins: 0,
    team: localStorage.getItem('tx2_team') || 'TP.HCM',
    vip: localStorage.getItem('tx2_vip') || '',
    betAmt: 100,
    rolling: false,
    token: null,
    adIndex: 0
  };

  var packState = { amt: 20000, name: 'VIP1' };
  var payTimer = null;
  var hist = [];

  function fmt(n) { return n.toLocaleString('vi-VN'); }

  function updateUI() {
    document.getElementById('coinsVal').textContent = fmt(state.coins);
    document.getElementById('teamVal').textContent = state.team;
    document.getElementById('vipVal').textContent = state.vip || 'â€”';
    var m = state.vip === 'SVIP' ? 3 : (state.vip ? 2 : 1);
    document.getElementById('mt').textContent = 'x' + m;
    document.getElementById('mx').textContent = 'x' + m;
    document.querySelectorAll('.die').forEach(d => d.classList.toggle('vip', state.vip === 'SVIP'));
    var dis = state.rolling || state.coins < state.betAmt;
    document.getElementById('btnTai').disabled = dis;
    document.getElementById('btnXiu').disabled = dis;
  }

  function renderDie(el, v) {
    var pips = {1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
    el.innerHTML = '';
    var on = pips[v] || [];
    for (var i=0;i<9;i++) {
      var p = document.createElement('div');
      p.className = 'pip';
      p.style.visibility = on.indexOf(i)>=0 ? 'visible' : 'hidden';
      el.appendChild(p);
    }
  }

  function animateRoll(target, cb) {
    state.rolling = true; updateUI();
    var dice = document.querySelectorAll('.die');
    dice.forEach(d => d.classList.add('rolling'));
    var f = 0;
    var iv = setInterval(function() {
      f++;
      dice.forEach(d => renderDie(d, 1+Math.floor(Math.random()*6)));
      if (f>=12) {
        clearInterval(iv);
        dice.forEach((d,i)=>{ d.classList.remove('rolling'); renderDie(d, target[i]); });
        cb();
      }
    }, 55);
  }

  function showResult(dice, won, payout) {
    var sum = dice[0]+dice[1]+dice[2];
    var allSame = dice[0]===dice[1] && dice[1]===dice[2];
    var cls = allSame ? 'bao' : (sum>=11 ? 'tai' : (sum>=4 ? 'xiu' : 'khac'));
    var s = document.getElementById('sumEl');
    s.textContent = sum; s.className = 'sum ' + cls;
    var r = document.getElementById('resEl');
    if (allSame) { r.textContent = 'ðŸŽ‰ BÃƒO! x30'; r.className = 'result show bao'; }
    else if (won) { r.textContent = 'âœ… +' + fmt(payout); r.className = 'result show win'; }
    else { r.textContent = 'âŒ -' + fmt(state.betAmt); r.className = 'result show lose'; }
    hist.unshift(cls); if (hist.length>8) hist.pop();
    var hl = document.getElementById('histList');
    hl.innerHTML = hist.map(c=>'<span class="h-item '+c+'">'+(c==='tai'?'T':c==='xiu'?'X':'B')+'</span>').join('');
    state.rolling = false; updateUI();
  }

  window.bet = function(side) {
    if (state.rolling || state.coins < state.betAmt) return;
    fetch('/api/bet', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({code:savedCode, team:state.team, side:side, amount:state.betAmt, token:state.token})
    }).then(r=>r.json()).then(res=>{
      if (!res.success) { alert(res.error||'Lá»—i'); return; }
      state.coins = res.coins; state.token = res.newToken;
      animateRoll(res.dice, function() {
        showResult(res.dice, res.won, res.payout);
        if (res.coins <= 0) setTimeout(()=>document.getElementById('brokeModal').classList.add('active'), 700);
      });
    }).catch(()=>alert('Lá»—i káº¿t ná»‘i'));
  };

  function fetchMe() {
    fetch('/api/me?code=' + encodeURIComponent(savedCode))
      .then(r=>r.json()).then(res=>{
        state.coins = res.coins;
        if (res.team) state.team = res.team;
        if (res.vip) state.vip = res.vip;
        state.token = res.token;
        updateUI();
      }).catch(()=>{});
  }

  window.startGame = function() {
    state.team = document.getElementById('provSelect').value;
    localStorage.setItem('tx2_team', state.team);
    fetch('/api/set-team', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({code:savedCode, team:state.team})})
      .then(()=>{ document.getElementById('startModal').classList.remove('active'); updateUI(); });
  };

  // ================= SELF-AD SYSTEM =================
  var ads = window.__ADS__ || [];
  var adIdx = 0;
  var adImpressions = {};

  function renderAdSlot(el, ad) {
    if (!ad) return;
    el.innerHTML = '<div class="emoji">'+ad.emoji+'</div>'+
      '<div class="text"><div class="title">'+ad.title+'</div><div class="desc">'+ad.desc+'</div></div>'+
      '<div class="cta">CHÆ I â†’</div>';
    el.style.background = ad.bg;
    el.style.color = '#000';
  }

  function rotateTopAd() {
    if (!ads.length) return;
    var ad = ads[adIdx % ads.length];
    adIdx++;
    renderAdSlot(document.getElementById('adTopInner'), ad);
    document.getElementById('adTop').dataset.adId = ad.id;
    document.getElementById('adTop').dataset.adUrl = ad.url;
    adImpressions[ad.id] = (adImpressions[ad.id]||0)+1;
    fetch('/api/ad/impression', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({adId: ad.id})}).catch(()=>{});
  }

  window.clickAd = function(slot) {
    if (slot === 'top') {
      var el = document.getElementById('adTop');
      var id = el.dataset.adId;
      var u = el.dataset.adUrl;
      fetch('/api/ad/click', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({adId: id})}).catch(()=>{});
      if (u) window.open(u, '_blank');
      else if (id === 'share') shareGame();
    } else if (slot === 'rewarded') {
      var ad = ads[state.adIndex % ads.length];
      fetch('/api/ad/click', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({adId: ad.id})}).catch(()=>{});
    }
  };

  function shareGame() {
    var msg = 'ðŸŽ° TÃ i Xá»‰u VIP Pro â€” Äáº¡i chiáº¿n 63 tá»‰nh thÃ nh! Thá»­ váº­n may ngay: ' + window.location.href;
    if (navigator.share) navigator.share({title:'TÃ i Xá»‰u VIP Pro', text: msg, url: window.location.href}).catch(()=>{});
    else if (navigator.clipboard) navigator.clipboard.writeText(msg).then(()=>alert('ÄÃ£ sao chÃ©p!')).catch(()=>{});
    else prompt('Sao chÃ©p link:', msg);
  }

  // ================= REWARDED AD =================
  var adTimerInterval = null;
  var currentAd = null;

  window.openRewardedAd = function() {
    if (!ads.length) { alert('KhÃ´ng cÃ³ quáº£ng cÃ¡o'); return; }
    currentAd = ads[state.adIndex % ads.length];
    state.adIndex++;

    var m = document.getElementById('adModal');
    document.getElementById('adEmoji').textContent = currentAd.emoji;
    document.getElementById('adTitle').textContent = currentAd.title;
    document.getElementById('adDesc').textContent = currentAd.desc;
    var cta = document.getElementById('adCta');
    if (currentAd.url) { cta.href = currentAd.url; cta.style.display = 'inline-block'; }
    else { cta.href = '#'; cta.textContent = 'ðŸ“¢ CHIA Sáºº NGAY'; }

    fetch('/api/ad/impression', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({adId: currentAd.id})}).catch(()=>{});

    m.classList.add('active');
    document.getElementById('brokeModal').classList.remove('active');

    var dur = currentAd.duration || 5;
    var t = dur;
    document.getElementById('adTimer').textContent = t;
    document.getElementById('adBar').style.width = '0%';

    adTimerInterval = setInterval(function() {
      t--;
      document.getElementById('adTimer').textContent = Math.max(t,0);
      document.getElementById('adBar').style.width = ((dur-t)/dur*100) + '%';
      if (t <= 0) {
        clearInterval(adTimerInterval); adTimerInterval = null;
        m.classList.remove('active');
        // Grant reward
        var reward = state.coins <= 0 ? 2000 : 1000;
        fetch('/api/reward-ad', {method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({code:savedCode, adId: currentAd.id, amount: reward})})
          .then(r=>r.json()).then(res=>{
            if (res.success) {
              state.coins = res.coins;
              state.token = res.newToken;
              updateUI();
              alert('ðŸŽ Nháº­n +' + fmt(reward) + ' xu!');
            }
          }).catch(()=>{});
      }
    }, 1000);
  };

  // ================= SHOP =================
  function updateQR(amt, name) {
    var memo = name + ' ' + savedCode;
    var q = 'https://img.vietqr.io/image/MB-0865085878-compact2.png?amount='+amt+'&addInfo='+encodeURIComponent(memo);
    document.getElementById('qrImg').src = q;
    document.getElementById('qrAmt').textContent = amt.toLocaleString('vi-VN') + 'Ä‘';
    document.getElementById('qrMemo').textContent = memo;
  }

  window.selectPack = function(el) {
    document.querySelectorAll('.pack-btn').forEach(b=>b.classList.remove('selected'));
    el.classList.add('selected');
    packState = { amt: parseInt(el.dataset.amt,10), name: el.dataset.pack };
    updateQR(packState.amt, packState.name);
  };

  window.openShop = function() {
    updateQR(packState.amt, packState.name);
    document.getElementById('shopModal').classList.add('active');
    if (payTimer) clearInterval(payTimer);
    payTimer = setInterval(checkPay2, 3000);
  };

  window.closeModal = function(id) {
    document.getElementById(id).classList.remove('active');
    if (payTimer && id === 'shopModal') { clearInterval(payTimer); payTimer = null; }
  };

  function checkPay2() {
    fetch('/api/check-vip?code=' + encodeURIComponent(savedCode))
      .then(r=>r.json()).then(res=>{
        if (res.paid) {
          clearInterval(payTimer); payTimer = null;
          state.vip = res.data.pack;
          localStorage.setItem('tx2_vip', state.vip);
          alert('ðŸŽ‰ KÃCH HOáº T ' + state.vip + '!');
          closeModal('shopModal');
          updateUI();
        }
      }).catch(()=>{});
  }

  window.checkPay = function() {
    fetch('/api/check-vip?code=' + encodeURIComponent(savedCode))
      .then(r=>r.json()).then(res=>{
        if (res.paid) {
          state.vip = res.data.pack;
          localStorage.setItem('tx2_vip', state.vip);
          alert('ðŸŽ‰ KÃCH HOáº T ' + state.vip + '!');
          closeModal('shopModal');
          updateUI();
        } else alert('â³ ChÆ°a nháº­n Ä‘Æ°á»£c giao dá»‹ch. Äá»£i 2-5 giÃ¢y sau khi chuyá»ƒn khoáº£n.');
      });
  };

  window.showRank = function() {
    fetch('/api/leaderboard').then(r=>r.json()).then(list=>{
      var html = '';
      list.slice(0,10).forEach((it,i)=>{
        var medal = ['ðŸ¥‡','ðŸ¥ˆ','ðŸ¥‰'][i] || (i+1)+'.';
        html += '<div class="row"><span>'+medal+' '+it.name+'</span><span style="color:#ffd700">'+fmt(it.score)+' xu</span></div>';
      });
      document.getElementById('rankList').innerHTML = html;
      document.getElementById('rankModal').classList.add('active');
    });
  };

  // Bet chips
  document.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', ()=>{
      document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
      c.classList.add('active');
      state.betAmt = parseInt(c.dataset.amt, 10);
      updateUI();
    });
  });

  // Rotate ad every 15s
  setInterval(rotateTopAd, 15000);

  // Init
  fetchMe();
  // Load ads config
  fetch('/api/ads').then(r=>r.json()).then(list=>{ window.__ADS__ = list; rotateTopAd(); }).catch(()=>{});
})();
</script>
</body>
</html>`;

// ================= HTTP SERVER =================
function getPlayer(code) {
  if (!db.players[code]) {
    db.players[code] = { coins: START_COINS, totalWon: 0, team: null, vipPack: '', lastReward: 0, createdAt: Date.now() };
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

const server = http.createServer(async (req, res) => {
  const p = url.parse(req.url, true);
  const pathname = p.pathname;
  const ip = (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, secure-token');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML_GAME);
  }

  if (req.method === 'GET' && pathname === '/api/ads') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(SELF_ADS));
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    const sorted = Object.keys(db.provinces).map(n=>({name:n, score:db.provinces[n]})).sort((a,b)=>b.score-a.score);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(sorted));
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    const code = String(p.query.code||'').toUpperCase();
    if (!/^TX[0-9A-F]{8}$/.test(code)) { res.writeHead(400); return res.end('{}'); }
    const pl = getPlayer(code);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ coins: pl.coins, team: pl.team, vip: pl.vipPack, token: issueToken(code) }));
  }

  if (req.method === 'POST' && pathname === '/api/set-team') {
    const b = await parseBody(req);
    const code = String(b.code||'').toUpperCase();
    const team = String(b.team||'');
    if (!/^TX[0-9A-F]{8}$/.test(code) || !PROVINCE_SET.has(team)) { res.writeHead(400); return res.end('{}'); }
    getPlayer(code).team = team;
    saveDB();
    res.writeHead(200); return res.end('{"success":true}');
  }

  if (req.method === 'POST' && pathname === '/api/bet') {
    if (!rateLimit(ip, 'bet', 60, 60_000)) { res.writeHead(429); return res.end('{"success":false}'); }
    const b = await parseBody(req);
    const code = String(b.code||'').toUpperCase();
    const team = String(b.team||'');
    const side = String(b.side||'');
    const amount = Math.floor(Number(b.amount)||0);
    const token = String(b.token||'');

    if (!/^TX[0-9A-F]{8}$/.test(code) || !PROVINCE_SET.has(team) || !['tai','xiu'].includes(side)) {
      res.writeHead(400); return res.end('{"success":false,"error":"Invalid input"}');
    }
    if (amount < MIN_BET || amount > MAX_BET) {
      res.writeHead(400); return res.end('{"success":false,"error":"CÆ°á»£c khÃ´ng há»£p lá»‡"}');
    }
    const sess = db.sessions[token];
    if (!sess || sess.playerCode !== code || sess.used) {
      res.writeHead(400); return res.end('{"success":false,"error":"PhiÃªn háº¿t háº¡n"}');
    }
    sess.used = true;

    const pl = getPlayer(code);
    if (pl.coins < amount) { res.writeHead(400); return res.end('{"success":false,"error":"KhÃ´ng Ä‘á»§ xu"}'); }
    pl.team = team;

    const dice = rollDice();
    const { sum, allSame, result } = classifyDice(dice);
    const mult = VIP_MULTIPLIER[pl.vipPack] || 1;

    let won = false, payout = 0;
    if (allSame) { won = true; payout = amount * 30 * mult; }
    else if ((result==='tai'&&side==='tai') || (result==='xiu'&&side==='xiu')) { won = true; payout = amount * 2 * mult; }
    else if (!allSame && (sum===3 || sum===18)) { payout = amount; } // hÃ²a

    let delta = 0;
    if (won) delta = payout - amount;
    else if (payout === amount) delta = 0;
    else delta = -amount;
    pl.coins += delta;

    if (won && payout > amount) {
      const profit = payout - amount;
      db.provinces[team] = (db.provinces[team]||0) + profit;
      pl.totalWon = (pl.totalWon||0) + profit;
    }

    const newToken = issueToken(code);
    saveDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, dice, sum, allSame, won, payout, coins: pl.coins, newToken }));
  }

  // ================= AD TRACKING =================
  if (req.method === 'POST' && pathname === '/api/ad/impression') {
    db.adStats.impressions++;
    saveDB();
    res.writeHead(200); return res.end('{"ok":true}');
  }

  if (req.method === 'POST' && pathname === '/api/ad/click') {
    db.adStats.clicks++;
    saveDB();
    res.writeHead(200); return res.end('{"ok":true}');
  }

  // ================= REWARDED AD =================
  if (req.method === 'POST' && pathname === '/api/reward-ad') {
    if (!rateLimit(ip, 'reward', 20, 3600_000)) { res.writeHead(429); return res.end('{"success":false,"error":"VÆ°á»£t giá»›i háº¡n"}'); }
    const b = await parseBody(req);
    const code = String(b.code||'').toUpperCase();
    const amount = Math.min(5000, Math.max(500, Number(b.amount) || 1000));
    if (!/^TX[0-9A-F]{8}$/.test(code)) { res.writeHead(400); return res.end('{"success":false}'); }
    const pl = getPlayer(code);
    const now = Date.now();
    // Cooldown 30s
    if (pl.lastReward && now - pl.lastReward < 30_000) {
      res.writeHead(429); return res.end('{"success":false,"error":"Äá»£i 30 giÃ¢y"}');
    }
    pl.lastReward = now;
    pl.coins += amount;
    db.adStats.rewards++;
    const newToken = issueToken(code);
    saveDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, coins: pl.coins, newToken }));
  }

  // ================= VIP CHECK =================
  if (req.method === 'GET' && pathname === '/api/check-vip') {
    const code = String(p.query.code||'').toUpperCase();
    if (!/^TX[0-9A-F]{8}$/.test(code)) { res.writeHead(400); return res.end('{"paid":false}'); }
    const pl = db.players[code];
    if (pl && pl.vipPack) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ paid: true, data: { pack: pl.vipPack } }));
    }
    res.writeHead(200); return res.end('{"paid":false}');
  }

  // ================= WEBHOOK =================
  if (req.method === 'POST' && pathname === '/api/webhook/payment') {
    const auth = req.headers['authorization'] || '';
    const ct = req.headers['secure-token'] || '';
    const ok = safeEqual(auth, 'Apikey '+WEBHOOK_SECRET) || safeEqual(auth, 'Bearer '+WEBHOOK_SECRET) || safeEqual(ct, WEBHOOK_SECRET);
    if (!ok) { res.writeHead(401); return res.end('{"success":false}'); }

    const b = await parseBody(req);
    const txs = [];
    if (b && b.transferAmount && b.content) {
      if (!b.transferType || b.transferType === 'in') {
        txs.push({ id: String(b.id||b.referenceCode||''), amount: Number(b.transferAmount), content: String(b.content).toUpperCase() });
      }
    } else if (b && Array.isArray(b.data)) {
      b.data.forEach(it => txs.push({ id: String(it.id||it.tid||''), amount: Number(it.amount), content: String(it.description||'').toUpperCase() }));
    }

    let activated = 0;
    for (const tx of txs) {
      if (!Number.isFinite(tx.amount) || tx.amount <= 0) continue;
      const key = tx.id || crypto.createHash('md5').update(tx.amount+'|'+tx.content).digest('hex');
      if (db.processedTx[key]) continue;
      // Match: TX2 prefix Ä‘á»ƒ trÃ¡nh nháº§m vá»›i 2 game khÃ¡c
      const pm = tx.content.match(/TX[0-9A-F]{8}/);
      const pk = tx.content.match(/VIP1|VIP2|SVIP/);
      if (pm) {
        const code = pm[0];
        const pack = pk ? pk[0] : 'VIP1';
        const min = PACK_PRICES[pack] || 20000;
        if (tx.amount >= min) {
          const pl = getPlayer(code);
          pl.vipPack = pack;
          activated++;
          console.log('[TX2 VIP] +'+tx.amount+'Ä‘ -> '+pack+' cho '+code);
        }
      }
      db.processedTx[key] = Date.now();
    }
    if (txs.length) saveDB();
    res.writeHead(200); return res.end(JSON.stringify({ success: true, activated }));
  }

  res.writeHead(404); res.end('404');
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log('ðŸŽ° TÃ€I Xá»ˆU VIP PRO â€” SELF-AD EDITION');
  console.log('ðŸ‘‰ ChÆ¡i:    http://localhost:' + PORT);
  console.log('ðŸ‘‰ Webhook: http://localhost:' + PORT + '/api/webhook/payment');
  console.log('ðŸ“Š Ad stats: ' + JSON.stringify(db.adStats));
  console.log('====================================================');
});

process.on('SIGINT', () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {} process.exit(0); });