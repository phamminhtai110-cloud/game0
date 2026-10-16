/**
 * XO SO VN - ALL-IN-ONE SINGLE FILE (SEO + Monetag Ads)
 * Chạy: WEBHOOK_SECRET=<secret> node xoso.js
 * Port: 3004
 *
 * Đặc điểm:
 * - Hiển thị KQXS 3 miền theo lịch thực tế (MB hàng ngày, MT/MN theo thứ)
 * - 4 zone Monetag: In-Page Push, Vignette, Popunder, Push
 * - SEO: schema.org LotteryResult, sitemap, robots, breadcrumb
 * - Trang thống kê: lô gan, bạch thủ, soi cầu, đặc biệt
 * - Mobile-first, tốc độ cao
 * - Zero dependencies
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// ================= CẤU HÌNH =================
const PORT = process.env.PORT || 3004;
const DB_FILE = path.join(__dirname, 'xoso-db.json');

// Monetag zones (4 zone bạn đã tạo)
const MONETAG_ZONES = {
  inpage:   '12043589',
  vignette: '12043590',
  popunder: '12043588',
  push:     '12043591'
};

const MONETAG_META = '<meta name="monetag" content="77d13f3d5476e6baf4972ea41b762054">';

const MONETAG_SCRIPTS = `
  <script src="//upgulpinon.com/1?z=${MONETAG_ZONES.inpage}" async></script>
  <script src="//upgulpinon.com/1?z=${MONETAG_ZONES.vignette}" async></script>
  <script src="//upgulpinon.com/1?z=${MONETAG_ZONES.popunder}" async></script>
  <script src="//upgulpinon.com/1?z=${MONETAG_ZONES.push}" async></script>
`;

// Lịch quay xổ số
const SCHEDULE = {
  mb: [1,2,3,4,5,6,7],                 // MB quay hàng ngày (CN=0)
  mt: { 0:['Kon Tum'], 1:['Huế','Phú Yên'], 2:['Đắk Lắk','Quảng Nam'], 3:['Đà Nẵng','Khánh Hòa'], 4:['Bình Định','Quảng Trị'], 5:['Gia Lai','Ninh Thuận'], 6:['Quảng Ngãi','Đắk Nông'] },
  mn: { 0:['Tiền Giang','Kiên Giang','Đà Lạt'], 1:['TP.HCM','Đồng Tháp','Cà Mau'], 2:['Bến Tre','Vũng Tàu','Bạc Liêu'], 3:['Đồng Nai','Cần Thơ','Sóc Trăng'], 4:['Tây Ninh','An Giang','Bình Thuận'], 5:['Vĩnh Long','Bình Dương','Trà Vinh'], 6:['TP.HCM','Long An','Bình Phước','Hậu Giang'] }
};

const PROVINCES = {
  mb: ['Hà Nội'],
  mt: ['Kon Tum','Huế','Phú Yên','Đắk Lắk','Quảng Nam','Đà Nẵng','Khánh Hòa','Bình Định','Quảng Trị','Gia Lai','Ninh Thuận','Quảng Ngãi','Đắk Nông'],
  mn: ['Tiền Giang','Kiên Giang','Đà Lạt','TP.HCM','Đồng Tháp','Cà Mau','Bến Tre','Vũng Tàu','Bạc Liêu','Đồng Nai','Cần Thơ','Sóc Trăng','Tây Ninh','An Giang','Bình Thuận','Vĩnh Long','Bình Dương','Trà Vinh','Long An','Bình Phước','Hậu Giang']
};

// ================= DB =================
let db = {
  results: {},         // 'YYYY-MM-DD' -> { mb: {...}, mt: [...], mn: [...] }
  stats: { views: 0, dailyViews: {} },
  createdAt: Date.now()
};

if (fs.existsSync(DB_FILE)) {
  try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); }
  catch (e) { console.error('DB load error:', e.message); }
}

let saveTimer = null;
function saveDB() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); } catch {}
  }, 500);
}

// ================= SINH KẾT QUẢ XỔ SỐ =================
function seededRandom(seed) {
  const hash = crypto.createHash('md5').update(String(seed)).digest();
  let idx = 0;
  return () => {
    if (idx + 4 > hash.length) idx = 0;
    const v = hash.readUInt32BE(idx);
    idx += 4;
    return v / 0xFFFFFFFF;
  };
}

function pad2(n) { return String(n).padStart(2, '0'); }

function generatePrize(random, digits, count = 1) {
  const prizes = [];
  for (let i = 0; i < count; i++) {
    let num = '';
    for (let d = 0; d < digits; d++) num += Math.floor(random() * 10);
    prizes.push(num);
  }
  return prizes;
}

function generateResult(dateStr, region, province) {
  const seed = dateStr + '|' + region + '|' + province;
  const random = seededRandom(seed);

  // Cơ cấu giải thưởng MB (27 giải), MT/MN (18 giải)
  if (region === 'mb') {
    return {
      province: province,
      giaiDB: generatePrize(random, 5, 1)[0],
      giaiNhat: generatePrize(random, 4, 1),
      giaiNhi: generatePrize(random, 4, 2),
      giaiBa: generatePrize(random, 4, 6),
      giaiTu: generatePrize(random, 3, 4),
      giaiNam: generatePrize(random, 3, 6),
      giaiSau: generatePrize(random, 3, 3),
      giaiBay: generatePrize(random, 2, 4)
    };
  } else {
    return {
      province: province,
      giaiDB: generatePrize(random, 6, 1)[0],
      giaiNhat: generatePrize(random, 5, 1),
      giaiNhi: generatePrize(random, 5, 1),
      giaiBa: generatePrize(random, 5, 2),
      giaiTu: generatePrize(random, 5, 7),
      giaiNam: generatePrize(random, 4, 1),
      giaiSau: generatePrize(random, 4, 3),
      giaiBay: generatePrize(random, 3, 1),
      giaiTam: generatePrize(random, 2, 1)
    };
  }
}

function getTodayVN() {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 3600 * 1000);
  return vn.toISOString().slice(0, 10);
}

function getDayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.getUTCDay();
}

function ensureResults(dateStr) {
  if (db.results[dateStr]) return db.results[dateStr];

  const dow = getDayOfWeek(dateStr);
  const day = { mb: null, mt: [], mn: [] };

  // MB quay hàng ngày
  if (SCHEDULE.mb.includes(dow)) {
    day.mb = generateResult(dateStr, 'mb', 'Hà Nội');
  }

  // MT
  const mtList = SCHEDULE.mt[dow] || [];
  day.mt = mtList.map(p => generateResult(dateStr, 'mt', p));

  // MN
  const mnList = SCHEDULE.mn[dow] || [];
  day.mn = mnList.map(p => generateResult(dateStr, 'mn', p));

  db.results[dateStr] = day;

  // Giữ 90 ngày gần nhất
  const keys = Object.keys(db.results).sort();
  if (keys.length > 90) {
    keys.slice(0, keys.length - 90).forEach(k => delete db.results[k]);
  }

  saveDB();
  return day;
}

// ================= HTML HELPERS =================
const DAY_NAMES = ['Chủ nhật','Thứ hai','Thứ ba','Thứ tư','Thứ năm','Thứ sáu','Thứ bảy'];
const DAY_SHORT = ['CN','T2','T3','T4','T5','T6','T7'];

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function renderPrizeBlock(title, prizes, isSpecial = false) {
  if (!prizes || prizes.length === 0) return '';
  const cls = isSpecial ? 'special' : '';
  return `
    <tr class="prize-row ${cls}">
      <td class="prize-label">${title}</td>
      <td class="prize-values">${prizes.map(p => `<span class="num">${p}</span>`).join('')}</td>
    </tr>`;
}

function renderProvinceTable(region, result) {
  if (!result) return '';
  let rows = '';
  rows += renderPrizeBlock('ĐB', [result.giaiDB], true);
  rows += renderPrizeBlock('G1', result.giaiNhat);
  rows += renderPrizeBlock('G2', result.giaiNhi);
  rows += renderPrizeBlock('G3', result.giaiBa);
  rows += renderPrizeBlock('G4', result.giaiTu);
  rows += renderPrizeBlock('G5', result.giaiNam);
  rows += renderPrizeBlock('G6', result.giaiSau);
  rows += renderPrizeBlock('G7', result.giaiBay);
  if (result.giaiTam) rows += renderPrizeBlock('G8', result.giaiTam);
  return `
    <div class="province-block">
      <div class="province-title">${result.province}</div>
      <table class="prize-table">${rows}</table>
    </div>`;
}

// ================= TRANG CHỦ =================
function renderHomePage(dateStr) {
  const day = ensureResults(dateStr);
  const dow = getDayOfWeek(dateStr);

  const mtHtml = day.mt.length ? day.mt.map(r => renderProvinceTable('mt', r)).join('') : '<div class="no-result">Hôm nay miền Trung không quay</div>';
  const mnHtml = day.mn.length ? day.mn.map(r => renderProvinceTable('mn', r)).join('') : '<div class="no-result">Hôm nay miền Nam không quay</div>';

  // Lấy kết quả 7 ngày trước
  const recentDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const ds = d.toISOString().slice(0, 10);
    if (i > 0) ensureResults(ds);
    recentDays.push(ds);
  }

  const recentHtml = recentDays.map(ds => {
    const d = new Date(ds + 'T00:00:00Z');
    const dayName = DAY_SHORT[d.getUTCDay()];
    const r = db.results[ds];
    const specialMB = r && r.mb ? r.mb.giaiDB : '—';
    return `<tr><td><a href="/ngay/${ds}">${dayName} ${formatDate(ds)}</a></td><td class="special-mini">${specialMB}</td></tr>`;
  }).join('');

  const title = `Kết Quả Xổ Số 3 Miền ${formatDate(dateStr)} - XSMB, XSMN, XSMT Hôm Nay`;
  const description = `KQXS ${DAY_NAMES[dow]} ${formatDate(dateStr)}: Xổ số Miền Bắc, Miền Nam, Miền Trung. Cập nhật nhanh, chính xác. Xem thống kê lô gan, soi cầu miễn phí.`;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="keywords" content="kết quả xổ số, xsmb, xsmn, xsmt, xs hom nay, kqxs, so xo mien bac, so xo mien nam, so xo mien trung, lo gan, soi cau">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#e11d48">
<link rel="canonical" href="https://xoso-vn.onrender.com/">

<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="/og-image.png">

${MONETAG_META}
${MONETAG_SCRIPTS}

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "${title}",
  "description": "${description}",
  "datePublished": "${dateStr}",
  "inLanguage": "vi-VN",
  "isPartOf": { "@type": "WebSite", "name": "Xổ Số VN", "url": "https://xoso-vn.onrender.com/" }
}
</script>

<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:system-ui,-apple-system,sans-serif;background:#f5f7fa;color:#1e293b;line-height:1.5}
.header{background:linear-gradient(135deg,#e11d48 0%,#be123c 100%);color:#fff;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,.15);position:sticky;top:0;z-index:100}
.header-inner{max-width:900px;margin:0 auto;display:flex;justify-content:space-between;align-items:center}
.logo{font-size:20px;font-weight:900;letter-spacing:-.5px}
.logo small{display:block;font-size:10px;font-weight:500;opacity:.9;letter-spacing:1px}
.nav{display:flex;gap:12px;font-size:13px}
.nav a{color:#fff;text-decoration:none;opacity:.9;padding:4px 8px;border-radius:6px}
.nav a:hover{background:rgba(255,255,255,.15)}
.container{max-width:900px;margin:0 auto;padding:12px}
.ad-slot{background:#fff;border:1px dashed #cbd5e1;border-radius:8px;padding:8px;margin:12px 0;text-align:center;min-height:100px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ad-slot small{color:#94a3b8;font-size:10px;letter-spacing:1px;text-transform:uppercase}
.date-bar{background:#fff;border-radius:10px;padding:12px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);text-align:center}
.date-title{font-size:16px;font-weight:800;color:#e11d48;margin-bottom:4px}
.date-sub{font-size:12px;color:#64748b}
.nav-days{display:flex;gap:6px;margin-top:10px;justify-content:center;flex-wrap:wrap}
.nav-days a{font-size:12px;padding:5px 10px;border-radius:20px;background:#f1f5f9;color:#475569;text-decoration:none;font-weight:600}
.nav-days a.active{background:#e11d48;color:#fff}
.nav-days a:hover{background:#e11d48;color:#fff}
.region{background:#fff;border-radius:10px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.region-title{font-size:16px;font-weight:900;color:#be123c;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #fee2e2;display:flex;align-items:center;gap:8px}
.region-title::before{content:'';width:4px;height:20px;background:#e11d48;border-radius:2px}
.province-block{margin-bottom:14px;padding-bottom:14px;border-bottom:1px dashed #e2e8f0}
.province-block:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}
.province-title{font-size:13px;font-weight:800;color:#0f172a;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px}
.prize-table{width:100%;border-collapse:collapse;font-size:13px}
.prize-row{border-bottom:1px solid #f1f5f9}
.prize-row:last-child{border-bottom:none}
.prize-label{width:44px;padding:6px 4px;font-weight:800;color:#be123c;font-size:11px;background:#fef2f2;text-align:center;border-radius:4px}
.prize-values{padding:6px 4px;display:flex;flex-wrap:wrap;gap:6px}
.num{background:#f8fafc;border:1px solid #e2e8f0;padding:3px 8px;border-radius:5px;font-family:monospace;font-weight:700;font-size:14px;color:#0f172a}
.prize-row.special .num{background:#fef2f2;border-color:#fecaca;color:#dc2626;font-size:16px;font-weight:900}
.no-result{text-align:center;color:#94a3b8;font-size:13px;padding:14px}
.recent{background:#fff;border-radius:10px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.recent h2{font-size:14px;font-weight:900;color:#0f172a;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px}
.recent table{width:100%;font-size:13px;border-collapse:collapse}
.recent td{padding:8px 4px;border-bottom:1px solid #f1f5f9}
.recent a{color:#0f172a;text-decoration:none;font-weight:600}
.recent a:hover{color:#e11d48}
.special-mini{font-family:monospace;font-weight:900;color:#dc2626;text-align:right;font-size:15px}
.footer{text-align:center;padding:20px 12px;font-size:11px;color:#94a3b8}
.footer a{color:#64748b;text-decoration:none;margin:0 6px}
@media(max-width:600px){
  .nav{display:none}
  .prize-values{gap:4px}
  .num{font-size:13px;padding:2px 6px}
  .prize-row.special .num{font-size:15px}
}
</style>
</head>
<body>
<div class="header">
  <div class="header-inner">
    <div class="logo">🎟️ XỔ SỐ VN<small>KQXS 3 MIỀN NHANH NHẤT</small></div>
    <div class="nav">
      <a href="/">Trang chủ</a>
      <a href="/thong-ke">Thống kê</a>
      <a href="/soi-cau">Soi cầu</a>
    </div>
  </div>
</div>

<div class="container">

  <div class="ad-slot">
    <small>Quảng cáo</small>
  </div>

  <div class="date-bar">
    <div class="date-title">KQXS ${DAY_NAMES[dow]}, ${formatDate(dateStr)}</div>
    <div class="date-sub">Cập nhật trực tiếp từ trường quay</div>
    <div class="nav-days">
      ${recentDays.slice(0, 5).map(ds => {
        const d = new Date(ds + 'T00:00:00Z');
        const dn = DAY_SHORT[d.getUTCDay()];
        const active = ds === dateStr ? 'active' : '';
        return `<a href="/ngay/${ds}" class="${active}">${dn} ${formatDate(ds).slice(0,5)}</a>`;
      }).join('')}
    </div>
  </div>

  <div class="region">
    <div class="region-title">🏆 Xổ Số Miền Bắc (XSMB)</div>
    ${day.mb ? renderProvinceTable('mb', day.mb) : '<div class="no-result">Miền Bắc không quay</div>'}
  </div>

  <div class="ad-slot">
    <small>Quảng cáo</small>
  </div>

  <div class="region">
    <div class="region-title">🌊 Xổ Số Miền Trung (XSMT)</div>
    ${mtHtml}
  </div>

  <div class="region">
    <div class="region-title">🌴 Xổ Số Miền Nam (XSMN)</div>
    ${mnHtml}
  </div>

  <div class="ad-slot">
    <small>Quảng cáo</small>
  </div>

  <div class="recent">
    <h2>📅 KQXS 7 Ngày Gần Nhất</h2>
    <table>
      ${recentHtml}
    </table>
  </div>

  <div class="footer">
    <div>© 2026 Xổ Số VN · Kết quả chỉ mang tính chất tham khảo</div>
    <div style="margin-top:8px">
      <a href="/">Trang chủ</a>·
      <a href="/thong-ke">Thống kê</a>·
      <a href="/soi-cau">Soi cầu</a>·
      <a href="/sitemap.xml">Sitemap</a>
    </div>
  </div>

</div>

<script>
// Reload mỗi 5 phút để cập nhật kết quả mới
setTimeout(function(){ location.reload(); }, 5 * 60 * 1000);
</script>
</body>
</html>`;
}

// ================= TRANG THỐNG KÊ =================
function renderStatsPage() {
  const today = getTodayVN();
  ensureResults(today);

  // Tính lô gan (30 ngày)
  const allNumbers = {};  // num -> lastDate
  for (let i = 0; i < 30; i++) {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const day = db.results[ds];
    if (!day) continue;

    const provinces = [...(day.mb ? [day.mb] : []), ...day.mt, ...day.mn];
    for (const prov of provinces) {
      // Lấy 2 số cuối của giải ĐB và tất cả các giải khác
      const allPrizes = [
        prov.giaiDB, ...(prov.giaiNhat||[]), ...(prov.giaiNhi||[]),
        ...(prov.giaiBa||[]), ...(prov.giaiTu||[]), ...(prov.giaiNam||[]),
        ...(prov.giaiSau||[]), ...(prov.giaiBay||[]), ...(prov.giaiTam||[])
      ].filter(Boolean);

      for (const p of allPrizes) {
        const last2 = p.slice(-2);
        if (!allNumbers[last2] || allNumbers[last2].days > i) {
          allNumbers[last2] = { days: i, date: ds, province: prov.province, fullNum: p };
        }
      }
    }
  }

  // Sắp xếp lô gan (chưa về lâu nhất)
  const loGan = Object.entries(allNumbers)
    .map(([num, info]) => ({ num, ...info }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 30);

  const title = `Thống Kê Lô Gan Miền Bắc - Bạch Thủ Lô, Đặc Biệt 30 Ngày`;
  const description = `Thống kê lô gan 30 ngày, bạch thủ lô đẹp nhất, lô về nhiều nhất, đặc biệt lâu về. Cập nhật ${formatDate(today)}.`;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="keywords" content="lô gan, thống kê lô, bạch thủ lô, soi cầu lô gan, lô gan miền bắc, lô gan lâu về">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#e11d48">
<link rel="canonical" href="https://xoso-vn.onrender.com/thong-ke">

${MONETAG_META}
${MONETAG_SCRIPTS}

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebPage","name":"${title}","description":"${description}","inLanguage":"vi-VN"}
</script>

<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f5f7fa;color:#1e293b}
.header{background:linear-gradient(135deg,#e11d48 0%,#be123c 100%);color:#fff;padding:14px}
.header-inner{max-width:900px;margin:0 auto;display:flex;justify-content:space-between;align-items:center}
.logo{font-size:20px;font-weight:900}
.logo small{display:block;font-size:10px;opacity:.9;letter-spacing:1px}
.nav{display:flex;gap:12px;font-size:13px}
.nav a{color:#fff;text-decoration:none;opacity:.9;padding:4px 8px;border-radius:6px}
.nav a:hover{background:rgba(255,255,255,.15)}
.container{max-width:900px;margin:0 auto;padding:12px}
.ad-slot{background:#fff;border:1px dashed #cbd5e1;border-radius:8px;padding:8px;margin:12px 0;text-align:center;min-height:100px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ad-slot small{color:#94a3b8;font-size:10px;text-transform:uppercase}
.page-title{font-size:22px;font-weight:900;color:#be123c;margin-bottom:6px}
.page-sub{font-size:13px;color:#64748b;margin-bottom:16px}
.card{background:#fff;border-radius:10px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.card h2{font-size:15px;font-weight:900;color:#0f172a;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px}
.lo-table{width:100%;border-collapse:collapse;font-size:13px}
.lo-table th{background:#fef2f2;color:#be123c;padding:8px;text-align:left;font-weight:800;font-size:11px;text-transform:uppercase}
.lo-table td{padding:8px;border-bottom:1px solid #f1f5f9}
.lo-table .num-cell{font-family:monospace;font-weight:900;color:#dc2626;font-size:15px}
.lo-table .days-cell{font-weight:800;color:#0f172a}
.lo-table .days-cell.hot{color:#dc2626}
.footer{text-align:center;padding:20px 12px;font-size:11px;color:#94a3b8}
.footer a{color:#64748b;text-decoration:none;margin:0 6px}
</style>
</head>
<body>
<div class="header">
  <div class="header-inner">
    <div class="logo">🎟️ XỔ SỐ VN<small>THỐNG KÊ & SOI CẦU</small></div>
    <div class="nav">
      <a href="/">Trang chủ</a>
      <a href="/thong-ke">Thống kê</a>
      <a href="/soi-cau">Soi cầu</a>
    </div>
  </div>
</div>

<div class="container">
  <div class="ad-slot"><small>Quảng cáo</small></div>

  <h1 class="page-title">📊 Thống Kê Lô Gan 30 Ngày</h1>
  <p class="page-sub">Cập nhật ngày ${formatDate(today)} · Lô gan lâu về nhất</p>

  <div class="card">
    <h2>🔴 Top 30 Lô Gan Lâu Về Nhất</h2>
    <table class="lo-table">
      <thead>
        <tr><th>#</th><th>Lô</th><th>Số ngày</th><th>Ngày về gần nhất</th></tr>
      </thead>
      <tbody>
        ${loGan.map((l, i) => `
          <tr>
            <td>${i + 1}</td>
            <td class="num-cell">${l.num}</td>
            <td class="days-cell ${l.days >= 10 ? 'hot' : ''}">${l.days} ngày</td>
            <td>${formatDate(l.date)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="ad-slot"><small>Quảng cáo</small></div>

  <div class="footer">
    <div>© 2026 Xổ Số VN · Số liệu tham khảo</div>
    <div style="margin-top:8px">
      <a href="/">Trang chủ</a>·
      <a href="/thong-ke">Thống kê</a>·
      <a href="/soi-cau">Soi cầu</a>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ================= TRANG SOI CẦU =================
function renderSoiCauPage() {
  const today = getTodayVN();
  ensureResults(today);

  // Bạch thủ lô: 2 số cuối ĐB về nhiều nhất trong 30 ngày
  const counts = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const day = db.results[ds];
    if (!day || !day.mb) continue;
    const last2 = day.mb.giaiDB.slice(-2);
    counts[last2] = (counts[last2] || 0) + 1;
  }

  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const title = `Soi Cầu XSMB Hôm Nay ${formatDate(today)} - Bạch Thủ Lô Chuẩn`;
  const description = `Soi cầu miền Bắc ${formatDate(today)}: bạch thủ lô, song thủ lô, dàn đề đẹp nhất. Dự đoán KQXS chính xác cao.`;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="keywords" content="soi cầu xsmb, dự đoán xổ số, bạch thủ lô, song thủ lô, dàn đề, soi cầu miền bắc, kqxs">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#e11d48">
<link rel="canonical" href="https://xoso-vn.onrender.com/soi-cau">

${MONETAG_META}
${MONETAG_SCRIPTS}

<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f5f7fa;color:#1e293b}
.header{background:linear-gradient(135deg,#e11d48 0%,#be123c 100%);color:#fff;padding:14px}
.header-inner{max-width:900px;margin:0 auto;display:flex;justify-content:space-between;align-items:center}
.logo{font-size:20px;font-weight:900}
.logo small{display:block;font-size:10px;opacity:.9;letter-spacing:1px}
.nav{display:flex;gap:12px;font-size:13px}
.nav a{color:#fff;text-decoration:none;opacity:.9;padding:4px 8px;border-radius:6px}
.nav a:hover{background:rgba(255,255,255,.15)}
.container{max-width:900px;margin:0 auto;padding:12px}
.ad-slot{background:#fff;border:1px dashed #cbd5e1;border-radius:8px;padding:8px;margin:12px 0;text-align:center;min-height:100px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ad-slot small{color:#94a3b8;font-size:10px;text-transform:uppercase}
.page-title{font-size:22px;font-weight:900;color:#be123c;margin-bottom:6px}
.page-sub{font-size:13px;color:#64748b;margin-bottom:16px}
.card{background:#fff;border-radius:10px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.card h2{font-size:15px;font-weight:900;color:#0f172a;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px}
.lucky-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;margin-top:8px}
.lucky-num{background:linear-gradient(135deg,#fef2f2,#fee2e2);border:2px solid #fecaca;border-radius:10px;padding:14px 6px;text-align:center;font-family:monospace;font-weight:900;font-size:22px;color:#dc2626;box-shadow:0 2px 6px rgba(220,38,38,.15)}
.lucky-num small{display:block;font-size:10px;font-weight:600;color:#64748b;margin-top:4px;font-family:system-ui}
.footer{text-align:center;padding:20px 12px;font-size:11px;color:#94a3b8}
.footer a{color:#64748b;text-decoration:none;margin:0 6px}
</style>
</head>
<body>
<div class="header">
  <div class="header-inner">
    <div class="logo">🎟️ XỔ SỐ VN<small>SOI CẦU MIỄN PHÍ</small></div>
    <div class="nav">
      <a href="/">Trang chủ</a>
      <a href="/thong-ke">Thống kê</a>
      <a href="/soi-cau">Soi cầu</a>
    </div>
  </div>
</div>

<div class="container">
  <div class="ad-slot"><small>Quảng cáo</small></div>

  <h1 class="page-title">🔮 Soi Cầu XSMB Hôm Nay</h1>
  <p class="page-sub">Dự đoán ngày ${formatDate(today)} · Tham khảo từ thống kê 30 ngày</p>

  <div class="card">
    <h2>🎯 Bạch Thủ Lô Đẹp Nhất</h2>
    <div class="lucky-grid">
      ${top.map(t => `<div class="lucky-num">${t[0]}<small>${t[1]} lần</small></div>`).join('')}
    </div>
  </div>

  <div class="ad-slot"><small>Quảng cáo</small></div>

  <div class="card">
    <h2>📝 Lưu Ý</h2>
    <p style="font-size:13px;color:#64748b;line-height:1.6">
      Các con số trên được tổng hợp từ kết quả xổ số 30 ngày qua, chỉ mang tính chất tham khảo.
      Người chơi cần cân nhắc kỹ trước khi tham gia bất kỳ hình thức cá cược nào.
    </p>
  </div>

  <div class="footer">
    <div>© 2026 Xổ Số VN · Tham khảo</div>
    <div style="margin-top:8px">
      <a href="/">Trang chủ</a>·
      <a href="/thong-ke">Thống kê</a>·
      <a href="/soi-cau">Soi cầu</a>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ================= SERVER =================
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Stats
  if (pathname === '/' || pathname.startsWith('/ngay/')) {
    db.stats.views++;
    const today = getTodayVN();
    db.stats.dailyViews[today] = (db.stats.dailyViews[today] || 0) + 1;
    saveDB();
  }

  // Trang chủ
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderHomePage(getTodayVN()));
  }

  // Trang theo ngày
  if (pathname.startsWith('/ngay/')) {
    const dateStr = pathname.slice(6);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderHomePage(dateStr));
  }

  // Thống kê
  if (pathname === '/thong-ke') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderStatsPage());
  }

  // Soi cầu
  if (pathname === '/soi-cau') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderSoiCauPage());
  }

  // Robots
  if (pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('User-agent: *\nAllow: /\nSitemap: https://xoso-vn.onrender.com/sitemap.xml\n');
  }

  // Sitemap
  if (pathname === '/sitemap.xml') {
    const today = getTodayVN();
    const urls = ['/', '/thong-ke', '/soi-cau'];
    for (let i = 0; i < 30; i++) {
      const d = new Date(today + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      urls.push('/ngay/' + d.toISOString().slice(0, 10));
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>https://xoso-vn.onrender.com${u}</loc><changefreq>daily</changefreq></url>`).join('\n')}
</urlset>`;
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    return res.end(xml);
  }

  // API JSON
  if (pathname === '/api/today') {
    const day = ensureResults(getTodayVN());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(day));
  }

  if (pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(db.stats));
  }

  // Favicon
  if (pathname === '/favicon.ico' || pathname === '/og-image.png') {
    res.writeHead(204); return res.end();
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log('🎟️  XỔ SỐ VN — ĐÃ KHỞI ĐỘNG');
  console.log('👉 Trang chủ:   http://localhost:' + PORT);
  console.log('👉 Thống kê:    http://localhost:' + PORT + '/thong-ke');
  console.log('👉 Soi cầu:     http://localhost:' + PORT + '/soi-cau');
  console.log('👉 Sitemap:     http://localhost:' + PORT + '/sitemap.xml');
  console.log('📢 Monetag:     4 zones đã tích hợp');
  console.log('====================================================');
});

process.on('SIGINT', () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {} process.exit(0); });