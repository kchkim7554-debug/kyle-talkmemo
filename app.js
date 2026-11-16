"use strict";
/* =========================================================================
   카일 · 스마트 톡메모 (kyle-talkmemo)
   - 카톡/톡메모 스타일 대화형 메모 · 할 일 · 별표 · 검색 · 카테고리 16개
   - Firebase Realtime Database 동기화 + localStorage 폴백
   - PIN 잠금 (SHA-256, 기본 7554)
   ========================================================================= */

/* ------------------------- 설정값 ------------------------- */
var FIREBASE_CONFIG = {
  apiKey: "AIzaSyDl9QEY_NSwR4CB4ln71m9vfbF9pbbN7uI",
  authDomain: "grandfirst-board.firebaseapp.com",
  databaseURL: "https://grandfirst-board-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "grandfirst-board",
  storageBucket: "grandfirst-board.firebasestorage.app",
  messagingSenderId: "411291957122",
  appId: "1:411291957122:web:7d1f75d58719c447aa019b"
};
var SALT = "kyle-talkmemo|";
var DEFAULT_PIN_HASH = "9b3916ed1c61f1fda951c1cb8f593802eaf598b667493d8a6cd09e5ea8b92b72"; /* 7554 */
var APP_VER = "1.0.0";

var SYNC_PATHS = [
  { key: "dedicated", label: "전용 경로 (권장)", path: "talkmemo_v1_9852",
    note: "카일·스마트 전용으로 비워 둔 경로입니다. Firebase 규칙에 이 경로를 열어 주면 바로 동기화됩니다." },
  { key: "board", label: "게시판 DB 경로", path: "board/talkmemo_v1_9852",
    note: "기존 게시판 앱과 같은 규칙(공개 읽기·쓰기)을 쓰는 경로입니다. 지금 바로 스마트와 공유되지만, 주소를 아는 사람이 읽을 수 있습니다." },
  { key: "local", label: "이 기기에만 저장", path: "",
    note: "동기화하지 않고 이 기기(브라우저)에만 저장합니다." }
];

var CATS = [
  { k: "general",  label: "일반 메모",            emoji: "🗒️" },
  { k: "openai",   label: "Open AI 계정 도용",     emoji: "🔒" },
  { k: "dosirak",  label: "도시락·정산",           emoji: "🍱" },
  { k: "govself",  label: "카일 정부지원",         emoji: "🪪" },
  { k: "govfam",   label: "가족 정부지원",         emoji: "🏛️" },
  { k: "medical",  label: "의료일정",              emoji: "🏥" },
  { k: "tax",      label: "연말정산",              emoji: "🧾" },
  { k: "ai",       label: "AI 인수인계",           emoji: "🤖" },
  { k: "housing",  label: "주택 관련",             emoji: "🏠" },
  { k: "car",      label: "자동차 (45더1097)",     emoji: "🚗" },
  { k: "work",     label: "근무일정",              emoji: "🗓️" },
  { k: "buy",      label: "구매물품",              emoji: "🛒" },
  { k: "yeoncheon",label: "연천 관련",             emoji: "🌾" },
  { k: "family",   label: "가족 통화",             emoji: "📞" },
  { k: "board",    label: "게시판 프로그램",       emoji: "📋" },
  { k: "rent",     label: "쇠재마을 월세",         emoji: "🏢" },
  { k: "land",     label: "임야(217-5) 매매",      emoji: "🏞️" }
];

var LS = {
  memos: "ktm.memos", deleted: "ktm.deleted", dirty: "ktm.dirty",
  auth: "ktm.auth", pin: "ktm.pinHash", ui: "ktm.ui", pref: "ktm.syncPref",
  seeded: "ktm.seeded", fontLg: "ktm.fontLg"
};

/* ------------------------- 상태 ------------------------- */
var S = {
  memos: {},          /* id -> memo */
  deleted: {},        /* id -> ts (삭제 표식, 여러 기기 충돌 방지) */
  dirty: {},          /* id -> 'set' | 'del' */
  pref: "dedicated",  /* 동기화 경로 선택 */
  pinHash: DEFAULT_PIN_HASH,
  cat: "all",
  onlyOpen: false,
  onlyStar: false,
  order: "asc",
  q: "",
  draftCat: "general",
  draftTodo: false,
  draftStar: false,
  fontLg: false,
  sync: { mode: "local", reason: "init", path: "", at: 0 },
  seenRemote: false,
  authed: false,
  sheet: null
};

var db = null;
var dbPath = "";
var pinBuf = "";
var recent = {};   /* id -> ts : 방금 이 기기에서 쓴 메모 (엇갈린 스냅샷에 지워지지 않도록) */

/* ------------------------- 유틸 ------------------------- */
function $(s, r) { return (r || document).querySelector(s); }
function pad2(v) { return String(v).padStart(2, "0"); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
  });
}
function linkify(html) {
  return html.replace(/(https?:\/\/[^\s<]+)/g, function (u) {
    return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + "</a>";
  });
}
function uid() {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function catOf(k) {
  for (var i = 0; i < CATS.length; i++) if (CATS[i].k === k) return CATS[i];
  return CATS[0];
}
function fmtTime(ts) {
  if (!ts) return "";
  var d = new Date(ts), h = d.getHours(), ap = h < 12 ? "오전" : "오후";
  h = h % 12; if (h === 0) h = 12;
  return ap + " " + h + ":" + pad2(d.getMinutes());
}
function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
var WD = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
function fmtDay(ts) {
  var d = new Date(ts);
  var today = dayKey(Date.now());
  if (dayKey(ts) === today) return "오늘 · " + (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + WD[d.getDay()];
  return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + WD[d.getDay()];
}
function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function drop(k) { try { localStorage.removeItem(k); } catch (e) {} }

var toastTimer = null;
function toast(msg) {
  var t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
}

/* ------------------------- SHA-256 ------------------------- */
function sha256Sync(ascii) {
  function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
  var mp = Math.pow, maxWord = mp(2, 32), result = "", words = [], bitLen = ascii.length * 8;
  var hash = sha256Sync.h = sha256Sync.h || [], k = sha256Sync.k = sha256Sync.k || [], cnt = k.length;
  var composite = {};
  for (var cand = 2; cnt < 64; cand++) {
    if (!composite[cand]) {
      for (var i = 0; i < 313; i += cand) composite[i] = cand;
      hash[cnt] = (mp(cand, 0.5) * maxWord) | 0;
      k[cnt++] = (mp(cand, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += "\x80";
  while (ascii.length % 64 - 56) ascii += "\x00";
  for (i = 0; i < ascii.length; i++) {
    var code = ascii.charCodeAt(i);
    if (code >> 8) return "";
    words[i >> 2] |= code << (((3 - i) % 4) * 8);
  }
  words[words.length] = (bitLen / maxWord) | 0;
  words[words.length] = bitLen;
  for (var j = 0; j < words.length;) {
    var w = words.slice(j, j += 16), old = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2];
      var a = hash[0], e = hash[4];
      var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i]
        + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
      var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(t1 + t2) | 0].concat(hash);
      hash[4] = (hash[4] + t1) | 0;
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : "") + b.toString(16);
    }
  }
  return result;
}
function hashPin(pin) {
  var raw = SALT + pin;
  if (window.crypto && crypto.subtle && crypto.subtle.digest) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    }).catch(function () { return sha256Sync(raw); });
  }
  return Promise.resolve(sha256Sync(raw));
}

/* ------------------------- 저장/로드 ------------------------- */
function persist() {
  try {
    store(LS.memos, JSON.stringify(S.memos));
    store(LS.deleted, JSON.stringify(S.deleted));
    store(LS.dirty, JSON.stringify(S.dirty));
  } catch (e) {}
}
function loadLocal() {
  try {
    S.memos = JSON.parse(load(LS.memos) || "{}") || {};
    S.deleted = JSON.parse(load(LS.deleted) || "{}") || {};
    S.dirty = JSON.parse(load(LS.dirty) || "{}") || {};
  } catch (e) { S.memos = {}; S.deleted = {}; S.dirty = {}; }
  Object.keys(S.memos).forEach(function (id) { if (S.memos[id] && !S.memos[id].id) S.memos[id].id = id; });
  S.pinHash = load(LS.pin) || DEFAULT_PIN_HASH;
  S.pref = load(LS.pref) || "dedicated";
  S.fontLg = load(LS.fontLg) === "1";
  try {
    var ui = JSON.parse(load(LS.ui) || "{}") || {};
    if (ui.draftCat && catOf(ui.draftCat).k === ui.draftCat) S.draftCat = ui.draftCat;
    if (ui.order === "desc") S.order = "desc";
    if (ui.cat) S.cat = ui.cat;
  } catch (e) {}
  document.documentElement.classList.toggle("fs-lg", S.fontLg);
}
function saveUi() {
  store(LS.ui, JSON.stringify({ draftCat: S.draftCat, order: S.order, cat: S.cat }));
}

/* ------------------------- 잠금 / 인증 ------------------------- */
function sessionValid() {
  try {
    var a = JSON.parse(load(LS.auth) || "{}");
    return a && a.until && a.until > Date.now();
  } catch (e) { return false; }
}
function saveSession() {
  store(LS.auth, JSON.stringify({ until: Date.now() + 30 * 24 * 3600 * 1000 }));
}
function showLock(msg) {
  S.authed = false;
  $("#lock").hidden = false;
  $("#shell").setAttribute("hidden", "");
  $("#lockMsg").textContent = msg || "";
  pinBuf = "";
  drawDots();
  $("#lockSub").textContent = "PIN 4자리를 입력하세요";
}
function showApp() {
  S.authed = true;
  $("#lock").setAttribute("hidden", "");
  $("#shell").hidden = false;
  render();
  setTimeout(function () {
    if (S.order === "asc") { var l = $("#list"); l.scrollTop = l.scrollHeight; }
  }, 40);
}
function drawDots(bad) {
  var dots = $("#pinDots").children;
  for (var i = 0; i < dots.length; i++) dots[i].className = i < pinBuf.length ? "on" : "";
  if (bad) {
    var box = $("#pinDots");
    box.classList.add("shake");
    setTimeout(function () { box.classList.remove("shake"); }, 340);
  }
}
function pinKey(k) {
  if (k === "del") pinBuf = pinBuf.slice(0, -1);
  else if (k === "ok") { pinSubmit(); return; }
  else if (pinBuf.length < 4) pinBuf += k;
  $("#lockMsg").textContent = "";
  drawDots(false);
  if (pinBuf.length === 4) setTimeout(pinSubmit, 110);
}
function pinSubmit() {
  if (pinBuf.length !== 4) { $("#lockMsg").textContent = "PIN 4자리를 입력하세요"; return; }
  var entered = pinBuf;
  hashPin(entered).then(function (h) {
    if (h && h === S.pinHash) {
      saveSession();
      pinBuf = "";
      showApp();
      toast("환영합니다, 카일 님");
      return;
    }
    pinBuf = "";
    drawDots(true);
    $("#lockMsg").textContent = "PIN이 맞지 않습니다. 다시 입력해 주세요.";
  });
}

/* ------------------------- 카테고리 칩/필터 ------------------------- */
function renderChips() {
  var counts = {};
  Object.keys(S.memos).forEach(function (id) {
    var m = S.memos[id];
    counts[m.cat] = (counts[m.cat] || 0) + 1;
  });
  var total = Object.keys(S.memos).length;
  var html = '<button class="chip' + (S.cat === "all" ? " on" : "") + '" data-cat="all">전체<span class="n">' + total + "</span></button>";
  CATS.forEach(function (c) {
    var n = counts[c.k] || 0;
    html += '<button class="chip' + (S.cat === c.k ? " on" : "") + '" data-cat="' + c.k + '">' +
      c.emoji + " " + esc(c.label) + (n ? '<span class="n">' + n + "</span>" : "") + "</button>";
  });
  $("#catChips").innerHTML = html;
  var cc = catOf(S.draftCat);
  $("#btnCatPick").textContent = cc.emoji + " " + cc.label + " ▾";
  $("#flagTodo").classList.toggle("on", S.draftTodo);
  $("#flagStar").classList.toggle("on", S.draftStar);
  $("#tgOpen").classList.toggle("on", S.onlyOpen);
  $("#tgStar").classList.toggle("on", S.onlyStar);
  $("#tgOrder").textContent = S.order === "asc" ? "↕ 최신 아래" : "↕ 최신 위";
  $("#tgOpen").textContent = (S.onlyOpen ? "☑" : "☐") + " 미완료만";
  $("#tgStar").textContent = (S.onlyStar ? "★" : "☆") + " 중요만";
}

function visible() {
  var arr = [];
  Object.keys(S.memos).forEach(function (id) {
    var m = S.memos[id];
    if (!m || !m.text) return;
    if (S.cat !== "all" && m.cat !== S.cat) return;
    if (S.onlyOpen && (m.status || "대기") === "완료") return;
    if (S.onlyStar && !m.star) return;
    if (S.q) {
      var q = S.q.toLowerCase();
      var hay = ((m.text || "") + " " + (m.smartReply || "") + " " + catOf(m.cat).label).toLowerCase();
      if (hay.indexOf(q) < 0) return;
    }
    arr.push(m);
  });
  arr.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
  if (S.order === "desc") arr.reverse();
  return arr;
}

/* ------------------------- 렌더 ------------------------- */
function statusPill(st) {
  var cls = st === "완료" ? "st-done" : (st === "처리중" ? "st-doing" : "st-wait");
  return '<span class="chip-status ' + cls + '">' + esc(st) + "</span>";
}

function memoHTML(m) {
  var c = catOf(m.cat);
  var isMe = (m.author || "kyle") === "kyle";
  var st = m.status || "대기";
  var id = esc(m.id);
  var edited = m.edited ? '<span title="수정됨">· 수정</span>' : "";
  var h = '<div class="msg ' + (isMe ? "me" : "smart") + (st === "완료" ? " todo-done" : "") + '" data-id="' + id + '">';
  if (!isMe) h += '<div class="av">🤖</div>';
  h += '<div class="col">';
  h += '<div class="meta">' +
        (isMe ? "" : '<span class="who">스마트</span>') +
        '<span class="cat-badge">' + c.emoji + " " + esc(c.label) + "</span>" +
        '<span class="time">' + fmtTime(m.createdAt) + "</span>" + edited +
      "</div>";
  h += '<div class="bubble"><div class="txt">' + linkify(esc(m.text)) + "</div>";
  if (m.todo || st !== "대기") {
    h += '<div class="status-line">' + statusPill(st) + (m.todo ? "<span>할 일</span>" : "") + "</div>";
  }
  h += "</div>";

  if (m.smartReply) {
    h += '<div class="reply"><b>🤖 스마트 답글 · ' + fmtTime(m.smartReplyAt) + "</b>" + linkify(esc(m.smartReply)) + "</div>";
  }

  h += '<div class="acts">';
  if (isMe) {
    h += '<button class="act' + (st === "완료" ? " done" : "") + '" data-act="toggle-done" data-id="' + id + '">' +
         (st === "완료" ? "☑ 완료" : "○ 완료하기") + "</button>";
    if (st === "대기") h += '<button class="act" data-act="cycle-status" data-id="' + id + '">▶ 처리중</button>';
  }
  h += '<button class="act' + (m.star ? " on" : "") + '" data-act="toggle-star" data-id="' + id + '" title="중요 표시">' + (m.star ? "★" : "☆") + "</button>";
  if (isMe) h += '<button class="act" data-act="more" data-id="' + id + '" title="더보기">⋯</button>';
  h += "</div>";
  h += "</div></div>";
  return h;
}

function renderList() {
  var arr = visible();
  var list = $("#list");
  if (!arr.length) {
    list.innerHTML = '<div class="empty"><span class="big">💬</span>' +
      (S.q ? "검색 결과가 없습니다.<br>다른 낱말로 찾아보세요."
           : (S.cat !== "all" || S.onlyOpen || S.onlyStar
              ? "이 조건에 맞는 메모가 없습니다.<br>필터를 풀어 보세요."
              : "아직 메모가 없습니다.<br>아래 입력창에 첫 메모를 남겨 보세요.")) + "</div>";
  } else {
    var html = "", lastDay = "";
    arr.forEach(function (m) {
      var dk = dayKey(m.createdAt || Date.now());
      if (dk !== lastDay) {
        html += '<div class="daysep"><span>' + fmtDay(m.createdAt || Date.now()) + "</span></div>";
        lastDay = dk;
      }
      html += memoHTML(m);
    });
    list.innerHTML = html;
  }
  var open = 0, total = 0;
  Object.keys(S.memos).forEach(function (id) {
    var m = S.memos[id]; if (!m || !m.text) return;
    total++;
    if ((m.status || "대기") !== "완료") open++;
  });
  $("#count").textContent = "메모 " + total + " · 미완료 " + open;
  if (S.order === "asc" && !S.q) list.scrollTop = list.scrollHeight;
}

function renderSync() {
  var dot = $("#syncDot"), txt = $("#syncState");
  var banner = $("#bannerHost");
  banner.innerHTML = "";
  if (S.sync.mode === "live") {
    dot.className = "dot live";
    var p = SYNC_PATHS.filter(function (x) { return x.path === S.sync.path; })[0];
    txt.textContent = "스마트와 실시간 공유 중 · " + (p ? p.label : S.sync.path);
    return;
  }
  dot.className = "dot " + (S.sync.reason === "denied" ? "err" : "local");
  if (S.pref === "local") txt.textContent = "이 기기에만 저장 (동기화 꺼짐)";
  else if (S.sync.reason === "denied") txt.textContent = "이 기기에만 저장 · 전용 경로 미개방";
  else if (S.sync.reason === "offline") txt.textContent = "오프라인 · 이 기기에 저장 중";
  else if (S.sync.reason === "init") txt.textContent = "연결 확인 중…";
  else txt.textContent = "이 기기에만 저장";

  if (S.pref === "local") return;
  var h = "";
  if (S.sync.reason === "denied") {
    h = '<div class="banner"><div class="bt"><b>동기화 준비</b>' +
        '<span>전용 경로가 아직 열리지 않았습니다.</span></div>' +
        '<button data-act="use-board-path">지금 공유하기</button></div>';
  } else if (S.sync.reason === "offline") {
    h = '<div class="banner"><div class="bt"><b>오프라인</b>' +
        '<span>이 기기에 저장 중입니다. 연결되면 자동으로 올립니다.</span></div>' +
        '<button data-act="retry-sync">다시 연결</button></div>';
  }
  banner.innerHTML = h;
}

function render() {
  renderChips();
  renderList();
  renderSync();
}

/* ------------------------- Firebase 동기화 ------------------------- */
function syncAvailable() { return typeof firebase !== "undefined" && firebase && firebase.database; }
function currentPath() {
  var p = SYNC_PATHS.filter(function (x) { return x.key === S.pref; })[0];
  return p ? p.path : "";
}
function setSync(mode, reason) {
  S.sync.mode = mode;
  S.sync.reason = reason;
  S.sync.at = Date.now();
  renderSync();
}

function startSync() {
  dbPath = currentPath();
  if (S.pref === "local" || !dbPath) { setSync("local", "local-off"); return; }
  if (!syncAvailable()) { setSync("local", "offline"); return; }
  try {
    if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
  } catch (e) {
    setSync("local", "offline");
    return;
  }
  db.ref(dbPath + "/memos").once("value").then(function () {
    attachListener(dbPath);
  }).catch(function (err) {
    var msg = (err && (err.message || err.code)) || "";
    var reason = /permission|denied|401/i.test(msg) ? "denied" : "offline";
    setSync("local", reason);
    setTimeout(retryOnce, 8000);
  });
}

var retryTimer = null;
function retryOnce() {
  if (S.sync.mode === "live") return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(function () {
    if (S.sync.reason !== "offline") return;
    if (!syncAvailable()) return;
    try {
      db.ref(dbPath + "/memos").once("value").then(function () { attachListener(dbPath); }).catch(function () {});
    } catch (e) {}
  }, 2500);
}

function attachListener(path) {
  db.ref(path).off();
  db.ref(path).on("value", function (snap) {
    var val = snap.val() || {};
    var cfg = val.config || {};
    if (cfg.pinHash && cfg.pinHash !== S.pinHash) {
      S.pinHash = cfg.pinHash;
      store(LS.pin, S.pinHash);
    } else if (!cfg.pinHash) {
      db.ref(path + "/config").update({ pinHash: S.pinHash, updatedAt: Date.now() }).catch(function () {});
    }
    applyRemote(val.memos || {}, val.deleted || {});
    if (S.sync.mode !== "live") {
      S.sync.mode = "live";
      S.sync.path = path;
      S.sync.reason = "ok";
      S.sync.at = Date.now();
      renderSync();
      toast("스마트와 실시간 공유를 시작했습니다");
    }
  }, function (err) {
    var msg = (err && (err.message || err.code)) || "";
    setSync("local", /permission|denied/i.test(msg) ? "denied" : "offline");
  });
  flushDirty();
}

function applyRemote(remote, deleted) {
  var prev = S.memos || {};
  Object.keys(deleted || {}).forEach(function (id) {
    S.deleted[id] = deleted[id] || Date.now();
  });
  var next = {};
  if (!S.seenRemote) {
    S.seenRemote = true;
    /* 첫 스냅샷: 이 기기에만 있던 메모는 위로 올린다 (삭제 표식이 없는 것만) */
    Object.keys(prev).forEach(function (id) {
      if (!remote[id] && !deleted[id]) S.dirty[id] = "set";
    });
  }
  Object.keys(remote).forEach(function (id) {
    var m = remote[id];
    if (!m || typeof m !== "object") return;
    if (S.deleted[id]) return;
    m.id = m.id || id;
    next[id] = m;
  });
  Object.keys(S.dirty).forEach(function (id) {
    if (S.dirty[id] === "del") { delete next[id]; return; }
    var p = prev[id];
    if (!p) return;
    if (!next[id] || (p.updatedAt || 0) >= (next[id].updatedAt || 0)) next[id] = p;
  });
  var now = Date.now();
  Object.keys(recent).forEach(function (id) {
    if (now - recent[id] > 8000) { delete recent[id]; return; }
    var p = prev[id];
    if (!p || S.deleted[id]) return;
    if (!next[id] || (p.updatedAt || 0) > (next[id].updatedAt || 0)) next[id] = p;
  });
  S.memos = next;
  if (Object.keys(next).length && load(LS.seeded) !== "1") store(LS.seeded, "1");
  persist();
  render();
  flushDirty();
}

function fbWrite(suffix, value) {
  if (S.sync.mode !== "live" || !db) return Promise.reject(new Error("offline"));
  if (value === null) return db.ref(dbPath + "/" + suffix).remove();
  return db.ref(dbPath + "/" + suffix).set(value);
}

var flushing = false;
function flushDirty() {
  if (S.sync.mode !== "live" || flushing) return;
  var ids = Object.keys(S.dirty);
  if (!ids.length) return;
  flushing = true;
  var pending = ids.length;
  function done() { if (--pending <= 0) flushing = false; }
  ids.forEach(function (id) {
    var kind = S.dirty[id];
    if (kind === "del") {
      var ts = S.deleted[id] || Date.now();
      Promise.all([
        db.ref(dbPath + "/memos/" + id).remove(),
        db.ref(dbPath + "/deleted/" + id).set(ts)
      ]).then(function () {
        if (S.dirty[id] === "del") delete S.dirty[id];
        persist();
      }).catch(function () {}).then(done);
    } else if (S.memos[id]) {
      recent[id] = Date.now();
      db.ref(dbPath + "/memos/" + id).set(S.memos[id]).then(function () {
        if (S.dirty[id] === "set") delete S.dirty[id];
        persist();
      }).catch(function () {}).then(done);
    } else {
      delete S.dirty[id];
      done();
    }
  });
  persist();
}

function saveMemo(m) {
  S.memos[m.id] = m;
  S.dirty[m.id] = "set";
  recent[m.id] = Date.now();
  persist();
  render();
  if (S.sync.mode === "live") {
    fbWrite("memos/" + m.id, m).then(function () {
      if (S.dirty[m.id] === "set") delete S.dirty[m.id];
      persist();
    }).catch(function () {
      S.dirty[m.id] = "set"; persist();
      toast("이 기기에 저장했습니다 (연결되면 자동 전송)");
    });
  }
}

function deleteMemo(id) {
  var m = S.memos[id];
  if (!m) return;
  delete S.memos[id];
  S.deleted[id] = Date.now();
  S.dirty[id] = "del";
  recent[id] = Date.now();
  persist();
  render();
  if (S.sync.mode === "live") {
    Promise.all([
      fbWrite("memos/" + id, null),
      fbWrite("deleted/" + id, S.deleted[id])
    ]).then(function () { delete S.dirty[id]; persist(); })
      .catch(function () { toast("삭제는 이 기기에 반영됐습니다 (연결되면 동기화)"); });
  }
  toast("메모를 삭제했습니다");
}

/* ------------------------- 첫 안내 메모 ------------------------- */
function seedIfEmpty() {
  if (load(LS.seeded) === "1") return;
  var n = Object.keys(S.memos).length;
  if (n > 0) { store(LS.seeded, "1"); return; }
  var now = Date.now();
  var seeds = [
    { id: "welcome-v1-1", text: "여기가 카일 님과 제가 메모를 주고받는 공간입니다.\n아래 칩에서 주제를 고르고 남겨 주세요. 제가 확인하고 이 자리에 답글을 답니다.", createdAt: now - 180000 },
    { id: "welcome-v1-2", text: "왼쪽 ○를 누르면 '완료', ★를 누르면 중요한 메모만 모아 볼 수 있습니다.\n'☑ 할 일'을 켜고 보내면 할 일로 등록됩니다.", createdAt: now - 120000 },
    { id: "welcome-v1-3", text: "오른쪽 ⚙️에서 PIN 변경, 글자 크기, 동기화 경로를 바꿀 수 있습니다.\n폰 홈 화면에 추가하면 앱처럼 열립니다.", createdAt: now - 60000 }
  ];
  seeds.forEach(function (s) {
    var m = {
      id: s.id, text: s.text, cat: "general", author: "smart",
      createdAt: s.createdAt, updatedAt: s.createdAt, status: "대기",
      todo: false, star: false, smartReply: "", smartReplyAt: 0
    };
    S.memos[m.id] = m;
    S.dirty[m.id] = "set";
    recent[m.id] = Date.now();
  });
  store(LS.seeded, "1");
  persist();
  render();
  flushDirty();
}

/* ------------------------- 시트 ------------------------- */
function openSheet(html, onOpen) {
  var w = $("#sheetwrap");
  $("#sheet").innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
      '<div style="flex:1 1 auto;min-width:0"></div>' +
      '<button class="btn sm ghost" data-act="close-sheet">닫기</button>' +
    "</div>" + html;
  w.hidden = false;
  if (onOpen) onOpen();
}
function closeSheet() { $("#sheetwrap").hidden = true; $("#sheet").innerHTML = ""; }

function sheetCategory() {
  var html = '<h2>주제 고르기</h2><p class="sh-sub">노션 정리판 16개 주제 + 일반 메모</p><div class="catgrid">';
  CATS.forEach(function (c) {
    html += '<button data-act="pick-cat" data-cat="' + c.k + '" class="' + (S.draftCat === c.k ? "on" : "") + '">' +
      "<span>" + c.emoji + " " + esc(c.label) + "</span></button>";
  });
  html += "</div>";
  openSheet(html);
}

function sheetMore(id) {
  var m = S.memos[id];
  if (!m) return;
  var st = m.status || "대기";
  var tt = String(m.text || "");
  var html = '<h2>메모 관리</h2><p class="sh-sub">' + esc(tt.slice(0, 70)) + (tt.length > 70 ? "…" : "") + "</p>";
  html += '<div class="btnrow">' +
    '<button class="btn sm ' + (st === "대기" ? "primary" : "") + '" data-act="set-status" data-id="' + esc(id) + '" data-st="대기">대기</button>' +
    '<button class="btn sm ' + (st === "처리중" ? "primary" : "") + '" data-act="set-status" data-id="' + esc(id) + '" data-st="처리중">처리중</button>' +
    '<button class="btn sm ' + (st === "완료" ? "primary" : "") + '" data-act="set-status" data-id="' + esc(id) + '" data-st="완료">완료</button>' +
  "</div>";
  html += '<div class="btnrow">' +
    '<button class="btn" data-act="toggle-todo" data-id="' + esc(id) + '">' + (m.todo ? "할 일 해제" : "할 일로 등록") + "</button>" +
    '<button class="btn" data-act="toggle-star-btn" data-id="' + esc(id) + '">' + (m.star ? "★ 중요 해제" : "☆ 중요 표시") + "</button>" +
  "</div>";
  html += '<div class="btnrow">' +
    '<button class="btn" data-act="edit" data-id="' + esc(id) + '">✏️ 내용 수정</button>' +
    '<button class="btn" data-act="copy-one" data-id="' + esc(id) + '">📋 복사</button>' +
  "</div>";
  html += '<div class="btnrow"><button class="btn danger" data-act="ask-delete" data-id="' + esc(id) + '">🗑 삭제</button></div>';
  openSheet(html);
}

function sheetEdit(id) {
  var m = S.memos[id];
  if (!m) return;
  var html = '<h2>내용 수정</h2><p class="sh-sub">주제: ' + catOf(m.cat).emoji + " " + esc(catOf(m.cat).label) + "</p>" +
    '<textarea id="editText">' + esc(m.text) + "</textarea>" +
    '<div class="btnrow"><button class="btn primary" data-act="save-edit" data-id="' + esc(id) + '">저장</button>' +
    '<button class="btn ghost" data-act="close-sheet">취소</button></div>';
  openSheet(html, function () { var t = $("#editText"); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } });
}

function sheetConfirmDelete(id) {
  openSheet('<h2>메모 삭제</h2><p class="sh-sub">이 메모를 지울까요? 되돌릴 수 없습니다.</p>' +
    '<div class="btnrow"><button class="btn danger" data-act="do-delete" data-id="' + esc(id) + '">삭제</button>' +
    '<button class="btn ghost" data-act="close-sheet">취소</button></div>');
}

function sheetPinChange() {
  openSheet('<h2>PIN 변경</h2><p class="sh-sub">숫자 4자리 · 카일 님과 스마트가 함께 쓰는 PIN입니다.</p>' +
    '<div style="display:grid;gap:8px">' +
      '<input type="password" id="pinOld" inputmode="numeric" maxlength="4" placeholder="지금 PIN" autocomplete="off">' +
      '<input type="password" id="pinNew1" inputmode="numeric" maxlength="4" placeholder="새 PIN 4자리" autocomplete="off">' +
      '<input type="password" id="pinNew2" inputmode="numeric" maxlength="4" placeholder="새 PIN 한 번 더" autocomplete="off">' +
    "</div>" +
    '<div class="btnrow"><button class="btn primary" data-act="save-pin">변경</button>' +
    '<button class="btn ghost" data-act="close-sheet">취소</button></div>' +
    '<p class="note">바꾸면 이 기기와 (동기화 중이면) 스마트 쪽에도 같은 PIN이 적용됩니다.</p>');
}

function sheetSettings() {
  var p = SYNC_PATHS.filter(function (x) { return x.key === S.pref; })[0] || SYNC_PATHS[0];
  var modeTxt = S.sync.mode === "live" ? "실시간 공유 중" : (S.pref === "local" ? "이 기기에만 저장" : "이 기기에만 저장 (연결 안 됨)");
  var html = "<h2>설정</h2><p class=\"sh-sub\">카일·스마트 톡메모 v" + APP_VER + "</p>";
  html += '<div class="kv"><span>동기화</span><span>' + esc(modeTxt) + "</span></div>";
  html += '<div class="kv"><span>경로</span><span>' + esc(S.sync.mode === "live" ? S.sync.path : (p.path || "없음")) + "</span></div>";
  html += '<div class="kv"><span>이 기기 메모</span><span>' + Object.keys(S.memos).length + "건</span></div>";
  html += '<h2 style="margin-top:16px;font-size:.95rem">동기화 경로</h2>';
  SYNC_PATHS.forEach(function (o) {
    html += '<div class="opt' + (S.pref === o.key ? " on" : "") + '" data-act="pick-path" data-key="' + o.key + '">' +
      '<span class="rd"></span><span><b>' + esc(o.label) + "</b><em>" + esc(o.note) + "</em></span></div>";
  });
  html += '<div class="btnrow"><button class="btn" data-act="retry-sync">↻ 다시 연결</button>' +
    '<button class="btn" data-act="copy-open">📋 미완료 메모 복사</button></div>';
  html += '<h2 style="margin-top:16px;font-size:.95rem">이 앱</h2>';
  html += '<div class="btnrow"><button class="btn" data-act="toggle-font">🔤 글자 크기 (' + (S.fontLg ? "크게" : "보통") + ')</button>' +
    '<button class="btn" data-act="pin-change">🔑 PIN 변경</button></div>';
  html += '<div class="btnrow"><button class="btn" data-act="export">⬇ 백업 내보내기(JSON)</button>' +
    '<button class="btn" data-act="lock-now">🔒 잠금</button></div>';
  html += '<p class="note">· 메모는 이 기기 브라우저에도 저장되어, 인터넷이 끊겨도 남습니다.<br>' +
    '· 폰에서 브라우저 메뉴 → “홈 화면에 추가”를 누르면 앱처럼 열립니다.<br>' +
    '· 스마트에게 보낼 내용은 ‘미완료 메모 복사’로 복사해 대화에 붙여넣으면 됩니다.</p>';
  openSheet(html);
}

/* ------------------------- 동작 ------------------------- */
function addMemo() {
  var inp = $("#input");
  var text = (inp.value || "").trim();
  if (!text) { inp.focus(); return; }
  var now = Date.now();
  var wasTodo = !!S.draftTodo;
  var m = {
    id: uid(), text: text, cat: S.draftCat, author: "kyle",
    createdAt: now, updatedAt: now, status: "대기",
    todo: wasTodo, star: !!S.draftStar, smartReply: "", smartReplyAt: 0
  };
  inp.value = "";
  inp.style.height = "auto";
  S.draftTodo = false;
  S.draftStar = false;
  saveUi();
  saveMemo(m);
  if (S.cat !== "all" && S.cat !== m.cat) { S.cat = "all"; saveUi(); renderChips(); renderList(); }
  renderChips();
  toast(wasTodo ? "할 일로 등록했습니다" : "메모를 남겼습니다");
}

function patchMemo(id, patch) {
  var m = S.memos[id];
  if (!m) return;
  Object.assign(m, patch);
  m.updatedAt = Date.now();
  saveMemo(m);
}

function cycleStatus(id) {
  var m = S.memos[id];
  if (!m) return;
  var st = m.status || "대기";
  var next = st === "대기" ? "처리중" : (st === "처리중" ? "완료" : "대기");
  if (next !== "대기") m.todo = true;
  patchMemo(id, { status: next });
  toast("상태: " + next);
}

function toggleDone(id) {
  var m = S.memos[id];
  if (!m) return;
  var done = (m.status || "대기") === "완료";
  patchMemo(id, { status: done ? "대기" : "완료", todo: true });
  toast(done ? "완료를 취소했습니다" : "완료로 표시했습니다");
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return legacyCopy(text); });
  }
  return Promise.resolve(legacyCopy(text));
}
function legacyCopy(text) {
  try {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch (e) { return false; }
}

function openTodosText() {
  var arr = [];
  Object.keys(S.memos).forEach(function (id) {
    var m = S.memos[id];
    if (!m || !m.text) return;
    if ((m.status || "대기") === "완료") return;
    if (!m.todo && (m.status || "대기") === "대기" && !m.star) return;
    arr.push("[" + catOf(m.cat).label + "] " + m.text.replace(/\n/g, " "));
  });
  if (!arr.length) { toast("미완료 메모가 없습니다"); return; }
  copyText(arr.join("\n")).then(function (ok) {
    toast(ok ? "미완료 " + arr.length + "건을 복사했습니다 — 대화에 붙여넣으세요" : "복사에 실패했습니다");
  });
}

function exportJson() {
  var data = { app: "kyle-talkmemo", version: APP_VER, exportedAt: new Date().toISOString(), memos: S.memos };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "톡메모-백업-" + dayKey(Date.now()) + ".json";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  toast("백업 파일을 내려받았습니다");
}

/* ------------------------- 이벤트 ------------------------- */
function bind() {
  /* PIN 키패드 */
  $("#keypad").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    pinKey(b.getAttribute("data-k"));
  });
  document.addEventListener("keydown", function (e) {
    if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (!$("#lock").hidden && /^[0-9]$/.test(e.key)) pinKey(e.key);
    if (!$("#lock").hidden && e.key === "Backspace") pinKey("del");
    if (!$("#lock").hidden && e.key === "Enter") pinKey("ok");
  });

  /* 카테고리 칩 */
  $("#catChips").addEventListener("click", function (e) {
    var b = e.target.closest("[data-cat]");
    if (!b) return;
    S.cat = b.getAttribute("data-cat");
    saveUi();
    renderChips();
    renderList();
    if (S.order === "asc") { var l = $("#list"); l.scrollTop = l.scrollHeight; }
  });

  $("#tgOpen").addEventListener("click", function () { S.onlyOpen = !S.onlyOpen; renderChips(); renderList(); });
  $("#tgStar").addEventListener("click", function () { S.onlyStar = !S.onlyStar; renderChips(); renderList(); });
  $("#tgOrder").addEventListener("click", function () {
    S.order = S.order === "asc" ? "desc" : "asc";
    saveUi(); renderChips(); renderList();
    $("#list").scrollTop = S.order === "asc" ? $("#list").scrollHeight : 0;
  });

  $("#btnSearch").addEventListener("click", function () {
    var bar = $("#searchbar");
    bar.hidden = !bar.hidden;
    if (!bar.hidden) $("#q").focus();
    else { S.q = ""; $("#q").value = ""; renderList(); }
  });
  $("#btnSearchClose").addEventListener("click", function () {
    $("#searchbar").hidden = true;
    S.q = ""; $("#q").value = "";
    renderList();
  });
  $("#q").addEventListener("input", function (e) {
    S.q = e.target.value.trim();
    renderList();
  });
  $("#q").addEventListener("keydown", function (e) { if (e.key === "Escape") $("#btnSearchClose").click(); });
  $("#btnMenu").addEventListener("click", sheetSettings);

  /* 입력 */
  $("#btnCatPick").addEventListener("click", sheetCategory);
  $("#flagTodo").addEventListener("click", function () { S.draftTodo = !S.draftTodo; renderChips(); });
  $("#flagStar").addEventListener("click", function () { S.draftStar = !S.draftStar; renderChips(); });
  $("#composer").addEventListener("submit", function (e) { e.preventDefault(); addMemo(); });

  var inp = $("#input");
  var finePointer = window.matchMedia && window.matchMedia("(pointer:fine)").matches;
  inp.addEventListener("input", function () {
    inp.style.height = "auto";
    inp.style.height = Math.min(inp.scrollHeight, 132) + "px";
  });
  inp.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    if (finePointer) { e.preventDefault(); addMemo(); }
    /* 모바일: Enter는 줄바꿈, 전송은 버튼 */
  });

  /* 메모 카드 동작 (위임) */
  $("#list").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var id = b.getAttribute("data-id");
    var act = b.getAttribute("data-act");
    if (act === "toggle-done") toggleDone(id);
    else if (act === "cycle-status") cycleStatus(id);
    else if (act === "toggle-star") { var m = S.memos[id]; if (m) patchMemo(id, { star: !m.star }); }
    else if (act === "more") sheetMore(id);
  });

  /* 시트 안 동작 (위임) */
  $("#sheetwrap").addEventListener("click", function (e) {
    if (e.target === $("#sheetwrap")) { closeSheet(); return; }
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    var id = b.getAttribute("data-id");
    if (act === "close-sheet") closeSheet();
    else if (act === "pick-cat") {
      S.draftCat = b.getAttribute("data-cat");
      saveUi(); renderChips(); closeSheet(); $("#input").focus();
    } else if (act === "set-status") {
      var st = b.getAttribute("data-st");
      patchMemo(id, { status: st, todo: st === "대기" ? (S.memos[id] || {}).todo : true });
      closeSheet(); toast("상태: " + st);
    } else if (act === "toggle-todo") {
      var m1 = S.memos[id]; if (m1) { patchMemo(id, { todo: !m1.todo }); closeSheet(); }
    } else if (act === "toggle-star-btn") {
      var m2 = S.memos[id]; if (m2) { patchMemo(id, { star: !m2.star }); closeSheet(); }
    } else if (act === "edit") sheetEdit(id);
    else if (act === "save-edit") {
      var t = $("#editText");
      if (!t) return;
      var v = t.value.trim();
      if (!v) { toast("내용을 입력하세요"); return; }
      patchMemo(id, { text: v, edited: true });
      closeSheet(); toast("수정했습니다");
    } else if (act === "copy-one") {
      var mm = S.memos[id];
      if (mm) copyText("[" + catOf(mm.cat).label + "] " + mm.text).then(function (ok) { toast(ok ? "복사했습니다" : "복사 실패"); });
      closeSheet();
    } else if (act === "ask-delete") sheetConfirmDelete(id);
    else if (act === "do-delete") { closeSheet(); deleteMemo(id); }
    else if (act === "pin-change") sheetPinChange();
    else if (act === "save-pin") {
      var oldv = ($("#pinOld") || {}).value || "", n1 = ($("#pinNew1") || {}).value || "", n2 = ($("#pinNew2") || {}).value || "";
      if (!/^\d{4}$/.test(n1)) { toast("새 PIN은 숫자 4자리입니다"); return; }
      if (n1 !== n2) { toast("새 PIN이 서로 다릅니다"); return; }
      hashPin(oldv).then(function (h) {
        if (h !== S.pinHash) { toast("지금 PIN이 맞지 않습니다"); return; }
        return hashPin(n1);
      }).then(function (nh) {
        if (!nh) return;
        S.pinHash = nh;
        store(LS.pin, nh);
        if (S.sync.mode === "live") fbWrite("config", { pinHash: nh, updatedAt: Date.now() }).catch(function () {});
        saveSession();
        closeSheet();
        toast("PIN을 바꿨습니다");
      });
    } else if (act === "pick-path") {
      var key = b.getAttribute("data-key");
      if (key === S.pref) { closeSheet(); return; }
      store(LS.pref, key);
      closeSheet();
      toast("동기화 경로를 바꿨습니다 — 새로 여는 중…");
      setTimeout(function () { location.reload(); }, 500);
    } else if (act === "retry-sync" || act === "use-board-path") {
      if (act === "use-board-path") store(LS.pref, "board");
      closeSheet();
      toast("다시 연결합니다…");
      setTimeout(function () { location.reload(); }, 450);
    } else if (act === "toggle-font") {
      S.fontLg = !S.fontLg;
      store(LS.fontLg, S.fontLg ? "1" : "0");
      document.documentElement.classList.toggle("fs-lg", S.fontLg);
      sheetSettings();
    } else if (act === "copy-open") openTodosText();
    else if (act === "export") exportJson();
    else if (act === "lock-now") { drop(LS.auth); closeSheet(); showLock(); }
  });

  /* 배너 버튼 */
  $("#bannerHost").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    if (act === "use-board-path") { store(LS.pref, "board"); toast("게시판 경로로 다시 연결합니다…"); setTimeout(function () { location.reload(); }, 450); }
    if (act === "retry-sync") { toast("다시 연결합니다…"); setTimeout(function () { location.reload(); }, 450); }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("#sheetwrap").hidden) closeSheet();
  });

  /* 화면 복귀 시 재연결 */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && S.authed && S.sync.mode !== "live" && S.pref !== "local") {
      if (syncAvailable() && db && dbPath) {
        db.ref(dbPath + "/memos").once("value").then(function () { attachListener(dbPath); }).catch(function () {});
      }
    }
  });

  /* 서비스 워커 (PWA) */
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
}

/* ------------------------- 시작 ------------------------- */
function boot() {
  loadLocal();
  bind();
  if (sessionValid()) showApp();
  else showLock();
  startSync();
  setTimeout(seedIfEmpty, 900);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
