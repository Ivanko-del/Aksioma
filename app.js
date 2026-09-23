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
    auth.signInAnonymously().catch((e) => {
      // Якщо Anonymous Auth не увімкнено в консолі Firebase (або мережа
      // недоступна) — не блокуємо вхід назавжди, а деградуємо до старої
      // поведінки без authUid-прив'язки. Захист із п.1/2 у цьому разі не діє.
      console.error('Anonymous auth failed — сесія працюватиме БЕЗ authUid-захисту:', e);
      _authReadyResolve(null);
    });
  });
} else {
  _authReadyResolve(null);
}

let currentUser = null;
let userData = null;
let _cvvId = null;     // картка, в якої зараз видно CVV
let _cvvTimer = null;
let _codeTimer = null;
let _creatingCard = false;
let _generatingCode = false;
let _flippedIds = {};  // id картки → перевернута
let _selId = 'axiom';  // вибрана в каруселі картка
let _pendingSelId = null; // щойно відкрита картка, яку виберемо, коли вона приїде з бази
let _activeCode = null; // { code, ts } — поки код не спожито/не протух

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
  _cvvId = null;
  _activeCode = null;
  _flippedIds = {};
  _selId = 'axiom';
  _pendingSelId = null;
  _railSig = '';
  $('axRail').innerHTML = '';
  if (typeof closeSheet === 'function') closeSheet();
  if (typeof unwatchReferrals === 'function') unwatchReferrals();
  if (typeof _indexedSig !== 'undefined') _indexedSig = '';
  $('onboardScreen').classList.add('hidden');
  $('obForm').reset();
  if (typeof setTab === 'function') setTab('cards');
  localStorage.removeItem('axioma_nick');
  currentUser = null; userData = null;
  $('appScreen').classList.add('hidden');
  $('authScreen').classList.remove('hidden');
  $('authPass').value = '';
}

function enterApp(nick) {
  currentUser = nick;
  $('authScreen').classList.add('hidden');
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
    // Рахунок в Аксіомі відкривається лише після ПІБ і згоди з правилами.
    if (!userData.axiomProfile) { showOnboarding(); return; }
    if (!$('onboardScreen').classList.contains('hidden')) hideOnboarding();
    $('appScreen').classList.remove('hidden');
    ensureCard().then(() => { render(); afterSync(); });
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

// ═══════════════════════════════════════════════════════════════════
// КАРТКИ
// Основна картка ('axiom') — це users/<nick>/virtualCard, її бачить SlotOK.
// Додаткові — users/<nick>/axiomCards/<id>: окремі рахунки, про які SlotOK
// не знає. Баланс основної — проєкція мультикарткової моделі SlotOK: коли
// вона активна в SlotOK, живі гроші лежать у users/<nick>/balance.
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

function cardIdsOf(u) {
  const ids = [];
  if (u && u.virtualCard && u.virtualCard.axiomLinked) ids.push('axiom');
  if (u && u.linkedCards) Object.keys(u.linkedCards).forEach((k) => ids.push(k));
  return ids;
}
function activeCardIdOf(u) {
  const ids = cardIdsOf(u);
  if (!ids.length) return null;
  return (u.activeCardId && ids.indexOf(u.activeCardId) >= 0) ? u.activeCardId : ids[0];
}
// Той самий вибір, що cardBalancePath() у SlotOK.
function mainBalPath(u) { return activeCardIdOf(u) === 'axiom' ? 'balance' : 'virtualCard/balance'; }
function cardBalance() {
  const u = userData || {};
  return mainBalPath(u) === 'balance' ? (Number(u.balance) || 0) : (Number((u.virtualCard || {}).balance) || 0);
}
function digitsTail(n) { return String(n || '').replace(/\D/g, '').slice(-4) || '••••'; }

function getCards() {
  const u = userData || {};
  const vc = u.virtualCard || {};
  const out = [{
    id: 'axiom', main: true, title: 'Основна', kind: 'debit · UAH', chip: true,
    number: vc.number, cvv: vc.cvv, expiry: vc.expiry, holder: vc.holder,
    frozen: !!vc.frozen, linked: !!vc.axiomLinked, dayLimit: Math.max(0, Number(vc.dayLimit) || 0),
    balance: cardBalance(), balPath: mainBalPath(u), recPath: 'virtualCard', skin: resolveSkin(vc),
  }];
  const extra = u.axiomCards || {};
  Object.keys(extra).filter((k) => KEY_RE.test(k) && extra[k])
    .sort((a, b) => (extra[a].createdAt || 0) - (extra[b].createdAt || 0))
    .forEach((id) => {
      const c = extra[id];
      const t = AX_CARD_TYPES[c.type] || AX_CARD_TYPES.white;
      out.push({
        id: id, main: false, title: t.name, kind: t.kind, chip: t.chip,
        number: c.number, cvv: c.cvv, expiry: c.expiry, holder: c.holder,
        frozen: !!c.frozen, linked: false, dayLimit: 0,
        balance: Number(c.balance) || 0, balPath: 'axiomCards/' + id + '/balance', recPath: 'axiomCards/' + id,
        skin: { name: t.name, bg: t.bg, light: t.light, builtin: true },
      });
    });
  return out;
}
function getCard(id) { return getCards().find((c) => c.id === id) || null; }
function selectedCard() { return getCard(_selId) || getCard('axiom'); }

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

// ── Скін основної картки зі SlotOK ─────────────────────────────────
// SlotOK зберігає users/<nick>/virtualCard/skin (id з SLOTOK_SKINS) або
// 'custom-photo' + customPhotoUrl (JPEG data: URL, стиснутий до 500px).
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
  if (!cards.some((c) => c.id === _selId)) _selId = 'axiom';
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
    f('badge').forEach((el) => { el.innerHTML = c.linked ? '<span class="linked-badge">' + icon('check') + ' SlotOK</span>' : ''; });
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
  $('axSkinChip').innerHTML = c.main
    ? (c.skin
        ? '<span class="skin-dot" style="background:' + esc(c.skin.dot) + '"></span>Скін «' + esc(c.skin.name) + '» зі SlotOK'
        : '<span class="skin-dot" style="background:linear-gradient(135deg,#6b5cff,#c06bff)"></span>Стандартний дизайн · скін змінюється в SlotOK')
    : '<span class="skin-dot" style="background:' + esc(c.skin.bg) + '"></span>Працює лише в Аксіомі';

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
    await db.ref('users/' + currentUser + '/' + c.recPath + '/frozen').set(!c.frozen);
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

// ── Панель підключення до SlotOK (лише основна картка) ─────────────
const CODE_TTL = 10 * 60 * 1000;

function renderLinkPanel() {
  const el = $('axLinkBody');
  if (!el) return;
  const vc = userData.virtualCard || {};
  if (vc.axiomLinked) {
    el.innerHTML =
      '<div class="linked-badge">' + icon('check') + ' Картку підключено до SlotOK</div>' +
      '<p class="code-hint" style="margin:12px 0 0;">Баланс і виписка синхронізуються між Аксіомою та SlotOK. ' +
      'Заморозка й денний ліміт діють в обох застосунках.</p>';
    return;
  }
  if (_activeCode && Date.now() - _activeCode.ts < CODE_TTL) {
    showCode(_activeCode.code, _activeCode.ts);
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
    _activeCode = { code: code, ts: ts };
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
  if (!el) return;
  el.innerHTML =
    '<div class="code-box">' +
      '<div class="code-value" aria-label="Код ' + esc(code) + '">' +
        String(code).split('').map((d) => '<span>' + esc(d) + '</span>').join('') + '</div>' +
      '<div class="code-timer">Дійсний ще <b id="axCodeLeft">10:00</b></div>' +
      '<p class="code-hint">У SlotOK: <b>Каса → Підключити картку → Аксіома</b>, введи цей код.</p>' +
      '<button class="btn btn-quiet btn-block" onclick="axGenerateCode()">Згенерувати новий</button>' +
    '</div>';
  if (_codeTimer) clearInterval(_codeTimer);
  const tick = () => {
    const left = CODE_TTL - (Date.now() - ts);
    const lEl = $('axCodeLeft');
    if (!lEl) { clearInterval(_codeTimer); return; }
    if (left <= 0) {
      clearInterval(_codeTimer);
      _activeCode = null;
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

// Слухаємо код: коли SlotOK його спожив (used=true) — оновлюємо панель.
function watchLinkCode() {
  db.ref('axiomLinkCodes/' + currentUser).on('value', (snap) => {
    const d = snap.val();
    if (d && d.used) {
      db.ref('axiomLinkCodes/' + currentUser).off();
      if (_codeTimer) clearInterval(_codeTimer);
      _activeCode = null;
      db.ref('axiomLinkCodes/' + currentUser).remove().catch((e) => console.error(e));
      toast('Картку підключено до SlotOK', 'success');
      renderLinkPanel();
    }
  });
}

// ── Виписка ────────────────────────────────────────────────────────
// Основна картка: users/<nick>/cardTx (спільна зі SlotOK; запис без cardId
// SlotOK теж вважає належним кожній картці). Додаткові картки й скарбнички:
// users/<nick>/axiomTx — SlotOK його не показує.
function txListFor(c) {
  const src = c.main ? (userData.cardTx || {}) : (userData.axiomTx || {});
  return Object.values(src)
    .filter((t) => t && (c.main ? (!t.cardId || t.cardId === 'axiom') : t.acct === c.id))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
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
function axShowAllTx() {
  const c = selectedCard();
  const txs = txListFor(c).slice(0, 150);
  openSheet('Операції · ' + c.title + ' ' + digitsTail(c.number),
    '<div class="sheet-flush">' + (txs.length ? txs.map(txRow).join('') : '<div class="muted">Операцій ще немає</div>') + '</div>');
}

// ── Автовхід за збереженою сесією ───────────────────────────────────
// localStorage.axioma_nick сам по собі нічого не важить: автовхід
// спрацьовує, лише якщо users/<nick>/authUid збігається з anon UID цього
// браузера (тобто пароль тут уже перевіряли раніше, через axLogin).
window.addEventListener('DOMContentLoaded', async () => {
  initCards();
  if (typeof initBank === 'function') initBank();
  if (typeof initSocial === 'function') initSocial();
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
