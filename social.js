// ═══════════════════════════════════════════════════════════════════
// Аксіома Банк — відкриття рахунку (ПІБ + правила), правила/політика,
// реферальна програма, перекази іншим гравцям за номером картки.
// Спирається на app.js і bank.js.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const RULES_VERSION = 1;
const REF_BONUS = 100;
const REF_MAX = 50;                          // скільки друзів максимум оплачуємо
const REF_NEW_USER_MS = 7 * 86400000;        // «новий» = акаунт SlotOK молодший за 7 днів
const P2P_MIN = 10;                          // як мінімум переказу в SlotOK
const NAME_RE = /^[A-Za-zА-ЯҐЄІЇа-яґєії]+(?:['’ʼ-][A-Za-zА-ЯҐЄІЇа-яґєії]+)*$/;

// ═══════════════════════════════════════════════════════════════════
// ПРАВИЛА Й ПОЛІТИКА
// ═══════════════════════════════════════════════════════════════════
const RULES = [
  ['Що таке Аксіома',
   'Аксіома — ігровий застосунок-симулятор банку, партнер розважальної платформи SlotOK. Аксіома не є банком, фінансовою чи платіжною установою, не має ліцензії Національного банку України й не надає фінансових послуг.'],
  ['Усі гроші віртуальні',
   'Баланси, картки, перекази, скарбнички й бонуси в Аксіомі — віртуальні ігрові одиниці. Вони не мають грошової вартості, не обмінюються на справжні гроші, товари чи послуги й не виводяться на справжні картки чи рахунки. Позначка «₴» — лише ігрова умовність.'],
  ['Картки несправжні',
   'Номери карток, CVV і терміни дії в Аксіомі згенеровані для гри й не працюють у жодній справжній платіжній системі. Ніколи не вводь тут дані своїх справжніх банківських карток.'],
  ['Персональні дані',
   'Під час відкриття рахунку ти вказуєш прізвище, ім’я та по батькові. Вони зберігаються в базі даних проєкту (Firebase) разом з твоїм акаунтом SlotOK. Іншим гравцям у застосунку показуємо лише ім’я та першу літеру прізвища — щоб відправник переказу бачив, кому надсилає.'],
  ['Перекази',
   'Переказ іншому гравцю виконується одразу й не скасовується. Перед відправкою перевір ім’я отримувача. Переказувати можна з картки, яка не заблокована, у межах денного ліміту.'],
  ['Реферальна програма',
   'За кожного нового користувача, який під час відкриття рахунку в Аксіомі вказав твій нік, ти отримуєш ' + REF_BONUS + ' віртуальних ₴ на основну картку. Новим вважається акаунт SlotOK, створений не раніше ніж за 7 днів до відкриття рахунку. Максимум — ' + REF_MAX + ' друзів. Бонуси за штучно створені акаунти можуть бути анульовані.'],
  ['Безпека акаунта',
   'Не передавай нікому пароль, CVV чи код підключення до SlotOK. Підтримка ніколи їх не питає.'],
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
function isNewForReferral(u) {
  const reg = Number((u || {}).registeredAt) || 0;
  return reg > 0 && Date.now() - reg <= REF_NEW_USER_MS;
}
function savedRef() {
  try { return localStorage.getItem('axioma_ref') || ''; } catch (e) { return ''; }
}

function showOnboarding() {
  const scr = $('onboardScreen');
  $('appScreen').classList.add('hidden');
  if (!scr.classList.contains('hidden')) return; // уже відкрито — не затираємо введене
  scr.classList.remove('hidden');
  const canInvite = isNewForReferral(userData);
  const ref = savedRef() || (userData && userData.referredBy) || '';
  $('obNick').textContent = currentUser || '';
  $('obInviteWrap').classList.toggle('hidden', !canInvite);
  $('obInvite').value = canInvite && ref !== currentUser ? ref : '';
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
    if (inv && isNewForReferral(userData)) {
      if (inv.toLowerCase() === String(currentUser).toLowerCase()) { err.textContent = 'Не можна запросити самого себе'; return; }
      if (!KEY_RE.test(inv)) { err.textContent = 'Код запрошення — це нік друга'; return; }
      const inviter = (await db.ref('users/' + inv + '/axiomProfile/firstName').once('value')).val();
      if (!inviter) { err.textContent = 'Клієнта Аксіоми з ніком «' + inv + '» не знайдено. Перевір нік або залиш поле порожнім'; return; }
      invitedBy = inv;
    }
    const now = Date.now();
    const profile = { lastName: last, firstName: first, middleName: middle, createdAt: now, rulesVersion: RULES_VERSION, acceptedRulesAt: now };
    if (invitedBy) profile.invitedBy = invitedBy;
    await db.ref('axiomPublic/' + currentUser).set({ name: displayNameOf(profile) });
    if (invitedBy) await db.ref('axiomReferrals/' + invitedBy + '/' + currentUser).set({ ts: now });
    await db.ref('users/' + currentUser + '/axiomProfile').set(profile);
    try { localStorage.removeItem('axioma_ref'); } catch (ex) { /* неважливо */ }
    toast('Рахунок відкрито. Вітаємо в Аксіомі, ' + first + '!', 'success');
  } catch (ex) {
    console.error(ex);
    err.textContent = 'Не вдалося відкрити рахунок. Перевір зʼєднання й спробуй ще раз';
  } finally {
    btn.disabled = false; btn.textContent = 'Відкрити рахунок';
  }
}

// ═══════════════════════════════════════════════════════════════════
// ІНДЕКС КАРТОК: номер → власник (для переказів за номером)
// ═══════════════════════════════════════════════════════════════════
let _indexedSig = '';
function syncCardIndex() {
  if (!db || !currentUser) return;
  const cards = getCards().filter((c) => /^\d{16}$/.test(String(c.number || '').replace(/\D/g, '')));
  const sig = cards.map((c) => c.id + ':' + c.number).join('|');
  if (sig === _indexedSig) return;
  _indexedSig = sig;
  const updates = {};
  cards.forEach((c) => { updates[String(c.number).replace(/\D/g, '')] = { nick: currentUser, card: c.id }; });
  db.ref('axiomCardIndex').update(updates).catch((e) => console.error('card index:', e));
}
function unindexCard(number) {
  const d = String(number || '').replace(/\D/g, '');
  if (d.length === 16) db.ref('axiomCardIndex/' + d).remove().catch((e) => console.error(e));
}

// Знаходить картку за номером і ПЕРЕВІРЯЄ, що в записі власника справді цей
// номер (індекс може бути застарілим). Повертає { nick, card, name, frozen }.
async function checkCardHit(hit, digits) {
  if (!hit || !KEY_RE.test(String(hit.nick || '')) || !KEY_RE.test(String(hit.card || ''))) return null;
  const recPath = hit.card === 'axiom' ? 'virtualCard' : 'axiomCards/' + hit.card;
  const rec = (await db.ref('users/' + hit.nick + '/' + recPath).once('value')).val();
  return rec && String(rec.number || '').replace(/\D/g, '') === digits ? { hit: hit, recPath: recPath, rec: rec } : null;
}
async function resolveCard(digits) {
  let ok = await checkCardHit((await db.ref('axiomCardIndex/' + digits).once('value')).val(), digits);
  if (!ok) {
    // Індексу нема (власник ще не відкривав оновлену Аксіому) або він не
    // збігається з карткою — шукаємо основну картку напряму.
    const formatted = digits.replace(/(.{4})(?=.)/g, '$1 ');
    const snap = await db.ref('users').orderByChild('virtualCard/number').equalTo(formatted).limitToFirst(1).once('value');
    const found = Object.keys(snap.val() || {})[0];
    ok = found ? await checkCardHit({ nick: found, card: 'axiom' }, digits) : null;
  }
  if (!ok) return null;
  const hit = ok.hit, recPath = ok.recPath, rec = ok.rec;
  const pub = (await db.ref('axiomPublic/' + hit.nick + '/name').once('value')).val();
  return { nick: hit.nick, card: hit.card, recPath: recPath, name: typeof pub === 'string' ? pub.slice(0, 40) : '', frozen: !!rec.frozen };
}

// Куди зараховувати: основна картка отримувача — за тією ж проєкцією, що
// в SlotOK (активна в SlotOK → users/<nick>/balance), додаткова — на себе.
async function recipientBalPath(r) {
  if (r.card !== 'axiom') return r.recPath + '/balance';
  const base = 'users/' + r.nick + '/';
  const [active, linked, cards] = await Promise.all([
    db.ref(base + 'activeCardId').once('value'),
    db.ref(base + 'virtualCard/axiomLinked').once('value'),
    db.ref(base + 'linkedCards').once('value'),
  ]);
  const u = { activeCardId: active.val(), virtualCard: { axiomLinked: !!linked.val() }, linkedCards: cards.val() || {} };
  return mainBalPath(u);
}

// ═══════════════════════════════════════════════════════════════════
// ПЕРЕКАЗ ІНШОМУ ГРАВЦЮ
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
  const sel = getCard(_selId) ? _selId : 'axiom';
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
      if (r.frozen) { who.innerHTML = '<span class="is-err">Картку отримувача заблоковано</span>'; return; }
      recipient = r;
      who.innerHTML = '<span class="avatar avatar-xs">' + esc((r.name || r.nick).charAt(0).toUpperCase()) + '</span>' +
        '<span><b>' + esc(r.name || 'Без імені') + '</b><small>@' + esc(r.nick) + (r.card === 'axiom' ? '' : ' · додаткова картка') + '</small></span>';
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
  if (r.nick === currentUser) { toast('Для своїх карток є переказ між своїми рахунками', 'error'); return false; }
  if (!(amount >= P2P_MIN) || amount > 1e9) { toast('Мінімальна сума переказу — ' + P2P_MIN + ' ₴', 'error'); return false; }
  if (from.frozen) { toast('Картку заблоковано — розблокуй її, щоб переказати', 'error'); return false; }
  if (from.main && amount > mainLimitLeft()) { toast('Денний ліміт основної картки: сьогодні лишилось ' + fmt(mainLimitLeft()) + ' ₴', 'error'); return false; }
  if (amount > from.balance + 1e-9) { toast('Недостатньо коштів: доступно ' + fmt(from.balance) + ' ₴', 'error'); return false; }

  _sending = true;
  const base = 'users/' + currentUser + '/';
  let debited = false;
  try {
    const toPath = 'users/' + r.nick + '/' + await recipientBalPath(r);
    const res = await db.ref(base + from.balPath).transaction((cur) => {
      const v = Number(cur) || 0;
      if (v + 1e-9 < amount) return;
      return round2(v - amount);
    }, undefined, false);
    if (!res.committed) { toast('Недостатньо коштів', 'error'); return false; }
    debited = true;
    await db.ref(toPath).set(firebase.database.ServerValue.increment(amount));
    debited = false;
    if (from.main) noteMainSpend(amount);

    const me = displayNameOf(userData.axiomProfile) || currentUser;
    const ts = Date.now();
    const outTx = { dir: 'out', amount: amount, title: 'Переказ: ' + (r.name || '@' + r.nick), subtitle: note || ('@' + r.nick), p2p: true, ts: ts };
    const inTx = { dir: 'in', amount: amount, title: 'Переказ від ' + me, subtitle: note || ('@' + currentUser), p2p: true, ts: ts };
    const writes = [
      from.main ? db.ref(base + 'cardTx').push(Object.assign(outTx, { cardId: 'axiom' }))
                : db.ref(base + 'axiomTx').push(Object.assign(outTx, { acct: from.id })),
      r.card === 'axiom' ? db.ref('users/' + r.nick + '/cardTx').push(Object.assign(inTx, { cardId: 'axiom' }))
                         : db.ref('users/' + r.nick + '/axiomTx').push(Object.assign(inTx, { acct: r.card })),
    ];
    Promise.all(writes).catch((e) => console.error('p2p log failed:', e));
    return true;
  } catch (e) {
    console.error(e);
    if (debited) {
      try {
        await db.ref(base + from.balPath).set(firebase.database.ServerValue.increment(amount));
        toast('Переказ не пройшов — гроші повернули на картку', 'error');
      } catch (e2) {
        console.error('refund failed:', e2);
        toast('Переказ перервався. Якщо сума зникла — напиши в підтримку SlotOK', 'error');
      }
    } else {
      toast('Не вдалося переказати. Перевір зʼєднання й спробуй ще раз', 'error');
    }
    return false;
  } finally {
    _sending = false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// РЕФЕРАЛЬНА ПРОГРАМА: «приведи друга — отримай 100 ₴ на картку»
// Друг під час відкриття рахунку лишає запис axiomReferrals/<ти>/<друг>.
// Твій клієнт сам забирає бонус: перевіряє, що в профілі друга справді
// invitedBy = ти, фіксує виплату транзакцією (двічі не заплатиш) і
// зараховує 100 ₴ на основну картку. Чужий баланс ніхто не чіпає.
// ═══════════════════════════════════════════════════════════════════
let _refs = {};
let _refRejected = {};  // записи, які не пройшли перевірку (нема invitedBy = ти)
let _refWatching = null;
let _claiming = false;

function watchReferrals() {
  if (_refWatching === currentUser) return;
  unwatchReferrals();
  _refWatching = currentUser;
  db.ref('axiomReferrals/' + currentUser).on('value', (snap) => {
    _refs = snap.val() || {};
    claimReferralBonuses();
    if (_tab === 'more') renderMore();
  });
}
function unwatchReferrals() {
  if (_refWatching) db.ref('axiomReferrals/' + _refWatching).off();
  _refWatching = null;
  _refs = {};
  _refRejected = {};
}

function refPaid() { return (userData && userData.axiomRefPaid) || {}; }

async function claimReferralBonuses() {
  if (_claiming || !userData || !userData.axiomProfile) return;
  const me = currentUser;
  const todo = Object.keys(_refs).filter((n) => KEY_RE.test(n) && n !== me && !refPaid()[n] && !_refRejected[n]);
  if (!todo.length) return;
  _claiming = true;
  let got = 0;
  try {
    for (const nick of todo) {
      if (Object.keys(refPaid()).length >= REF_MAX || currentUser !== me) break;
      const prof = (await db.ref('users/' + nick + '/axiomProfile').once('value')).val();
      if (!prof || prof.invitedBy !== me) { _refRejected[nick] = true; continue; }
      const res = await db.ref('users/' + me + '/axiomRefPaid/' + nick).transaction((cur) => (cur ? undefined : Date.now()), undefined, false);
      if (!res.committed) continue;
      await db.ref('users/' + me + '/' + mainBalPath(userData)).set(firebase.database.ServerValue.increment(REF_BONUS));
      db.ref('users/' + me + '/cardTx').push({
        dir: 'in', amount: REF_BONUS, title: 'Бонус за друга: ' + (displayNameOf(prof) || '@' + nick),
        subtitle: 'Реферальна програма', cardId: 'axiom', ref: true, ts: Date.now(),
      }).catch((e) => console.error(e));
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
  const friends = Object.keys(_refs).filter((n) => KEY_RE.test(n) && !_refRejected[n])
    .sort((a, b) => ((_refs[b] || {}).ts || 0) - ((_refs[a] || {}).ts || 0));
  const earned = Object.keys(paid).length * REF_BONUS;
  const m = openSheet('Запроси друга',
    '<div class="ref-hero">' +
      '<div class="ref-big">+' + REF_BONUS + ' ₴</div>' +
      '<p>на основну картку за кожного нового друга, який відкриє рахунок в Аксіомі й вкаже твій нік</p>' +
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
    '<p class="form-note">Рахується друг, чий акаунт SlotOK створено не раніше ніж за 7 днів до відкриття рахунку в Аксіомі. Бонус — віртуальні ₴.</p>' +
    (friends.length
      ? '<div class="sheet-sub">Друзі</div><div class="sheet-flush">' + friends.map((n) =>
          '<div class="tx"><div class="tx-icn in">' + icon('user') + '</div>' +
          '<div class="tx-main"><div class="tx-title">@' + esc(n) + '</div><div class="tx-sub">' +
            esc(new Date((_refs[n] || {}).ts || 0).toLocaleDateString('uk-UA')) + '</div></div>' +
          '<div class="tx-amt ' + (paid[n] ? 'in' : '') + '">' + (paid[n] ? '+' + REF_BONUS + ' ₴' : (Object.keys(paid).length >= REF_MAX ? 'ліміт' : 'перевіряємо')) + '</div></div>'
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
}

function initSocial() {
  try {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref && KEY_RE.test(ref)) localStorage.setItem('axioma_ref', ref);
  } catch (e) { /* неважливо */ }
  $('obForm').addEventListener('submit', submitOnboarding);
}
