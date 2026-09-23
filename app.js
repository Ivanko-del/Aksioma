// ═══════════════════════════════════════════════════════════════════
// Аксіома Банк — ігровий банк для кількох проєктів (SlotOK і наступних).
// Власна Firebase «axioma-bank»: акаунти (Firebase Auth — нік
// перетворюється на технічний email, пароль перевіряє сервер Google),
// картки, скарбнички, перекази. Проєкти-партнери входять в акаунт Аксіоми
// й поповнюються з картки / виводять на неї через sdk/axioma-sdk.js.
// База SlotOK потрібна лише для одноразового перенесення гравця SlotOK.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const AXIOMA_CONFIG = {
  apiKey:            "AIzaSyANB_QQ4V62gbbly0hXgDTX1YTMButPEg4",
  authDomain:        "axioma-bank.firebaseapp.com",
  databaseURL:       "https://axioma-bank-default-rtdb.firebaseio.com",
  projectId:         "axioma-bank",
  storageBucket:     "axioma-bank.firebasestorage.app",
  messagingSenderId: "645185578160",
  appId:             "1:645185578160:web:94b128b8f29cd5aadd8775",
};
const SLOTOK_CONFIG = {
  apiKey:            "AIzaSyBQelUmnWpgdjV_Y22GBjjZZPxUb85PUuI",
  authDomain:        "nye-slotok.firebaseapp.com",
  databaseURL:       "https://nye-slotok-default-rtdb.firebaseio.com",
  projectId:         "nye-slotok",
  storageBucket:     "nye-slotok.firebasestorage.app",
  messagingSenderId: "436174740835",
  appId:             "1:436174740835:web:b70e8467396e9f983ac756",
};
const EMAIL_DOMAIN = 'axioma-bank.firebaseapp.com';

let db = null;
let auth = null;
let slotDb = null;
try {
  if (typeof firebase === 'undefined') throw new Error('Firebase SDK не завантажився');
  if (!firebase.apps.length) firebase.initializeApp(AXIOMA_CONFIG);
  db = firebase.database();
  auth = firebase.auth();
  slotDb = firebase.initializeApp(SLOTOK_CONFIG, 'slotok').database();
  // Локальні емулятори Firebase для розробки: http://localhost:…/?emulator=1
  if (location.hostname === 'localhost' && /[?&]emulator=1\b/.test(location.search)) {
    db.useEmulator('127.0.0.1', 9000);
    slotDb.useEmulator('127.0.0.1', 9000);
    auth.useEmulator('http://127.0.0.1:9099');
  }
} catch (e) {
  console.error('Firebase init failed:', e);
}

let currentUser = null;   // нік
let currentUid = null;    // uid у Firebase Auth Аксіоми
let userData = null;
let _cvvId = null;        // картка, в якої зараз видно CVV
let _cvvTimer = null;
let _creatingCard = false;
let _flippedIds = {};     // id картки → перевернута
let _selId = 'main';      // вибрана в каруселі картка
let _pendingSelId = null; // щойно відкрита картка, яку виберемо, коли вона приїде з бази
let _authBusy = false;    // іде вхід/реєстрація/перенесення — сесію стартуємо вручну

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
    flip:    '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
    swap:    '<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/>',
    sliders: '<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h12"/><path d="M20 18h0"/><circle cx="18" cy="18" r="2"/>',
    plus:    '<path d="M12 5v14"/><path d="M5 12h14"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    cards:   '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19"/><path d="M6.5 15h4"/>',
    piggy:   '<path d="M19 11.5c0-3.6-3.1-6.5-7-6.5S5 7.9 5 11.5c0 1.9.9 3.6 2.3 4.8L8 19h3v-1.1c.3 0 .7.1 1 .1s.7 0 1-.1V19h3l.7-2.7c.8-.7 1.5-1.5 1.8-2.3H21v-3h-2.1"/><circle cx="15.5" cy="10.5" r=".6" fill="currentColor"/><path d="M10 5.2V4.5A1.5 1.5 0 0 1 11.5 3h1"/>',
    dots:    '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    user:    '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    key:     '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m16 7 3 3"/>',
    gauge:   '<path d="M12 14 16 9"/><path d="M3.5 17a9 9 0 1 1 17 0"/>',
    help:    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
    chat:    '<path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12Z"/>',
    info:    '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".6" fill="currentColor"/>',
    logout:  '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    doc:     '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    trash:   '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
    target:  '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    gift:    '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13"/><path d="M3 12h18"/><path d="M12 8c-1.5-3-5-3.5-5-1.2C7 8 9.5 8 12 8Z"/><path d="M12 8c1.5-3 5-3.5 5-1.2C17 8 14.5 8 12 8Z"/>',
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
// АКАУНТИ
// Нік → технічний email: base32 від UTF-8 байтів ніка (регістр зберігається,
// кирилиця працює, до 64 символів для ніка до 20 знаків).
// ═══════════════════════════════════════════════════════════════════
const NICK_RE = /^[a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9_\-]{3,20}$/;   // як у реєстрації SlotOK
const NICK_PATH_RE = /^[^.#$\[\]\/]{1,40}$/;               // що взагалі можна покласти в шлях бази
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

function nickEmail(nick) {
  let bits = 0, val = 0, out = '';
  new TextEncoder().encode(nick).forEach((b) => {
    val = ((val << 8) | b) & 0xfff; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  });
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out + '@' + EMAIL_DOMAIN;
}
function nickFromEmail(email) {
  const local = String(email || '').split('@')[0];
  const bytes = [];
  let bits = 0, val = 0;
  for (const ch of local) {
    const i = B32.indexOf(ch);
    if (i < 0) return '';
    val = ((val << 5) | i) & 0xfff; bits += 5;
    if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); } catch (e) { return ''; }
}

// Хендл — локальна частина технічного email. Ним ключуємо все, що прив'язане
// до ніка (handles, public, referrals, cardIndex): правила бази звіряють
// хендл з email у токені входу, тож писати можна лише від свого ніка.
function handleOf(nick) { return nickEmail(nick).split('@')[0]; }
function nickFromHandle(h) { return nickFromEmail(String(h || '') + '@'); }

function authErrorText(e) {
  const code = (e && e.code) || '';
  if (code === 'auth/too-many-requests') return 'Забагато спроб. Зачекай кілька хвилин і спробуй ще';
  if (code === 'auth/network-request-failed') return 'Немає зʼєднання. Перевір інтернет';
  if (code === 'auth/weak-password') return 'Пароль — мінімум 6 символів';
  if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found' || /CONFIGURATION_NOT_FOUND/.test(String(e && e.message)))
    return 'Вхід тимчасово недоступний: у Firebase не увімкнено Email/Password';
  return '';
}

function setAuthMode(mode) {
  const reg = mode === 'register';
  $('authScreen').classList.toggle('is-register', reg);
  $('authTitle').textContent = reg ? 'Новий акаунт' : 'Вхід в акаунт';
  $('authHint').textContent = reg ? 'Нік від 3 до 20 символів: літери, цифри, «_» і «-»' : 'Гравцю SlotOK: входь ніком і паролем від SlotOK — рахунок перенесеться сам';
  $('authPass2Wrap').classList.toggle('hidden', !reg);
  $('authBtn').textContent = reg ? 'Створити акаунт' : 'Увійти';
  $('authSwitch').innerHTML = reg
    ? 'Уже є акаунт? <button type="button" class="link-btn" onclick="setAuthMode(\'login\')">Увійти</button>'
    : 'Немає акаунту? <button type="button" class="link-btn" onclick="setAuthMode(\'register\')">Зареєструватися</button>';
  $('authPass').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
  $('authError').textContent = '';
}
function authSubmit() {
  return $('authScreen').classList.contains('is-register') ? axRegister() : axLogin();
}

async function axLogin() {
  const nick = ($('authNick').value || '').trim();
  const pass = $('authPass').value || '';
  const errEl = $('authError');
  errEl.textContent = '';
  if (!nick || !pass) { errEl.textContent = 'Введи нік і пароль'; return; }
  if (!NICK_PATH_RE.test(nick)) { errEl.textContent = 'Нік містить недопустимі символи'; return; }
  if (!db || !auth) { errEl.textContent = 'Немає зʼєднання з базою'; return; }
  const lock = getLoginLock(nick);
  if (lock.until && lock.until > Date.now()) {
    errEl.textContent = 'Забагато спроб. Спробуй через ' + Math.ceil((lock.until - Date.now()) / 1000) + ' с.';
    return;
  }

  const btn = $('authBtn');
  btn.disabled = true; btn.textContent = 'Вхід…';
  _authBusy = true;
  try {
    try {
      const cred = await auth.signInWithEmailAndPassword(nickEmail(nick), pass);
      registerLoginSuccess(nick);
      await startSession(cred.user);
      return;
    } catch (e) {
      const known = authErrorText(e);
      if (known) { errEl.textContent = known; return; }
    }
    // Акаунта Аксіоми з таким ніком нема — можливо, це гравець SlotOK.
    if ((await db.ref('handles/' + handleOf(nick)).once('value')).exists()) {
      registerLoginFailure(nick);
      errEl.textContent = 'Невірний нік або пароль';
      return;
    }
    btn.textContent = 'Переносимо рахунок…';
    const res = await migrateFromSlotOK(nick, pass);
    if (res === 'ok') { registerLoginSuccess(nick); await startSession(auth.currentUser); return; }
    registerLoginFailure(nick);
    errEl.textContent = res === 'weak'
      ? 'Пароль від SlotOK коротший за 6 символів — зміни його в SlotOK і спробуй ще'
      : 'Невірний нік або пароль';
  } catch (e) {
    console.error(e);
    errEl.textContent = authErrorText(e) || 'Помилка входу. Спробуй ще раз';
  } finally {
    _authBusy = false;
    btn.disabled = false; btn.textContent = 'Увійти';
  }
}

async function axRegister() {
  const nick = ($('authNick').value || '').trim();
  const pass = $('authPass').value || '';
  const pass2 = $('authPass2').value || '';
  const errEl = $('authError');
  errEl.textContent = '';
  if (!NICK_RE.test(nick)) { errEl.textContent = 'Нік: від 3 до 20 символів — літери, цифри, «_» або «-»'; return; }
  if (pass.length < 6) { errEl.textContent = 'Пароль — мінімум 6 символів'; return; }
  if (pass !== pass2) { errEl.textContent = 'Паролі не збігаються'; return; }
  if (!db || !auth) { errEl.textContent = 'Немає зʼєднання з базою'; return; }

  const btn = $('authBtn');
  btn.disabled = true; btn.textContent = 'Створюємо…';
  _authBusy = true;
  try {
    if ((await db.ref('handles/' + handleOf(nick)).once('value')).exists()) { errEl.textContent = 'Нік «' + nick + '» уже зайнятий'; return; }
    // Нік гравця SlotOK бронюємо за ним: він увійде своїм паролем і перенесе рахунок.
    if ((await slotDb.ref('users/' + nick + '/pass').once('value')).exists()) {
      errEl.textContent = 'Нік «' + nick + '» є в SlotOK. Якщо це ти — увійди з паролем від SlotOK';
      return;
    }
    const cred = await auth.createUserWithEmailAndPassword(nickEmail(nick), pass);
    await createAccount(cred.user.uid, nick, null);
    await startSession(cred.user);
  } catch (e) {
    console.error(e);
    errEl.textContent = e && e.code === 'auth/email-already-in-use'
      ? 'Нік «' + nick + '» уже зайнятий'
      : (authErrorText(e) || 'Не вдалося створити акаунт. Спробуй ще раз');
  } finally {
    _authBusy = false;
    btn.disabled = false; btn.textContent = 'Створити акаунт';
  }
}

// Записує нік і порожній акаунт. createdAt ставить сервер — правила
// звіряють його з now, тож «новизну» акаунта для рефералки не підробити.
async function createAccount(uid, nick, extra) {
  await db.ref('handles/' + handleOf(nick)).set(uid);
  await db.ref('users/' + uid).set(Object.assign({ nick: nick, createdAt: firebase.database.ServerValue.TIMESTAMP }, extra || {}));
}

// Старт сесії: і після входу, і коли Firebase сам відновив збережений вхід.
async function startSession(user) {
  if (!user) return;
  const nick = nickFromEmail(user.email);
  if (!nick) { toast('Цей акаунт не з Аксіоми', 'error'); await auth.signOut(); return; }
  currentUid = user.uid;
  currentUser = nick;
  // Реєстрація/перенесення могли перерватися після створення входу —
  // добудовуємо акаунт, щоб людина не лишилась із «порожнім» логіном.
  const acc = await db.ref('users/' + user.uid + '/nick').once('value');
  if (!acc.exists()) {
    const slotPass = await slotDb.ref('users/' + nick + '/pass').once('value');
    if (slotPass.exists()) await migrateData(nick, user.uid);
    else await createAccount(user.uid, nick, null);
  }
  $('authScreen').classList.add('hidden');
  $('authPass').value = ''; $('authPass2').value = '';
  startSync();
}

async function axLogout() {
  if (currentUid) db.ref('users/' + currentUid).off();
  if (_cvvTimer) { clearTimeout(_cvvTimer); _cvvTimer = null; }
  _cvvId = null;
  _flippedIds = {};
  _selId = 'main';
  _pendingSelId = null;
  _railSig = '';
  $('axRail').innerHTML = '';
  if (typeof closeSheet === 'function') closeSheet();
  if (typeof stopSocial === 'function') stopSocial();
  $('onboardScreen').classList.add('hidden');
  $('obForm').reset();
  if (typeof setTab === 'function') setTab('cards');
  currentUser = null; currentUid = null; userData = null;
  $('appScreen').classList.add('hidden');
  $('authScreen').classList.remove('hidden');
  $('authPass').value = '';
  setAuthMode('login');
  try { await auth.signOut(); } catch (e) { console.error(e); }
}

// ═══════════════════════════════════════════════════════════════════
// СИНХРОНІЗАЦІЯ
// ═══════════════════════════════════════════════════════════════════
function startSync() {
  db.ref('users/' + currentUid).on('value', (snap) => {
    userData = snap.val() || {};
    // Рахунок відкривається лише після ПІБ і згоди з правилами.
    if (!userData.profile) { showOnboarding(); return; }
    if (!$('onboardScreen').classList.contains('hidden')) hideOnboarding();
    $('appScreen').classList.remove('hidden');
    ensureCard().then(() => { render(); afterSync(); });
  }, (err) => {
    console.error('sync:', err);
    toast('Немає доступу до рахунку. Увійди ще раз', 'error');
    axLogout();
  });
}

// Основну картку випускаємо при першому вході. _creatingCard блокує
// паралельні виклики, поки запис не повернувся через той самий listener.
async function ensureCard() {
  if ((userData.cards && userData.cards.main && userData.cards.main.number) || _creatingCard) return;
  _creatingCard = true;
  try {
    await db.ref('users/' + currentUid + '/cards/main').update(
      Object.assign(newCardData(currentUser), { type: 'main', balance: 0, frozen: false, createdAt: Date.now() }));
  } catch (e) {
    console.error(e);
    toast('Не вдалося випустити картку. Спробуй пізніше', 'error');
  } finally {
    _creatingCard = false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// КАРТКИ
// Усі картки — users/<uid>/cards/<id>; основна має id 'main'. Гроші
// лежать на самих картках, у SlotOK їх переносять поповненням/виводом.
// ═══════════════════════════════════════════════════════════════════
const KEY_RE = /^[-\w]{1,40}$/;
const MAX_EXTRA_CARDS = 4;
const AX_CARD_TYPES = {
  white:    { name: 'Біла',       kind: 'debit · UAH',   desc: 'Окремий рахунок для щоденних витрат', chip: true, light: true,
              bg: 'radial-gradient(120% 90% at 0% 0%, #ffffff 0%, transparent 60%), linear-gradient(150deg, #f4f3f0 0%, #e4e2dc 100%)' },
  virtual:  { name: 'Віртуальна', kind: 'virtual · UAH', desc: 'Лише номер і CVV — для оплат онлайн', chip: false, light: false,
              bg: 'radial-gradient(90% 90% at 100% 0%, rgba(90,220,255,.55), transparent 60%), radial-gradient(80% 90% at 0% 100%, rgba(124,131,255,.6), transparent 60%), linear-gradient(135deg, #0d1330, #1a2150)' },
  graphite: { name: 'Графіт',     kind: 'debit · UAH',   desc: 'Стриманий металевий дизайн', chip: true, light: false,
              bg: 'repeating-linear-gradient(92deg, rgba(255,255,255,.03) 0 2px, transparent 2px 4px), linear-gradient(135deg, #3a3d46 0%, #1c1e24 55%, #2c2f37 100%)' },
};
const PARTNER_NAMES = { slotok: 'SlotOK' };

function digitsTail(n) { return String(n || '').replace(/\D/g, '').slice(-4) || '••••'; }
function partnersOf(u) {
  const p = (u && u.partners) || {};
  return Object.keys(p).filter((k) => KEY_RE.test(k) && p[k]).map((k) => ({ id: k, name: PARTNER_NAMES[k] || k, user: String(p[k].user || ''), linkedAt: p[k].linkedAt || 0 }));
}

function getCards() {
  const all = (userData && userData.cards) || {};
  const m = all.main || {};
  const out = [{
    id: 'main', main: true, title: 'Основна', kind: 'debit · UAH', chip: true,
    number: m.number, cvv: m.cvv, expiry: m.expiry, holder: m.holder,
    frozen: !!m.frozen, linked: partnersOf(userData).length > 0, dayLimit: Math.max(0, Number(m.dayLimit) || 0),
    balance: Number(m.balance) || 0, balPath: 'cards/main/balance', recPath: 'cards/main', skin: resolveSkin(m),
  }];
  Object.keys(all).filter((k) => k !== 'main' && KEY_RE.test(k) && all[k])
    .sort((a, b) => (all[a].createdAt || 0) - (all[b].createdAt || 0))
    .forEach((id) => {
      const c = all[id];
      const t = AX_CARD_TYPES[c.type] || AX_CARD_TYPES.white;
      const own = resolveSkin(c);
      out.push({
        id: id, main: false, title: t.name, kind: t.kind, chip: t.chip,
        number: c.number, cvv: c.cvv, expiry: c.expiry, holder: c.holder,
        frozen: !!c.frozen, linked: false, dayLimit: 0,
        balance: Number(c.balance) || 0, balPath: 'cards/' + id + '/balance', recPath: 'cards/' + id,
        skin: own || { name: t.name, bg: t.bg, dot: t.bg, light: t.light, builtin: true },
      });
    });
  return out;
}
function getCard(id) { return getCards().find((c) => c.id === id) || null; }
function selectedCard() { return getCard(_selId) || getCard('main'); }

function newCardData(holder) {
  const digits = genCardNumber('4874');
  const exp = new Date(Date.now() + 3 * 365 * 86400000);
  return {
    number: digits.replace(/(.{4})(?=.)/g, '$1 '),
    cvv: String(Math.floor(100 + Math.random() * 900)),
    expiry: ('0' + (exp.getMonth() + 1)).slice(-2) + '/' + String(exp.getFullYear()).slice(-2),
    holder: String(holder || 'USER').toUpperCase(),
  };
}

// ── Скіни карток (каталог — із SlotOK, skins.js) ──────────────────
// Картка зберігає skin (id із SLOTOK_SKINS) або 'custom-photo' +
// customPhotoUrl (JPEG data: URL, стиснутий до 500px). Проєкти-партнери
// читають ці ж поля через axioma-sdk.js.
const LIGHT_SKINS = { minimal: 1, ivory: 1 };
const PHOTO_RE = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const SKIN_BY_ID = {};
(typeof SLOTOK_SKINS !== 'undefined' ? SLOTOK_SKINS : []).forEach((s) => { SKIN_BY_ID[s.id] = s; });

// Фото й мем-скіни затемнюємо (як SlotOK), щоб текст читався; пласкі
// градієнти підсвічуємо акцентом скіна, інакше на великій картці вони
// виглядають майже чорними.
const PHOTO_SHADE = 'linear-gradient(rgba(0,0,0,.3), rgba(0,0,0,.52))';
function resolveSkin(vc) {
  if (vc.skin === 'custom-photo' && typeof vc.customPhotoUrl === 'string' && PHOTO_RE.test(vc.customPhotoUrl)) {
    const photo = 'center / cover no-repeat url("' + vc.customPhotoUrl + '")';
    return { name: 'Своє фото', bg: PHOTO_SHADE + ', ' + photo, dot: photo, light: false };
  }
  const s = SKIN_BY_ID[vc.skin];
  if (!s) return null;
  const light = !!LIGHT_SKINS[s.id];
  let bg = s.prev;
  if (s.prev.indexOf('url(') !== -1) bg = PHOTO_SHADE + ', ' + s.prev;
  else if (!light) bg = 'radial-gradient(95% 75% at 100% 0%, color-mix(in srgb, ' + s.accent + ' 34%, transparent), transparent 62%), ' + s.prev;
  return { name: s.name, bg: bg, dot: s.prev, light: light };
}

// ═══════════════════════════════════════════════════════════════════
// РЕНДЕР
// ═══════════════════════════════════════════════════════════════════
function render() {
  if (!userData) return;
  $('axUserNick').textContent = currentUser || '';
  renderCards();
  renderDetails();
  if (typeof renderSavings === 'function') renderSavings();
  if (typeof renderMore === 'function') renderMore();
}

// ── Карусель карток ────────────────────────────────────────────────
const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="11" width="17" height="10.5" rx="2.5"/><path d="M7.5 11V7a4.5 4.5 0 0 1 9 0v4"/></svg>';
const CONTACTLESS_SVG = '<svg class="contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8.5 8.5a5 5 0 0 1 0 7"/><path d="M12 6a8.5 8.5 0 0 1 0 12"/><path d="M15.5 3.5a12 12 0 0 1 0 17"/></svg>';

function cardTpl(c) {
  const frozen = '<div class="face-frozen">' + LOCK_SVG + '<span>Заблоковано</span></div>';
  const edges = [-1, -0.5, 0, 0.5, 1].map((z) => '<div class="card-edge" style="--z:' + z + '"></div>').join('');
  return '<div class="rail-slide" data-id="' + c.id + '">' +
    '<div class="card-stage">' +
      '<div class="card3d" role="button" tabindex="0" aria-pressed="false" aria-label="Картка ' + esc(c.title) + '. Натисни, щоб перевернути">' +
        '<div class="card3d-tilt"><div class="card3d-flip">' + edges +
          '<div class="face face-front">' +
            '<div class="face-skin" data-f="skin"></div><div class="face-glare"></div>' +
            '<div class="face-content">' +
              '<div class="fc-top"><div class="fc-bank">Аксіома<small>' + esc(c.kind) + '</small></div><div class="fc-badge" data-f="badge"></div></div>' +
              '<div class="fc-mid">' + (c.chip ? '<div class="chip"></div>' + CONTACTLESS_SVG : '<span class="fc-virtual">online only</span>') + '</div>' +
              '<div class="fc-number" data-f="number"></div>' +
              '<div class="fc-bottom">' +
                '<div><div class="fc-cap">Власник</div><div class="fc-val" data-f="holder"></div></div>' +
                '<div><div class="fc-cap">Діє до</div><div class="fc-val" data-f="expiry"></div></div>' +
                '<div class="fc-mark" aria-hidden="true">∴</div>' +
              '</div>' +
            '</div>' + frozen +
          '</div>' +
          '<div class="face face-back">' +
            '<div class="face-skin" data-f="skin"></div><div class="face-glare"></div>' +
            '<div class="back-stripe"></div>' +
            '<div class="back-body">' +
              '<div class="back-sign-row"><div class="back-sign" data-f="sign"></div><div class="back-cvv"><small>CVV</small><b data-f="cvv">•••</b></div></div>' +
              '<div class="back-fine">Картку випустив Аксіома Банк. Не передавай CVV нікому — навіть «підтримці».</div>' +
              '<div class="back-foot"><span>Аксіома Банк · 24/7</span><b aria-hidden="true">∴</b></div>' +
            '</div>' + frozen +
          '</div>' +
        '</div></div>' +
      '</div>' +
      '<div class="card-shadow"></div>' +
    '</div>' +
  '</div>';
}

let _railSig = '';
function renderCards() {
  const rail = $('axRail');
  const cards = getCards();
  if (_pendingSelId && cards.some((c) => c.id === _pendingSelId)) { _selId = _pendingSelId; _pendingSelId = null; }
  if (!cards.some((c) => c.id === _selId)) _selId = 'main';
  const sig = cards.map((c) => c.id).join('|');
  if (sig !== _railSig) {
    _railSig = sig;
    rail.innerHTML = cards.map(cardTpl).join('');
    rail.classList.toggle('is-single', cards.length === 1);
    requestAnimationFrame(() => scrollToCard(_selId, false));
  }
  cards.forEach((c) => {
    const slide = rail.querySelector('.rail-slide[data-id="' + c.id + '"]');
    if (!slide) return;
    const card = slide.querySelector('.card3d');
    const f = (name) => slide.querySelectorAll('[data-f="' + name + '"]');
    const holder = c.holder || String(currentUser || '').toUpperCase();
    f('number').forEach((el) => { el.textContent = c.number || '•••• •••• •••• ••••'; });
    f('holder').forEach((el) => { el.textContent = holder; });
    f('sign').forEach((el) => { el.textContent = holder; });
    f('expiry').forEach((el) => { el.textContent = c.expiry || '••/••'; });
    f('cvv').forEach((el) => { el.textContent = _cvvId === c.id ? (c.cvv || '•••') : '•••'; });
    const pn = c.main ? partnersOf(userData).map((p) => p.name).join(', ') : '';
    f('badge').forEach((el) => { el.innerHTML = pn ? '<span class="linked-badge">' + icon('check') + ' ' + esc(pn) + '</span>' : ''; });
    f('skin').forEach((el) => { el.style.background = c.skin ? c.skin.bg : ''; });
    card.classList.toggle('is-light', !!(c.skin && c.skin.light));
    card.classList.toggle('is-frozen', c.frozen);
    card.classList.toggle('is-flipped', !!_flippedIds[c.id]);
    card.setAttribute('aria-pressed', String(!!_flippedIds[c.id]));
    slide.classList.toggle('is-selected', c.id === _selId);
  });
  const dots = $('axDots');
  dots.innerHTML = cards.length > 1
    ? cards.map((c) => '<button class="dot' + (c.id === _selId ? ' is-on' : '') + '" data-id="' + c.id + '" aria-label="Картка ' + esc(c.title) + '"></button>').join('')
    : '';
  $('axCardsCount').textContent = cards.length + '/' + (MAX_EXTRA_CARDS + 1);
}

function scrollToCard(id, smooth) {
  const rail = $('axRail');
  const slide = rail.querySelector('.rail-slide[data-id="' + id + '"]');
  if (!slide) return;
  rail.scrollTo({ left: slide.offsetLeft - (rail.clientWidth - slide.clientWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
}

function selectCard(id) {
  if (id === _selId || !getCard(id)) return;
  _selId = id;
  if (_cvvId && _cvvId !== id) hideCvv();
  renderCards();
  renderDetails();
}

let _railScrollFrame = 0;
function onRailScroll() {
  cancelAnimationFrame(_railScrollFrame);
  _railScrollFrame = requestAnimationFrame(() => {
    const rail = $('axRail');
    const center = rail.scrollLeft + rail.clientWidth / 2;
    let best = null, bestDist = Infinity;
    rail.querySelectorAll('.rail-slide').forEach((s) => {
      const d = Math.abs(s.offsetLeft + s.clientWidth / 2 - center);
      if (d < bestDist) { bestDist = d; best = s.dataset.id; }
    });
    if (best) selectCard(best);
  });
}

// ── Деталі вибраної картки ─────────────────────────────────────────
function renderDetails() {
  const c = selectedCard();
  if (!c) return;
  $('axCardTitle').textContent = c.title + ' · ' + digitsTail(c.number);
  const st = $('axStatus');
  st.textContent = c.frozen ? 'Заблокована' : 'Активна';
  st.classList.toggle('is-frozen', c.frozen);
  $('axBalance').textContent = fmt(c.balance);
  const skinName = c.skin && !c.skin.builtin ? 'Скін «' + c.skin.name + '»' : 'Стандартний дизайн';
  $('axSkinChip').innerHTML =
    '<span class="skin-dot" style="background:' + esc(c.skin ? c.skin.dot : 'linear-gradient(135deg,#6b5cff,#c06bff)') + '"></span>' +
    esc(skinName + (c.main ? ' · видно й у підключених проєктах' : ' · лише Аксіома')) + '<span class="skin-edit">Змінити</span>';

  const btn = (fn, ic, label, on) =>
    '<button class="action-btn' + (on ? ' is-on' : '') + '" onclick="' + fn + '()"><span class="ai">' + icon(ic) + '</span><span>' + label + '</span></button>';
  $('axActions').innerHTML =
    btn('axOpenTransferMenu', 'swap', 'Переказ', false) +
    btn('axToggleCvv', _cvvId === c.id ? 'eyeOff' : 'eye', _cvvId === c.id ? 'Сховати' : 'CVV', _cvvId === c.id) +
    btn('axToggleFreeze', c.frozen ? 'unlock' : 'lock', c.frozen ? 'Розблок.' : 'Блок', c.frozen) +
    btn('axOpenCardSettings', 'sliders', 'Картка', false);

  const txs = txListFor(c);
  const now = new Date();
  let mIn = 0, mOut = 0;
  txs.forEach((t) => {
    const d = new Date(t.ts || 0);
    if (t.own || d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return;
    if (txDir(t) === 'in') mIn += Math.abs(t.amount || 0); else mOut += Math.abs(t.amount || 0);
  });
  $('axMonthName').textContent = now.toLocaleString('uk-UA', { month: 'long' });
  $('axMonthIn').textContent = '+' + fmt(mIn) + ' ₴';
  $('axMonthOut').textContent = '−' + fmt(mOut) + ' ₴';

  $('axLinkPanel').classList.toggle('hidden', !c.main);
  if (c.main) renderLinkPanel();
  $('axTxList').innerHTML = txs.length ? txs.slice(0, 6).map(txRow).join('') : '<div class="muted">Операцій ще немає</div>';
}

// ── Дії з карткою ──────────────────────────────────────────────────
function hideCvv() {
  if (_cvvTimer) { clearTimeout(_cvvTimer); _cvvTimer = null; }
  _cvvId = null;
}
// CVV живе на звороті — показуючи його, одразу перевертаємо картку.
function axToggleCvv() {
  const c = selectedCard();
  if (_cvvId === c.id) { hideCvv(); render(); return; }
  hideCvv();
  _cvvId = c.id;
  _flippedIds[c.id] = true;
  _cvvTimer = setTimeout(() => { _cvvId = null; _cvvTimer = null; render(); }, 10000);
  render();
}

function flipCard(id) {
  _flippedIds[id] = !_flippedIds[id];
  askMotionPermission();
  renderCards();
}

async function axToggleFreeze() {
  const c = selectedCard();
  try {
    await db.ref('users/' + currentUid + '/' + c.recPath + '/frozen').set(!c.frozen);
    toast(c.frozen ? 'Картку розблоковано' : 'Картку заблоковано — переказувати з неї не можна', c.frozen ? 'success' : 'info');
  } catch (e) {
    console.error(e);
    toast('Не вдалося змінити стан картки. Спробуйте ще раз.', 'error');
  }
}

function axCopyNumber(id) {
  const c = getCard(id || _selId);
  const num = String((c && c.number) || '').replace(/\s/g, '');
  if (!/^[0-9]{12,19}$/.test(num)) return;
  if (!navigator.clipboard) { toast('Копіювання недоступне в цьому браузері', 'error'); return; }
  navigator.clipboard.writeText(num).then(() => toast('Номер скопійовано', 'success'), () => toast('Не вдалося скопіювати', 'error'));
}

// ── 3D: фліп + нахил за курсором / гіроскопом ───────────────────────
let _tiltFrame = 0, _tiltStage = null;
function setTilt(stage, px, py) {
  const card = stage.querySelector('.card3d');
  px = Math.max(0, Math.min(1, px)); py = Math.max(0, Math.min(1, py));
  cancelAnimationFrame(_tiltFrame);
  _tiltFrame = requestAnimationFrame(() => {
    card.style.setProperty('--ry', ((px - 0.5) * 24).toFixed(2) + 'deg');
    card.style.setProperty('--rx', ((0.5 - py) * 20).toFixed(2) + 'deg');
    card.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
    card.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
    stage.style.setProperty('--shadow-x', ((0.5 - px) * 30).toFixed(1));
    card.classList.add('is-tilting');
  });
}
function resetTilt(stage) {
  if (!stage) return;
  const card = stage.querySelector('.card3d');
  cancelAnimationFrame(_tiltFrame);
  card.classList.remove('is-tilting');
  ['--rx', '--ry', '--gx', '--gy'].forEach((p) => card.style.removeProperty(p));
  stage.style.removeProperty('--shadow-x');
}
function selectedStage() {
  const s = $('axRail').querySelector('.rail-slide[data-id="' + _selId + '"] .card-stage');
  return s || null;
}
function onDeviceTilt(e) {
  if (e.gamma == null || e.beta == null) return;
  const stage = selectedStage();
  if (!stage) return;
  // Телефон зазвичай тримають під ~45° — це і є "рівне" положення.
  setTilt(stage, 0.5 + Math.max(-0.5, Math.min(0.5, e.gamma / 50)), 0.5 + Math.max(-0.5, Math.min(0.5, (e.beta - 45) / 50)));
}
// iOS дає гіроскоп лише після явного дозволу з жесту користувача.
let _motionAsked = false;
function askMotionPermission() {
  if (_motionAsked) return;
  _motionAsked = true;
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((r) => {
      if (r === 'granted') window.addEventListener('deviceorientation', onDeviceTilt);
    }).catch(() => {});
  }
}

function initCards() {
  const rail = $('axRail');
  const activate = (target) => {
    const slide = target.closest('.rail-slide');
    if (!slide) return;
    if (slide.dataset.id === _selId) flipCard(slide.dataset.id);
    else scrollToCard(slide.dataset.id, true);
  };
  rail.addEventListener('click', (e) => { if (e.target.closest('.card3d')) activate(e.target); });
  rail.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.card3d')) { e.preventDefault(); activate(e.target); }
  });
  rail.addEventListener('scroll', onRailScroll, { passive: true });
  $('axDots').addEventListener('click', (e) => {
    const d = e.target.closest('.dot');
    if (d) scrollToCard(d.dataset.id, true);
  });
  window.addEventListener('resize', () => scrollToCard(_selId, false));

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  rail.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const stage = e.target.closest('.card-stage');
    if (stage !== _tiltStage) { resetTilt(_tiltStage); _tiltStage = stage; }
    if (!stage) return;
    const r = stage.querySelector('.card3d').getBoundingClientRect();
    setTilt(stage, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  });
  rail.addEventListener('pointerleave', () => { resetTilt(_tiltStage); _tiltStage = null; });
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission !== 'function') {
    window.addEventListener('deviceorientation', onDeviceTilt);
  }
}

// ── Підключені проєкти (лише основна картка) ────────────────────────
// Проєкт підключається сам: гравець входить у свій акаунт Аксіоми прямо в
// ньому (SlotOK → Каса → Аксіома), і проєкт записує себе в partners/<id>.
function renderLinkPanel() {
  const el = $('axLinkBody');
  if (!el) return;
  const list = partnersOf(userData);
  el.innerHTML = (list.length
    ? list.map((p) =>
        '<div class="partner-row"><span class="linked-badge">' + icon('check') + ' ' + esc(p.name) + '</span>' +
        '<span class="partner-sub">як @' + esc(p.user) + '</span>' +
        '<button class="link-btn" onclick="axUnlinkPartner(\'' + p.id + '\')">Відключити</button></div>'
      ).join('') +
      '<p class="code-hint" style="margin:12px 0 0;">Поповнюй гру з картки й виводь виграш назад прямо в проєкті. Блокування й денний ліміт картки діють і там.</p>'
    : '<p class="code-hint" style="margin:0;">Щоб грати з цією карткою в SlotOK, відкрий у SlotOK <b>Каса → Аксіома</b> і увійди туди своїм ніком і паролем Аксіоми.</p>');
}

async function axUnlinkPartner(id) {
  if (!KEY_RE.test(id)) return;
  try {
    await db.ref('users/' + currentUid + '/partners/' + id).remove();
    toast((PARTNER_NAMES[id] || id) + ' відключено від картки', 'success');
  } catch (e) {
    console.error(e);
    toast('Не вдалося відключити. Спробуй ще раз', 'error');
  }
}

// ── Виписка ────────────────────────────────────────────────────────
// Усі операції — users/<uid>/tx з полем acct: id картки або 'jar:<id>'.
function txOf(acct) {
  return Object.values((userData && userData.tx) || {})
    .filter((t) => t && t.acct === acct)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
function txListFor(c) { return txOf(c.id); }
function txDir(t) { return t.dir || ((t.amount || 0) > 0 ? 'in' : 'out'); }
function txRow(t) {
  const isIn = txDir(t) === 'in';
  const date = new Date(t.ts || Date.now()).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const sub = [t.subtitle, date].filter(Boolean).join(' · ');
  return '<div class="tx">' +
    '<div class="tx-icn ' + (isIn ? 'in' : 'out') + '">' + icon(isIn ? 'inflow' : 'outflow') + '</div>' +
    '<div class="tx-main"><div class="tx-title">' + esc(t.title || (isIn ? 'Надходження' : 'Списання')) + '</div>' +
      '<div class="tx-sub">' + esc(sub) + '</div></div>' +
    '<div class="tx-amt ' + (isIn ? 'in' : 'out') + '">' + (isIn ? '+' : '−') + fmt(Math.abs(t.amount || 0)) + ' ₴</div>' +
    '</div>';
}
// Запис в історію власного рахунку.
function pushTx(acct, tx) {
  return db.ref('users/' + currentUid + '/tx').push(Object.assign({ acct: acct, ts: Date.now() }, tx));
}
function axShowAllTx() {
  const c = selectedCard();
  const txs = txListFor(c).slice(0, 150);
  openSheet('Операції · ' + c.title + ' ' + digitsTail(c.number),
    '<div class="sheet-flush">' + (txs.length ? txs.map(txRow).join('') : '<div class="muted">Операцій ще немає</div>') + '</div>');
}

// ── Старт ──────────────────────────────────────────────────────────
// Firebase Auth сам пам'ятає вхід; поки він не відповів, екран входу
// не показуємо, щоб не блимав.
window.addEventListener('DOMContentLoaded', () => {
  initCards();
  if (typeof initBank === 'function') initBank();
  if (typeof initSocial === 'function') initSocial();
  setAuthMode('login');
  if (!auth) { $('authScreen').classList.remove('hidden'); return; }
  auth.onAuthStateChanged((user) => {
    if (_authBusy) return;
    if (!user) { if (!currentUid) $('authScreen').classList.remove('hidden'); return; }
    if (currentUid === user.uid) return;
    startSession(user).catch((e) => {
      console.error(e);
      $('authScreen').classList.remove('hidden');
      toast('Не вдалося відкрити рахунок. Увійди ще раз', 'error');
    });
  });
});
