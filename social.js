// ═══════════════════════════════════════════════════════════════════
// Аксіома Банк — відкриття рахунку (ПІБ + правила), правила/політика,
// переказ іншому гравцю, реферальна програма.
// Спирається на app.js і bank.js.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const RULES_VERSION = 2;
const REF_BONUS = 100;
const REF_MAX = 50;                          // скільки друзів максимум оплачуємо
const REF_NEW_USER_MS = 7 * 86400000;        // «новий» = акаунт Аксіоми, молодший за 7 днів (перевіряють і правила бази)
const P2P_MIN = 10;
const NAME_RE = /^[A-Za-zА-ЯҐЄІЇа-яґєії]+(?:['’ʼ-][A-Za-zА-ЯҐЄІЇа-яґєії]+)*$/;

// ═══════════════════════════════════════════════════════════════════
// ПРАВИЛА Й ПОЛІТИКА
// ═══════════════════════════════════════════════════════════════════
const RULES = [
  ['Що таке Аксіома',
   'Аксіома — ігровий застосунок-симулятор банку для розважальних проєктів, зокрема SlotOK. Аксіома не є банком, фінансовою чи платіжною установою, не має ліцензії Національного банку України й не надає фінансових послуг.'],
  ['Усі гроші віртуальні',
   'Баланси, картки, перекази, скарбнички й бонуси в Аксіомі — віртуальні ігрові одиниці. Вони не мають грошової вартості, не обмінюються на справжні гроші, товари чи послуги й не виводяться на справжні картки чи рахунки. Позначка «₴» — лише ігрова умовність.'],
  ['Картки несправжні',
   'Номери карток, CVV і терміни дії в Аксіомі згенеровані для гри й не працюють у жодній справжній платіжній системі. Ніколи не вводь тут дані своїх справжніх банківських карток.'],
  ['Акаунт і персональні дані',
   'Акаунт Аксіоми окремий від акаунтів у проєктах-партнерах. Прізвище, ім’я та по батькові зберігаються в базі даних Аксіоми (Firebase) — доступ до них має лише власник акаунта. Іншим гравцям показуємо тільки ім’я та першу літеру прізвища, щоб відправник переказу бачив, кому надсилає.'],
  ['Проєкти-партнери',
   'Проєкт-партнер (наприклад, SlotOK) підключається до основної картки, коли ти входиш у свій акаунт Аксіоми в ньому. Після цього він може поповнювати гру з картки й виводити гроші на неї. Відключити проєкт можна в Аксіомі будь-коли.'],
  ['Перекази',
   'Переказ іншому гравцю не скасовується. Перед відправкою перевір ім’я отримувача. Переказувати можна з картки, яка не заблокована, у межах денного ліміту основної картки.'],
  ['Реферальна програма',
   'За кожного друга, який створив новий акаунт Аксіоми й під час відкриття рахунку вказав твій нік, ти отримуєш ' + REF_BONUS + ' віртуальних ₴ на основну картку. Новим вважається акаунт, створений не раніше ніж за 7 днів. Максимум — ' + REF_MAX + ' друзів. Бонуси за штучно створені акаунти можуть бути анульовані.'],
  ['Безпека акаунта',
   'Не передавай нікому пароль чи CVV. Підтримка ніколи їх не питає.'],
  ['Зміни правил',
   'Правила можуть оновлюватися. Користуючись Аксіомою, ти погоджуєшся з актуальною версією.'],
];

function rulesHtml() {
  return '<div class="rules">' +
    '<div class="rules-flag">Аксіома — не банк. Усі кошти віртуальні.</div>' +
    RULES.map((r, i) => '<section class="rules-item"><h3>' + (i + 1) + '. ' + esc(r[0]) + '</h3><p>' + esc(r[1]) + '</p></section>').join('') +
    '<p class="form-note">Версія правил ' + RULES_VERSION + '</p>' +
  '</div>';
}
function openRules() { openSheet('Правила й політика', rulesHtml()); }

// ═══════════════════════════════════════════════════════════════════
// ВІДКРИТТЯ РАХУНКУ: ПІБ + згода з правилами (+ код запрошення)
// ═══════════════════════════════════════════════════════════════════
// «мар'яненко-коваль» → «Мар'яненко-Коваль»: велика літера на початку й після дефіса.
function normName(s) {
  s = String(s || '').trim().replace(/\s+/g, '').toLowerCase();
  return s.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
}
function displayNameOf(p) {
  if (!p || !p.firstName) return '';
  return p.firstName + (p.lastName ? ' ' + p.lastName.charAt(0) + '.' : '');
}
function fullNameOf(p) {
  return p ? [p.lastName, p.firstName, p.middleName].filter(Boolean).join(' ') : '';
}
function isNewAccount(u) {
  const c = Number((u || {}).createdAt) || 0;
  return c > 0 && Date.now() - c <= REF_NEW_USER_MS;
}
function savedRef() {
  try { return localStorage.getItem('axioma_ref') || ''; } catch (e) { return ''; }
}

function showOnboarding() {
  const scr = $('onboardScreen');
  $('appScreen').classList.add('hidden');
  if (!scr.classList.contains('hidden')) return; // уже відкрито — не затираємо введене
  scr.classList.remove('hidden');
  const canInvite = isNewAccount(userData);
  const ref = savedRef();
  $('obNick').textContent = currentUser || '';
  $('obInviteWrap').classList.toggle('hidden', !canInvite);
  $('obInvite').value = canInvite && ref !== currentUser ? ref : '';
  const pre = typeof _prefillProfile !== 'undefined' ? _prefillProfile : null;
  $('obLast').value = pre ? pre.lastName : '';
  $('obFirst').value = pre ? pre.firstName : '';
  $('obMiddle').value = pre ? pre.middleName : '';
  $('obMigrated').classList.toggle('hidden', !(userData && userData.migratedFrom));
  $('obErr').textContent = '';
  $('obLast').focus();
}
function hideOnboarding() { $('onboardScreen').classList.add('hidden'); }

async function submitOnboarding(e) {
  e.preventDefault();
  const err = $('obErr');
  err.textContent = '';
  const last = normName($('obLast').value), first = normName($('obFirst').value), middle = normName($('obMiddle').value);
  const bad = [[last, 'прізвище'], [first, 'ім’я'], [middle, 'по батькові']].find((x) => !x[0] || x[0].length < 2 || x[0].length > 30 || !NAME_RE.test(x[0]));
  if (bad) { err.textContent = 'Перевір ' + bad[1] + ': лише літери, апостроф або дефіс, від 2 до 30 символів'; return; }
  if (!$('obAgree').checked) { err.textContent = 'Щоб відкрити рахунок, погодься з правилами'; return; }

  const btn = $('obBtn');
  btn.disabled = true; btn.textContent = 'Відкриваємо рахунок…';
  try {
    let invitedBy = '';
    const inv = $('obInvite').value.trim().replace(/^@/, '');
    if (inv && isNewAccount(userData)) {
      if (inv === currentUser) { err.textContent = 'Не можна запросити самого себе'; return; }
      if (!NICK_PATH_RE.test(inv)) { err.textContent = 'Код запрошення — це нік друга'; return; }
      const pubSnap = await db.ref('public/' + handleOf(inv) + '/name').once('value');
      if (!pubSnap.exists()) { err.textContent = 'Клієнта Аксіоми з ніком «' + inv + '» не знайдено. Перевір нік або залиш поле порожнім'; return; }
      invitedBy = handleOf(inv);
    }
    const profile = { lastName: last, firstName: first, middleName: middle, rulesVersion: RULES_VERSION, acceptedRulesAt: Date.now() };
    if (invitedBy) profile.invitedBy = invitedBy;
    await db.ref('public/' + handleOf(currentUser)).set({ name: displayNameOf(profile) });
    // Порядок важливий: правило на referrals звіряє profile.invitedBy, тож профіль — першим.
    // Профіль записуємо останнім кроком listener'а, тому тут без update на весь users/<uid>.
    await db.ref('users/' + currentUid + '/profile').set(profile);
    if (invitedBy) {
      try { await db.ref('referrals/' + invitedBy + '/' + handleOf(currentUser)).set({ ts: firebase.database.ServerValue.TIMESTAMP }); }
      catch (ex) { console.error('referral:', ex); }
    }
    try { localStorage.removeItem('axioma_ref'); } catch (ex) { /* неважливо */ }
    if (typeof _prefillProfile !== 'undefined') _prefillProfile = null;
    toast('Рахунок відкрито. Вітаємо в Аксіомі, ' + first + '!', 'success');
  } catch (ex) {
    console.error(ex);
    err.textContent = 'Не вдалося відкрити рахунок. Перевір зʼєднання й спробуй ще раз';
  } finally {
    btn.disabled = false; btn.textContent = 'Відкрити рахунок';
  }
}

// ═══════════════════════════════════════════════════════════════════
// ІНДЕКС КАРТОК: номер → власник (для переказів за номером).
// Правила бази дають писати в запис лише власнику картки.
// ═══════════════════════════════════════════════════════════════════
let _indexedSig = '';
function syncCardIndex() {
  if (!db || !currentUid) return;
  const cards = getCards().filter((c) => /^\d{16}$/.test(String(c.number || '').replace(/\D/g, '')));
  const sig = cards.map((c) => c.id + ':' + c.number).join('|');
  if (sig === _indexedSig) return;
  _indexedSig = sig;
  cards.forEach((c) => {
    db.ref('cardIndex/' + String(c.number).replace(/\D/g, '')).set({ uid: currentUid, handle: handleOf(currentUser), card: c.id })
      .catch((e) => console.error('card index:', e));
  });
}
function unindexCard(number) {
  const d = String(number || '').replace(/\D/g, '');
  if (d.length === 16) db.ref('cardIndex/' + d).remove().catch((e) => console.error(e));
}

// Повертає { uid, nick, card, name } або null.
async function resolveCard(digits) {
  const hit = (await db.ref('cardIndex/' + digits).once('value')).val();
  if (!hit || typeof hit.uid !== 'string' || !/^[a-z2-7]{1,64}$/.test(String(hit.handle || '')) || !KEY_RE.test(String(hit.card || ''))) return null;
  const nick = nickFromHandle(hit.handle);
  if (!nick) return null;
  const pub = (await db.ref('public/' + hit.handle + '/name').once('value')).val();
  return { uid: hit.uid, nick: nick, card: hit.card, name: typeof pub === 'string' ? pub.slice(0, 40) : '' };
}

// ═══════════════════════════════════════════════════════════════════
// ПЕРЕКАЗ ІНШОМУ ГРАВЦЮ
// Чужий рахунок напряму не чіпаємо: відправник списує зі своєї картки й
// кладе переказ у inbox/<uid отримувача>. Отримувач сам забирає вхідні на
// свою картку, щойно відкриє Аксіому (або проєкт-партнер з його входом).
// ═══════════════════════════════════════════════════════════════════
function axOpenTransferMenu() {
  openSheet('Переказ',
    '<div class="choice">' +
      '<button class="choice-row" onclick="openP2P()"><span class="mi">' + icon('user') + '</span>' +
        '<span class="menu-txt"><b>Іншому гравцю</b><small>За номером картки Аксіоми</small></span><span class="chev">' + icon('chevron') + '</span></button>' +
      '<button class="choice-row" onclick="openTransfer({from:\'card:\' + _selId})"><span class="mi">' + icon('swap') + '</span>' +
        '<span class="menu-txt"><b>Між своїми рахунками</b><small>Картки й скарбнички</small></span><span class="chev">' + icon('chevron') + '</span></button>' +
    '</div>');
}

function formatCardInput(v) {
  return String(v || '').replace(/\D/g, '').slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ');
}

function openP2P(prefill) {
  const cards = getCards();
  const sel = getCard(_selId) ? _selId : 'main';
  const m = openSheet('Переказ гравцю',
    '<form class="form" id="axP2PForm" novalidate>' +
      '<label class="field-label" for="axP2PFrom">З картки</label>' +
      '<select id="axP2PFrom" class="select">' + cards.map((c) =>
        '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' +
          esc((c.main ? 'Основна' : c.title) + ' ' + digitsTail(c.number) + ' — ' + fmt(c.balance) + ' ₴') + (c.frozen ? ' (заблоковано)' : '') + '</option>'
      ).join('') + '</select>' +
      '<label class="field-label" for="axP2PCard">Номер картки отримувача</label>' +
      '<input id="axP2PCard" class="mono" inputmode="numeric" autocomplete="off" placeholder="0000 0000 0000 0000" value="' + esc(formatCardInput(prefill)) + '">' +
      '<div class="recipient" id="axP2PWho" aria-live="polite"></div>' +
      '<label class="field-label" for="axP2PAmount">Сума, ₴</label>' +
      '<input id="axP2PAmount" inputmode="decimal" autocomplete="off" placeholder="Від ' + P2P_MIN + '">' +
      '<label class="field-label" for="axP2PNote">Коментар (необовʼязково)</label>' +
      '<input id="axP2PNote" maxlength="60" autocomplete="off" placeholder="Напр. за піцу">' +
      '<div class="form-note" id="axP2PMsg"></div>' +
      '<button type="submit" class="btn btn-primary btn-block" id="axP2PBtn" disabled>Надіслати</button>' +
    '</form>');
  const cardEl = m.querySelector('#axP2PCard'), who = m.querySelector('#axP2PWho'), btn = m.querySelector('#axP2PBtn');
  const amtEl = m.querySelector('#axP2PAmount'), fromEl = m.querySelector('#axP2PFrom'), msg = m.querySelector('#axP2PMsg');
  let recipient = null, lookupSeq = 0;

  const refreshBtn = () => {
    const a = parseAmount(amtEl.value);
    btn.disabled = !recipient || !(a >= P2P_MIN);
    btn.textContent = recipient && a >= P2P_MIN ? 'Надіслати ' + fmt(a) + ' ₴' : 'Надіслати';
    const c = getCard(fromEl.value);
    let t = c ? 'Доступно ' + fmt(c.balance) + ' ₴' : '';
    if (c && c.main && mainLimitLeft() !== Infinity) t += ' · денний ліміт: лишилось ' + fmt(mainLimitLeft()) + ' ₴';
    msg.textContent = t;
  };
  const lookup = async () => {
    const digits = cardEl.value.replace(/\D/g, '');
    recipient = null;
    refreshBtn();
    if (digits.length < 16) { who.innerHTML = ''; return; }
    const own = getCards().find((c) => String(c.number || '').replace(/\D/g, '') === digits);
    if (own) { who.innerHTML = '<span class="is-warn">Це твоя картка — скористайся переказом між своїми рахунками</span>'; return; }
    const seq = ++lookupSeq;
    who.innerHTML = '<span class="is-dim">Шукаємо отримувача…</span>';
    try {
      const r = await resolveCard(digits);
      if (seq !== lookupSeq) return;
      if (!r) { who.innerHTML = '<span class="is-err">Картку Аксіоми з таким номером не знайдено</span>'; return; }
      recipient = r;
      who.innerHTML = '<span class="avatar avatar-xs">' + esc((r.name || r.nick).charAt(0).toUpperCase()) + '</span>' +
        '<span><b>' + esc(r.name || 'Без імені') + '</b><small>@' + esc(r.nick) + (r.card === 'main' ? '' : ' · додаткова картка') + '</small></span>';
      refreshBtn();
    } catch (e) {
      console.error(e);
      if (seq === lookupSeq) who.innerHTML = '<span class="is-err">Не вдалося знайти отримувача. Перевір зʼєднання</span>';
    }
  };
  cardEl.addEventListener('input', () => {
    const pos = cardEl.value.length;
    cardEl.value = formatCardInput(cardEl.value);
    if (pos === cardEl.value.length) cardEl.setSelectionRange(pos, pos);
    lookup();
  });
  amtEl.addEventListener('input', refreshBtn);
  fromEl.addEventListener('change', refreshBtn);
  m.querySelector('#axP2PForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!recipient) return;
    const amount = parseAmount(amtEl.value);
    const note = m.querySelector('#axP2PNote').value.trim().slice(0, 60);
    btn.disabled = true; btn.textContent = 'Надсилаємо…';
    const ok = await sendToPlayer(fromEl.value, recipient, amount, note);
    if (ok) { closeSheet(); toast('Надіслано ' + fmt(amount) + ' ₴ — ' + (recipient.name || '@' + recipient.nick), 'success'); }
    else refreshBtn();
  });
  refreshBtn();
  if (prefill) lookup();
}

let _sending = false;
async function sendToPlayer(cardId, r, amount, note) {
  if (_sending) return false;
  const from = getCard(cardId);
  if (!from) { toast('Картку не знайдено', 'error'); return false; }
  if (r.uid === currentUid) { toast('Для своїх карток є переказ між своїми рахунками', 'error'); return false; }
  if (!(amount >= P2P_MIN) || amount > 1e9) { toast('Мінімальна сума переказу — ' + P2P_MIN + ' ₴', 'error'); return false; }
  if (from.frozen) { toast('Картку заблоковано — розблокуй її, щоб переказати', 'error'); return false; }
  if (from.main && amount > mainLimitLeft()) { toast('Денний ліміт основної картки: сьогодні лишилось ' + fmt(mainLimitLeft()) + ' ₴', 'error'); return false; }
  if (amount > from.balance + 1e-9) { toast('Недостатньо коштів: доступно ' + fmt(from.balance) + ' ₴', 'error'); return false; }

  _sending = true;
  const base = 'users/' + currentUid + '/';
  let debited = false;
  try {
    const res = await db.ref(base + from.balPath).transaction((cur) => {
      const v = Number(cur) || 0;
      if (v + 1e-9 < amount) return;
      return round2(v - amount);
    }, undefined, false);
    if (!res.committed) { toast('Недостатньо коштів', 'error'); return false; }
    debited = true;
    await db.ref('inbox/' + r.uid).push({
      fromHandle: handleOf(currentUser), fromName: displayNameOf(userData.profile) || currentUser,
      amount: amount, note: note || '', card: r.card, ts: firebase.database.ServerValue.TIMESTAMP,
    });
    debited = false;
    if (from.main) noteMainSpend(amount);
    pushTx(from.id, { dir: 'out', amount: amount, title: 'Переказ: ' + (r.name || '@' + r.nick), subtitle: note || ('@' + r.nick), p2p: true })
      .catch((e) => console.error('p2p log:', e));
    return true;
  } catch (e) {
    console.error(e);
    if (debited) {
      try {
        await db.ref(base + from.balPath).set(firebase.database.ServerValue.increment(amount));
        toast('Переказ не пройшов — гроші повернули на картку', 'error');
      } catch (e2) {
        console.error('refund failed:', e2);
        toast('Переказ перервався. Якщо сума зникла — напиши в підтримку', 'error');
      }
    } else {
      toast('Не вдалося переказати. Перевір зʼєднання й спробуй ще раз', 'error');
    }
    return false;
  } finally {
    _sending = false;
  }
}

// ── Вхідні перекази ────────────────────────────────────────────────
// Забираємо запис транзакцією (видаляємо, лише якщо він ще є — двічі не
// зарахується навіть з двох вкладок), тоді зараховуємо. Якщо зарахувати не
// вдалося — повертаємо запис у вхідні.
let _inboxWatching = null;
let _inboxBusy = false;
function watchInbox() {
  if (_inboxWatching === currentUid) return;
  unwatchInbox();
  _inboxWatching = currentUid;
  db.ref('inbox/' + currentUid).on('value', (snap) => claimInbox(snap.val() || {}));
}
function unwatchInbox() {
  if (_inboxWatching) db.ref('inbox/' + _inboxWatching).off();
  _inboxWatching = null;
}
async function claimInbox(items) {
  if (_inboxBusy || !userData || !userData.profile) return;
  _inboxBusy = true;
  const uid = currentUid;
  let got = 0, last = null;
  try {
    for (const id of Object.keys(items)) {
      const it = items[id];
      const amount = round2(Number(it && it.amount) || 0);
      if (!(amount > 0) || uid !== currentUid) continue;
      const res = await db.ref('inbox/' + uid + '/' + id).transaction((cur) => (cur ? null : undefined), undefined, false);
      if (!res.committed) continue;
      const card = it.card && getCard(String(it.card)) ? String(it.card) : 'main';
      try {
        await db.ref('users/' + uid + '/cards/' + card + '/balance').set(firebase.database.ServerValue.increment(amount));
      } catch (e) {
        console.error('inbox credit:', e);
        db.ref('inbox/' + uid + '/' + id).set(it).catch((e2) => console.error('inbox restore:', e2));
        continue;
      }
      const fromNick = nickFromHandle(it.fromHandle);
      const who = String(it.fromName || fromNick || '').slice(0, 40);
      pushTx(card, { dir: 'in', amount: amount, title: 'Переказ від ' + who, subtitle: String(it.note || ('@' + fromNick)).slice(0, 60), p2p: true })
        .catch((e) => console.error(e));
      got += amount; last = who;
    }
  } finally {
    _inboxBusy = false;
  }
  if (got) toast('+' + fmt(got) + ' ₴ — переказ' + (last ? ' від ' + last : ''), 'success');
}

// ═══════════════════════════════════════════════════════════════════
// РЕФЕРАЛЬНА ПРОГРАМА: «приведи друга — отримай 100 ₴ на картку»
// Друг під час відкриття рахунку лишає referrals/<твій нік>/<його нік>;
// правила бази пускають такий запис лише від нового (до 7 днів) акаунта,
// у профілі якого invitedBy = ти. Бонус забирає твій клієнт: фіксує виплату
// транзакцією (двічі не заплатиш) і зараховує на основну картку.
// ═══════════════════════════════════════════════════════════════════
let _refs = {};
let _refWatching = null;
let _claiming = false;

function watchReferrals() {
  const me = handleOf(currentUser);
  if (_refWatching === me) return;
  unwatchReferrals();
  _refWatching = me;
  db.ref('referrals/' + me).on('value', (snap) => {
    _refs = snap.val() || {};
    claimReferralBonuses();
    if (typeof _tab !== 'undefined' && _tab === 'more') renderMore();
  }, (e) => console.error('referrals:', e));
}
function unwatchReferrals() {
  if (_refWatching) db.ref('referrals/' + _refWatching).off();
  _refWatching = null;
  _refs = {};
}

function refPaid() { return (userData && userData.refPaid) || {}; }

async function claimReferralBonuses() {
  if (_claiming || !userData || !userData.profile) return;
  const uid = currentUid;
  const todo = Object.keys(_refs).filter((h) => /^[a-z2-7]{1,64}$/.test(h) && h !== handleOf(currentUser) && !refPaid()[h]);
  if (!todo.length) return;
  _claiming = true;
  let got = 0;
  try {
    for (const h of todo) {
      if (Object.keys(refPaid()).length >= REF_MAX || uid !== currentUid) break;
      const res = await db.ref('users/' + uid + '/refPaid/' + h).transaction((cur) => (cur ? undefined : Date.now()), undefined, false);
      if (!res.committed) continue;
      await db.ref('users/' + uid + '/cards/main/balance').set(firebase.database.ServerValue.increment(REF_BONUS));
      pushTx('main', { dir: 'in', amount: REF_BONUS, title: 'Бонус за друга: @' + nickFromHandle(h), subtitle: 'Реферальна програма', ref: true })
        .catch((e) => console.error(e));
      got += REF_BONUS;
    }
  } catch (e) {
    console.error('referral claim:', e);
  } finally {
    _claiming = false;
  }
  if (got) toast('+' + fmt(got) + ' ₴ на картку за запрошених друзів', 'success');
}

function inviteLink() {
  return location.origin + location.pathname + '?ref=' + encodeURIComponent(currentUser);
}

function openReferral() {
  const paid = refPaid();
  const friends = Object.keys(_refs).filter((h) => /^[a-z2-7]{1,64}$/.test(h))
    .sort((a, b) => ((_refs[b] || {}).ts || 0) - ((_refs[a] || {}).ts || 0));
  const earned = Object.keys(paid).length * REF_BONUS;
  const m = openSheet('Запроси друга',
    '<div class="ref-hero">' +
      '<div class="ref-big">+' + REF_BONUS + ' ₴</div>' +
      '<p>на основну картку за кожного друга, який створить новий акаунт Аксіоми й вкаже твій нік</p>' +
    '</div>' +
    '<div class="req">' +
      '<div class="req-row"><span>Твій код</span><b class="mono">' + esc(currentUser) + '</b>' +
        '<button class="icon-btn" id="axRefCopyCode" aria-label="Скопіювати код">' + icon('copy') + '</button></div>' +
      '<div class="req-row"><span>Посилання</span><b class="mono ref-link">' + esc(inviteLink()) + '</b>' +
        '<button class="icon-btn" id="axRefCopyLink" aria-label="Скопіювати посилання">' + icon('copy') + '</button></div>' +
    '</div>' +
    '<div class="ref-stats">' +
      '<div><b>' + friends.length + '</b><span>запрошено</span></div>' +
      '<div><b>' + fmt(earned) + ' ₴</b><span>отримано</span></div>' +
      '<div><b>' + Math.max(0, REF_MAX - Object.keys(paid).length) + '</b><span>ще можна</span></div>' +
    '</div>' +
    '<p class="form-note">Рахується новий акаунт Аксіоми (до 7 днів), у якому друг вказав твій нік. Бонус — віртуальні ₴.</p>' +
    (friends.length
      ? '<div class="sheet-sub">Друзі</div><div class="sheet-flush">' + friends.map((n) =>
          '<div class="tx"><div class="tx-icn in">' + icon('user') + '</div>' +
          '<div class="tx-main"><div class="tx-title">@' + esc(nickFromHandle(n)) + '</div><div class="tx-sub">' +
            esc(new Date((_refs[n] || {}).ts || 0).toLocaleDateString('uk-UA')) + '</div></div>' +
          '<div class="tx-amt ' + (paid[n] ? 'in' : '') + '">' + (paid[n] ? '+' + REF_BONUS + ' ₴' : (Object.keys(paid).length >= REF_MAX ? 'ліміт' : 'зараховуємо')) + '</div></div>'
        ).join('') + '</div>'
      : ''));
  const copy = (text, okMsg) => {
    if (!navigator.clipboard) { toast('Копіювання недоступне в цьому браузері', 'error'); return; }
    navigator.clipboard.writeText(text).then(() => toast(okMsg, 'success'), () => toast('Не вдалося скопіювати', 'error'));
  };
  m.querySelector('#axRefCopyCode').addEventListener('click', () => copy(currentUser, 'Код скопійовано'));
  m.querySelector('#axRefCopyLink').addEventListener('click', () => copy(inviteLink(), 'Посилання скопійовано'));
}

// ── Хуки для app.js ────────────────────────────────────────────────
function afterSync() {
  syncCardIndex();
  watchReferrals();
  watchInbox();
}
function stopSocial() {
  unwatchReferrals();
  unwatchInbox();
  _indexedSig = '';
}

function initSocial() {
  try {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref && NICK_PATH_RE.test(ref)) localStorage.setItem('axioma_ref', ref);
  } catch (e) { /* неважливо */ }
  $('obForm').addEventListener('submit', submitOnboarding);
}
