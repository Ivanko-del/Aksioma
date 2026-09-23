// ═══════════════════════════════════════════════════════════════════
// Аксіома Банк — партнерський застосунок SlotOK.
// Спільна Firebase (проєкт nye-slotok) і ті самі акаунти users/<nick>.
// Картку зберігаємо в users/<nick>/virtualCard; прапорець axiomLinked
// ставить САМ SlotOK, коли споживає 6-значний код — так гейт коду лишається
// робочим, а не обходиться простим створенням картки тут.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const firebaseConfig = {
  apiKey:            "AIzaSyBQelUmnWpgdjV_Y22GBjjZZPxUb85PUuI",
  authDomain:        "nye-slotok.firebaseapp.com",
  databaseURL:       "https://nye-slotok-default-rtdb.firebaseio.com",
  projectId:         "nye-slotok",
  storageBucket:     "nye-slotok.firebasestorage.app",
  messagingSenderId: "436174740835",
  appId:             "1:436174740835:web:b70e8467396e9f983ac756",
};

let db = null;
let auth = null;
try {
  if (typeof firebase === 'undefined') throw new Error('Firebase SDK не завантажився');
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  auth = firebase.auth();
} catch (e) {
  console.error('Firebase init failed:', e);
}

// Firebase Anonymous Auth — даємо клієнту реальний підписаний UID замість
// голого localStorage.axioma_nick. Сам по собі він не замінює серверну
// перевірку пароля (якої тут немає), але дозволяє прив'язати "сесію" до
// users/<nick>/authUid: чужий нік у localStorage більше не пускає в акаунт,
// бо UID цього браузера не збігається зі збереженим authUid.
let _authReadyResolve;
const authReady = new Promise((resolve) => { _authReadyResolve = resolve; });
if (auth) {
  auth.onAuthStateChanged((user) => {
    if (user) { _authReadyResolve(user); return; }
    auth.signInAnonymously().catch((e) => console.error('Anonymous auth failed:', e));
  });
} else {
  _authReadyResolve(null);
}

let currentUser = null;
let userData = null;
let _cvvVisible = false;
let _cvvTimer = null;
let _codeTimer = null;
let _creatingCard = false;
let _generatingCode = false;

// ── Дрібні хелпери ─────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt(n) {
  n = Number(n) || 0;
  return (Math.round(n * 100) / 100).toLocaleString('uk-UA', { maximumFractionDigits: 2 });
}
let _toastTimer = null;
function toast(msg, type) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' is-' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}
function icon(name) {
  const P = {
    eye:     '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff:  '<path d="M10.6 5.2A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.4 3.3M6.3 6.7A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4-.8"/><path d="m3 3 18 18"/>',
    lock:    '<rect x="3.5" y="11" width="17" height="10.5" rx="2.5"/><path d="M7.5 11V7a4.5 4.5 0 0 1 9 0v4"/>',
    unlock:  '<rect x="3.5" y="11" width="17" height="10.5" rx="2.5"/><path d="M7.5 11V7a4.5 4.5 0 0 1 8.9-1"/>',
    copy:    '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check:   '<path d="M20 6 9 17l-5-5"/>',
    x:       '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    inflow:  '<path d="M17 7 7 17"/><path d="M17 17H7V7"/>',
    outflow: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>';
}

// ── Луна-валідний номер картки ─────────────────────────────────────
function genCardNumber(prefix) {
  let body = String(prefix || '');
  while (body.length < 15) body += Math.floor(Math.random() * 10);
  body = body.slice(0, 15);
  let sum = 0, dbl = true;
  for (let i = body.length - 1; i >= 0; i--) {
    let d = body.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return body + ((10 - (sum % 10)) % 10);
}

// ── Rate-limit/lockout спроб входу (per nick, зберігається в localStorage).
// Це суто клієнтський захист — скидається очищенням localStorage чи іншим
// браузером, тож не замінює серверний rate-limit, якого поки немає.
function loginLockKey(nick) { return 'axioma_login_lock_' + nick.toLowerCase(); }
function getLoginLock(nick) {
  try { return JSON.parse(localStorage.getItem(loginLockKey(nick))) || { fails: 0, until: 0 }; }
  catch (e) { return { fails: 0, until: 0 }; }
}
function setLoginLock(nick, lock) {
  try { localStorage.setItem(loginLockKey(nick), JSON.stringify(lock)); } catch (e) { /* localStorage недоступний */ }
}
function registerLoginFailure(nick) {
  const lock = getLoginLock(nick);
  lock.fails = (lock.fails || 0) + 1;
  const GRACE = 3; // перші 3 спроби без затримки
  lock.until = lock.fails > GRACE ? Date.now() + Math.min(300, Math.pow(2, lock.fails - GRACE)) * 1000 : 0;
  setLoginLock(nick, lock);
}
function registerLoginSuccess(nick) { setLoginLock(nick, { fails: 0, until: 0 }); }

// ═══════════════════════════════════════════════════════════════════
// ВХІД
// ═══════════════════════════════════════════════════════════════════
async function axLogin() {
  const nick = ($('authNick').value || '').trim();
  const pass = $('authPass').value || '';
  const errEl = $('authError');
  errEl.textContent = '';
  if (!nick || !pass) { errEl.textContent = 'Введіть нік і пароль'; return; }
  if (!db) { errEl.textContent = 'Немає зʼєднання з базою'; return; }

  const lock = getLoginLock(nick);
  if (lock.until && lock.until > Date.now()) {
    errEl.textContent = 'Забагато спроб. Спробуйте через ' + Math.ceil((lock.until - Date.now()) / 1000) + ' с.';
    return;
  }

  const btn = $('authBtn');
  btn.disabled = true; btn.textContent = 'Вхід…';
  try {
    if (auth) { try { await authReady; } catch (e) { /* продовжимо навіть без anon-сесії */ } }

    // Читаємо лише хеш пароля, а не весь профіль (баланс, картку тощо) —
    // тільки він потрібен для перевірки входу.
    const snap = await db.ref('users/' + nick + '/pass').once('value');
    const passHash = snap.val();
    // Одна помилка на "нема акаунта" і "невірний пароль" — щоб не палити,
    // чи існує нік.
    if (passHash === null || passHash === undefined) {
      registerLoginFailure(nick);
      errEl.textContent = 'Акаунт не знайдено або невірний пароль';
      return;
    }

    // Перевірка пароля тим самим механізмом, що й у SlotOK (PBKDF2 + сумісність
    // зі старими форматами). needsUpgrade → мовчки перезаписуємо в новий формат.
    let check;
    try {
      check = await SlotOKPassword.verify(pass, passHash);
    } catch (e) {
      errEl.textContent = 'Помилка перевірки пароля'; return;
    }
    if (!check || !check.ok) {
      registerLoginFailure(nick);
      errEl.textContent = 'Акаунт не знайдено або невірний пароль';
      return;
    }
    registerLoginSuccess(nick);
    if (check.needsUpgrade) {
      try { await db.ref('users/' + nick + '/pass').set(await SlotOKPassword.hash(pass)); } catch (e) { /* необовʼязково */ }
    }

    // Прив'язуємо цей браузер (anon UID) до ніку — це і є "сесія".
    if (auth && auth.currentUser) {
      try { await db.ref('users/' + nick + '/authUid').set(auth.currentUser.uid); }
      catch (e) { console.error('authUid bind failed:', e); }
    }

    localStorage.setItem('axioma_nick', nick);
    enterApp(nick);
  } catch (e) {
    console.error(e);
    errEl.textContent = 'Помилка входу. Спробуйте ще.';
  } finally {
    btn.disabled = false; btn.textContent = 'Увійти';
  }
}

function axLogout() {
  if (currentUser) {
    db.ref('users/' + currentUser).off();
    db.ref('axiomLinkCodes/' + currentUser).off();
  }
  if (_codeTimer) { clearInterval(_codeTimer); _codeTimer = null; }
  if (_cvvTimer) { clearTimeout(_cvvTimer); _cvvTimer = null; }
  _cvvVisible = false;
  localStorage.removeItem('axioma_nick');
  currentUser = null; userData = null;
  $('appScreen').classList.add('hidden');
  $('authScreen').classList.remove('hidden');
  $('authPass').value = '';
}

function enterApp(nick) {
  currentUser = nick;
  $('authScreen').classList.add('hidden');
  $('appScreen').classList.remove('hidden');
  startSync();
}

// ═══════════════════════════════════════════════════════════════════
// СИНХРОНІЗАЦІЯ
// ═══════════════════════════════════════════════════════════════════
function startSync() {
  db.ref('users/' + currentUser).on('value', (snap) => {
    userData = snap.val() || {};
    // Якщо на цьому ж ніку залогінились деінде (інший authUid) — цей
    // браузер втрачає сесію. Так само рятує від підміни localStorage.axioma_nick:
    // без реального входу authUid ніколи не збігається з нашим anon UID.
    if (auth && auth.currentUser && userData.authUid && userData.authUid !== auth.currentUser.uid) {
      toast('Сесію завершено (вхід з іншого пристрою)', 'error');
      axLogout();
      return;
    }
    ensureCard().then(render);
  });
}

// Створюємо картку Аксіоми, якщо її ще немає. axiomLinked НЕ ставимо —
// це зробить SlotOK, коли гравець введе згенерований код.
// _creatingCard блокує паралельні виклики: поки update() не долетить назад
// через той самий on('value'), другий тригер listener'а не повинен запускати
// ще один update() — інакше вийде нескінченний цикл записів.
async function ensureCard() {
  const vc = userData.virtualCard || {};
  if (vc.number || _creatingCard) return;
  _creatingCard = true;
  try {
    const digits = genCardNumber('4874');
    const exp = new Date(Date.now() + 3 * 365 * 86400000);
    const card = {
      number: digits.replace(/(.{4})(?=.)/g, '$1 '),
      cvv: String(Math.floor(100 + Math.random() * 900)),
      expiry: ('0' + (exp.getMonth() + 1)).slice(-2) + '/' + String(exp.getFullYear()).slice(-2),
      holder: String(currentUser || 'USER').toUpperCase(),
      frozen: vc.frozen || false,
      source: 'axiom',
      axiomOwned: true,
      balance: vc.balance || 0,
    };
    // merge: card дає дефолти, наявні поля vc (баланс, skin, axiomLinked) перемагають
    const merged = Object.assign({}, card, vc);
    await db.ref('users/' + currentUser + '/virtualCard').update(merged);
    userData.virtualCard = merged;
  } catch (e) {
    console.error(e);
    toast('Не вдалося створити картку. Спробуйте пізніше.', 'error');
  } finally {
    _creatingCard = false;
  }
}

// Баланс картки = проєкція мультикарткової моделі SlotOK: якщо картка Аксіоми
// зараз активна в SlotOK, її живий баланс лежить у users/<nick>/balance;
// інакше — власний virtualCard/balance.
function cardBalance() {
  const vc = userData.virtualCard || {};
  const ids = [];
  if (vc.axiomLinked) ids.push('axiom');
  if (userData.linkedCards) Object.keys(userData.linkedCards).forEach((k) => ids.push(k));
  const active = (userData.activeCardId && ids.indexOf(userData.activeCardId) >= 0) ? userData.activeCardId : ids[0];
  return active === 'axiom' ? (userData.balance || 0) : (vc.balance || 0);
}

// ═══════════════════════════════════════════════════════════════════
// РЕНДЕР
// ═══════════════════════════════════════════════════════════════════
function render() {
  const vc = userData.virtualCard || {};
  const frozen = !!vc.frozen;

  $('axCardNumber').textContent = vc.number || '•••• •••• •••• ••••';
  $('axCardHolder').textContent = vc.holder || (currentUser || '').toUpperCase();
  $('axCardExpiry').textContent = vc.expiry || '••/••';
  $('axCardCvv').textContent = _cvvVisible ? (vc.cvv || '•••') : '•••';
  $('axCardBadge').innerHTML = vc.axiomLinked
    ? '<span class="linked-badge" style="padding:4px 9px;font-size:11px;">' + icon('check') + ' SlotOK</span>'
    : '';
  $('axCard').classList.toggle('is-frozen', frozen);
  $('axCardFrozen').classList.toggle('hidden', !frozen);

  $('axBalance').textContent = fmt(cardBalance());

  renderActions(frozen);
  renderLinkPanel();
  renderTx();
}

function renderActions(frozen) {
  const el = $('axActions');
  el.innerHTML =
    '<button class="action-btn" onclick="axToggleCvv()">' + icon(_cvvVisible ? 'eyeOff' : 'eye') +
      '<span>' + (_cvvVisible ? 'Сховати' : 'CVV') + '</span></button>' +
    '<button class="action-btn" onclick="axToggleFreeze()">' + icon(frozen ? 'unlock' : 'lock') +
      '<span>' + (frozen ? 'Розблок.' : 'Блок') + '</span></button>' +
    '<button class="action-btn" onclick="axCopyNumber()">' + icon('copy') + '<span>Номер</span></button>';
}

function axToggleCvv() {
  _cvvVisible = !_cvvVisible;
  render();
  if (_cvvTimer) { clearTimeout(_cvvTimer); _cvvTimer = null; }
  if (_cvvVisible) {
    _cvvTimer = setTimeout(() => { _cvvVisible = false; _cvvTimer = null; render(); }, 10000);
  }
}

function axCopyNumber() {
  const num = (userData.virtualCard && userData.virtualCard.number || '').replace(/\s/g, '');
  if (!/^[0-9]{12,19}$/.test(num)) return;
  if (navigator.clipboard) navigator.clipboard.writeText(num).then(() => toast('Номер скопійовано', 'success'));
}

async function axToggleFreeze() {
  const frozen = !!(userData.virtualCard && userData.virtualCard.frozen);
  try {
    await db.ref('users/' + currentUser + '/virtualCard/frozen').set(!frozen);
    toast(frozen ? 'Картку розблоковано' : 'Картку заблоковано — операції недоступні', frozen ? 'success' : 'info');
  } catch (e) {
    console.error(e);
    toast('Не вдалося змінити стан картки. Спробуйте ще раз.', 'error');
  }
}

// ── Панель підключення до SlotOK ───────────────────────────────────
function renderLinkPanel() {
  const el = $('axLinkBody');
  const vc = userData.virtualCard || {};
  if (vc.axiomLinked) {
    el.innerHTML =
      '<div class="linked-badge">' + icon('check') + ' Картку підключено до SlotOK</div>' +
      '<p class="code-hint" style="margin-top:12px;">Баланс і виписка синхронізуються між Аксіомою та SlotOK. ' +
      'Заморозка діє в обох застосунках.</p>';
    return;
  }
  el.innerHTML =
    '<p class="code-hint">Щоб грати з цією карткою в SlotOK, згенеруй код і введи його у SlotOK → ' +
    '<b>Каса → Підключити картку → Аксіома</b>.</p>' +
    '<button class="btn btn-primary btn-block" onclick="axGenerateCode()">Згенерувати код підключення</button>';
}

async function axGenerateCode() {
  if (_generatingCode) return; // блокуємо повторний клік, поки триває генерація
  _generatingCode = true;
  try {
    // Відписуємось від попереднього слухача коду перед тим, як завести новий —
    // інакше після кількох генерацій поспіль накопичуються "мертві" listeners.
    db.ref('axiomLinkCodes/' + currentUser).off();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const ts = Date.now();
    const rec = { code: code, used: false, ts: ts };
    await db.ref('axiomLinkCodes/' + currentUser).set(rec);
    showCode(code, ts);
    watchLinkCode();
  } catch (e) {
    console.error(e);
    toast('Не вдалося згенерувати код. Спробуйте ще раз.', 'error');
  } finally {
    _generatingCode = false;
  }
}

function showCode(code, ts) {
  const el = $('axLinkBody');
  const TTL = 10 * 60 * 1000;
  el.innerHTML =
    '<div class="code-box">' +
      '<div class="code-value">' + esc(code) + '</div>' +
      '<div class="code-timer">Дійсний ще <b id="axCodeLeft">10:00</b></div>' +
      '<p class="code-hint">У SlotOK: <b>Каса → Підключити картку → Аксіома</b>, введи цей код.</p>' +
      '<button class="btn btn-quiet btn-block" onclick="axGenerateCode()">Згенерувати новий</button>' +
    '</div>';
  if (_codeTimer) clearInterval(_codeTimer);
  const tick = () => {
    const left = TTL - (Date.now() - ts);
    const lEl = $('axCodeLeft');
    if (!lEl) { clearInterval(_codeTimer); return; }
    if (left <= 0) {
      clearInterval(_codeTimer);
      db.ref('axiomLinkCodes/' + currentUser).off();
      db.ref('axiomLinkCodes/' + currentUser).remove().catch((e) => console.error(e));
      renderLinkPanel();
      return;
    }
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    lEl.textContent = m + ':' + ('0' + s).slice(-2);
  };
  tick();
  _codeTimer = setInterval(tick, 1000);
}

// Слухаємо код: коли SlotOK його спожив (used=true) або зʼявився axiomLinked —
// оновлюємо панель у реальному часі.
function watchLinkCode() {
  db.ref('axiomLinkCodes/' + currentUser).on('value', (snap) => {
    const d = snap.val();
    if (d && d.used) {
      db.ref('axiomLinkCodes/' + currentUser).off();
      if (_codeTimer) clearInterval(_codeTimer);
      db.ref('axiomLinkCodes/' + currentUser).remove().catch((e) => console.error(e));
      toast('Картку підключено до SlotOK ✅', 'success');
      renderLinkPanel();
    }
  });
}

// ── Виписка ────────────────────────────────────────────────────────
function txRow(t) {
  const dir = t.dir || ((t.amount || 0) > 0 ? 'in' : 'out');
  const isIn = dir === 'in';
  const date = new Date(t.ts || Date.now()).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const sub = [t.subtitle, date].filter(Boolean).join(' · ');
  return '<div class="tx">' +
    '<div class="tx-icn ' + (isIn ? 'in' : 'out') + '">' + icon(isIn ? 'inflow' : 'outflow') + '</div>' +
    '<div class="tx-main"><div class="tx-title">' + esc(t.title || (isIn ? 'Надходження' : 'Списання')) + '</div>' +
      '<div class="tx-sub">' + esc(sub) + '</div></div>' +
    '<div class="tx-amt ' + (isIn ? 'in' : 'out') + '">' + (isIn ? '+' : '−') + fmt(Math.abs(t.amount || 0)) + ' ₴</div>' +
    '</div>';
}
function renderTx() {
  const el = $('axTxList');
  db.ref('users/' + currentUser + '/cardTx').limitToLast(8).once('value').then((snap) => {
    const txs = Object.values(snap.val() || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    el.innerHTML = txs.length ? txs.slice(0, 8).map(txRow).join('') : '<div class="muted">Операцій ще немає</div>';
  });
}
function axShowAllTx() {
  db.ref('users/' + currentUser + '/cardTx').limitToLast(100).once('value').then((snap) => {
    const txs = Object.values(snap.val() || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const m = document.createElement('div');
    m.className = 'modal'; m.id = 'axAllTx';
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.innerHTML = '<div class="modal-box" style="padding:20px 0 8px;">' +
      '<div class="modal-head" style="padding:0 18px;"><div class="modal-title">Повна виписка</div>' +
      '<button class="icon-btn" onclick="document.getElementById(\'axAllTx\').remove()">' + icon('x') + '</button></div>' +
      (txs.length ? txs.map(txRow).join('') : '<div class="muted">Операцій ще немає</div>') +
      '</div>';
    document.body.appendChild(m);
  });
}

// ── Автовхід за збереженою сесією ───────────────────────────────────
// localStorage.axioma_nick сам по собі нічого не важить: автовхід
// спрацьовує, лише якщо users/<nick>/authUid збігається з anon UID цього
// браузера (тобто пароль тут уже перевіряли раніше, через axLogin).
window.addEventListener('DOMContentLoaded', async () => {
  const saved = localStorage.getItem('axioma_nick');
  if (!saved || !db) return;
  try {
    if (auth) await authReady;
    const snap = await db.ref('users/' + saved).once('value');
    const data = snap.val();
    if (data && auth && auth.currentUser && data.authUid && data.authUid === auth.currentUser.uid) {
      enterApp(saved);
    } else {
      localStorage.removeItem('axioma_nick');
    }
  } catch (e) {
    console.error(e);
  }
});
