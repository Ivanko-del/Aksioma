// ═══════════════════════════════════════════════════════════════════
// Аксіома Банк — вкладки, перекази, додаткові картки, заощадження, «Ще».
// Спирається на глобальні стани й хелпери з app.js (db, currentUser,
// userData, getCards, esc, fmt, toast, icon …).
// ═══════════════════════════════════════════════════════════════════
'use strict';

// ── Вкладки ────────────────────────────────────────────────────────
let _tab = 'cards';
function setTab(tab) {
  if (['cards', 'savings', 'more'].indexOf(tab) < 0) tab = 'cards';
  _tab = tab;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== tab));
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  });
  window.scrollTo(0, 0);
  if (tab === 'cards') requestAnimationFrame(() => scrollToCard(_selId, false));
}

// ── Нижня шторка (замість модалок) ──────────────────────────────────
let _sheetReturnFocus = null;
function openSheet(title, bodyHtml) {
  closeSheet();
  _sheetReturnFocus = document.activeElement;
  const m = document.createElement('div');
  m.className = 'sheet-backdrop';
  m.id = 'axSheet';
  m.innerHTML =
    '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="sheet-grip"></div>' +
      '<div class="sheet-head"><div class="sheet-title">' + esc(title) + '</div>' +
        '<button class="icon-btn" data-close aria-label="Закрити">' + icon('x') + '</button></div>' +
      '<div class="sheet-body">' + bodyHtml + '</div>' +
    '</div>';
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeSheet(); });
  document.body.appendChild(m);
  document.body.classList.add('has-sheet');
  const first = m.querySelector('input, select, .sheet-body button');
  if (first && window.matchMedia('(hover: hover)').matches) first.focus();
  return m;
}
function closeSheet() {
  const m = $('axSheet');
  if (!m) return;
  m.remove();
  document.body.classList.remove('has-sheet');
  if (_sheetReturnFocus && _sheetReturnFocus.focus) _sheetReturnFocus.focus();
  _sheetReturnFocus = null;
}

// ═══════════════════════════════════════════════════════════════════
// РАХУНКИ Й РУХ ГРОШЕЙ
// ═══════════════════════════════════════════════════════════════════
const JAR_COLORS = ['#7c83ff', '#3ddc97', '#f5b84b', '#ff7a9c', '#4fc3f7', '#b48cff'];
const MAX_JARS = 10;
const LIMIT_PRESETS = [0, 500, 1000, 2000, 5000, 10000]; // ті самі, що CARD_LIMIT_PRESETS у SlotOK

function getJars() {
  const s = (userData && userData.axiomSavings) || {};
  return Object.keys(s).filter((k) => KEY_RE.test(k) && s[k])
    .sort((a, b) => (s[a].createdAt || 0) - (s[b].createdAt || 0))
    .map((id) => {
      const j = s[id];
      const ci = Number.isInteger(j.color) && j.color >= 0 && j.color < JAR_COLORS.length ? j.color : 0;
      return {
        id: id,
        name: String(j.name || 'Скарбничка').slice(0, 30),
        goal: Math.max(0, Number(j.goal) || 0),
        balance: Math.max(0, Number(j.balance) || 0),
        color: JAR_COLORS[ci],
        colorIdx: ci,
        createdAt: j.createdAt || 0,
      };
    });
}

function getAccounts() {
  const cards = getCards().map((c) => ({
    key: 'card:' + c.id, kind: 'card', id: c.id, main: c.main,
    name: c.main ? 'Основна картка' : 'Картка «' + c.title + '»',
    short: c.title + ' ' + digitsTail(c.number),
    balance: c.balance, balPath: c.balPath, frozen: c.frozen,
  }));
  const jars = getJars().map((j) => ({
    key: 'jar:' + j.id, kind: 'jar', id: j.id, main: false,
    name: 'Скарбничка «' + j.name + '»', short: j.name,
    balance: j.balance, balPath: 'axiomSavings/' + j.id + '/balance', frozen: false,
  }));
  return cards.concat(jars);
}
function getAccount(key) { return getAccounts().find((a) => a.key === key) || null; }

// Денний ліміт основної картки — ті самі поля й формат дня, що в SlotOK
// (virtualCard/dayLimit, dayKey, daySpent), тож ліміт спільний для обох.
function dayKey(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function mainLimitLeft() {
  const vc = (userData && userData.virtualCard) || {};
  const lim = Math.max(0, Number(vc.dayLimit) || 0);
  if (!lim) return Infinity;
  const spent = vc.dayKey === dayKey() ? (Number(vc.daySpent) || 0) : 0;
  return Math.max(0, lim - spent);
}
function noteMainSpend(amount) {
  const vc = (userData && userData.virtualCard) || {};
  if (!(Number(vc.dayLimit) > 0)) return;
  const key = dayKey();
  const spent = (vc.dayKey === key ? (Number(vc.daySpent) || 0) : 0) + amount;
  db.ref('users/' + currentUser + '/virtualCard').update({ dayKey: key, daySpent: Math.round(spent * 100) / 100 })
    .catch((e) => console.error(e));
}

function round2(n) { return Math.round(n * 100) / 100; }
function parseAmount(v) {
  const n = Number(String(v || '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? round2(n) : NaN;
}

function logMove(acc, dir, amount, title) {
  const base = 'users/' + currentUser + '/';
  // own: переказ між власними рахунками — у підсумках місяця не рахується.
  const tx = { dir: dir, amount: amount, title: title, subtitle: 'Між своїми рахунками', own: true, ts: Date.now() };
  // Основна картка пише у спільний зі SlotOK cardTx — гроші справді пішли
  // з картки, яку він бачить. Решта — лише в axiomTx.
  if (acc.kind === 'card' && acc.main) return db.ref(base + 'cardTx').push(Object.assign(tx, { cardId: 'axiom' }));
  return db.ref(base + 'axiomTx').push(Object.assign(tx, { acct: acc.kind === 'jar' ? 'jar:' + acc.id : acc.id }));
}

// Списання — транзакцією (гроші не підуть у мінус навіть при одночасній грі
// в SlotOK), зарахування — атомарним increment. Якщо зарахування не пройшло,
// повертаємо списане тим самим increment'ом.
let _moving = false;
async function moveMoney(fromKey, toKey, amount) {
  if (_moving) return false;
  const from = getAccount(fromKey), to = getAccount(toKey);
  if (!from || !to) { toast('Рахунок не знайдено', 'error'); return false; }
  if (from.key === to.key) { toast('Обери різні рахунки', 'error'); return false; }
  if (!(amount > 0) || amount > 1e9) { toast('Введи суму більше нуля', 'error'); return false; }
  if (from.frozen) { toast('Картку-відправника заблоковано — розблокуй її, щоб переказати', 'error'); return false; }
  if (to.frozen) { toast('Картку-одержувача заблоковано', 'error'); return false; }
  if (from.main) {
    const left = mainLimitLeft();
    if (amount > left) { toast('Денний ліміт основної картки: сьогодні лишилось ' + fmt(left) + ' ₴', 'error'); return false; }
  }
  if (amount > from.balance + 1e-9) { toast('Недостатньо коштів: доступно ' + fmt(from.balance) + ' ₴', 'error'); return false; }

  _moving = true;
  const base = 'users/' + currentUser + '/';
  let debited = false;
  try {
    const res = await db.ref(base + from.balPath).transaction((cur) => {
      const v = Number(cur) || 0;
      if (v + 1e-9 < amount) return; // скасувати: грошей уже менше
      return round2(v - amount);
    }, undefined, false);
    if (!res.committed) { toast('Недостатньо коштів', 'error'); return false; }
    debited = true;
    await db.ref(base + to.balPath).set(firebase.database.ServerValue.increment(amount));
    debited = false;
    if (from.main) noteMainSpend(amount);
    Promise.all([
      logMove(from, 'out', amount, 'Переказ → ' + to.short),
      logMove(to, 'in', amount, 'Переказ ← ' + from.short),
    ]).catch((e) => console.error('tx log failed:', e));
    return true;
  } catch (e) {
    console.error(e);
    if (debited) {
      try {
        await db.ref(base + from.balPath).set(firebase.database.ServerValue.increment(amount));
        toast('Переказ не пройшов — гроші повернули на рахунок', 'error');
      } catch (e2) {
        console.error('refund failed:', e2);
        toast('Переказ перервався. Якщо сума зникла — напиши в підтримку SlotOK', 'error');
      }
    } else {
      toast('Не вдалося переказати. Перевір зʼєднання й спробуй ще раз', 'error');
    }
    return false;
  } finally {
    _moving = false;
  }
}

// ── Шторка переказу ────────────────────────────────────────────────
function accountOptions(selected, excludeKey) {
  return getAccounts().filter((a) => a.key !== excludeKey).map((a) =>
    '<option value="' + esc(a.key) + '"' + (a.key === selected ? ' selected' : '') + '>' +
      esc(a.name) + ' — ' + fmt(a.balance) + ' ₴' + (a.frozen ? ' (заблоковано)' : '') + '</option>'
  ).join('');
}

function openTransfer(opts) {
  opts = opts || {};
  const accs = getAccounts();
  if (accs.length < 2) {
    openSheet('Переказ', '<div class="empty"><p>Переказувати поки нікуди: у тебе одна картка.</p>' +
      '<p class="empty-sub">Відкрий додаткову картку або створи скарбничку.</p>' +
      '<div class="btn-row"><button class="btn btn-primary" onclick="openNewCard()">Відкрити картку</button>' +
      '<button class="btn btn-quiet" onclick="openNewJar()">Нова скарбничка</button></div></div>');
    return;
  }
  const from = opts.from && getAccount(opts.from) ? opts.from : 'card:' + _selId;
  let to = opts.to && getAccount(opts.to) && opts.to !== from ? opts.to : null;
  if (!to) to = (accs.find((a) => a.key !== from) || {}).key;
  const m = openSheet(opts.title || 'Переказ між рахунками',
    '<form class="form" id="axTransferForm" novalidate>' +
      '<label class="field-label" for="axTrFrom">Звідки</label>' +
      '<select id="axTrFrom" class="select">' + accountOptions(from) + '</select>' +
      '<button type="button" class="swap-btn" id="axTrSwap" aria-label="Поміняти місцями">' + icon('swap') + '</button>' +
      '<label class="field-label" for="axTrTo">Куди</label>' +
      '<select id="axTrTo" class="select">' + accountOptions(to, from) + '</select>' +
      '<label class="field-label" for="axTrAmount">Сума, ₴</label>' +
      '<input id="axTrAmount" inputmode="decimal" autocomplete="off" placeholder="0">' +
      '<div class="chips" id="axTrChips">' +
        [100, 500, 1000].map((v) => '<button type="button" class="chip-btn" data-v="' + v + '">' + fmt(v) + '</button>').join('') +
        '<button type="button" class="chip-btn" data-v="all">Усе</button>' +
      '</div>' +
      '<div class="form-note" id="axTrNote"></div>' +
      '<button type="submit" class="btn btn-primary btn-block" id="axTrBtn">Переказати</button>' +
    '</form>');
  const fromEl = m.querySelector('#axTrFrom'), toEl = m.querySelector('#axTrTo'), amtEl = m.querySelector('#axTrAmount');
  const note = () => {
    const a = getAccount(fromEl.value);
    if (!a) return;
    let txt = 'Доступно ' + fmt(a.balance) + ' ₴';
    if (a.main && mainLimitLeft() !== Infinity) txt += ' · денний ліміт: лишилось ' + fmt(mainLimitLeft()) + ' ₴';
    m.querySelector('#axTrNote').textContent = txt;
  };
  const refillTo = () => {
    const keep = toEl.value;
    toEl.innerHTML = accountOptions(keep !== fromEl.value ? keep : null, fromEl.value);
    note();
  };
  fromEl.addEventListener('change', refillTo);
  m.querySelector('#axTrSwap').addEventListener('click', () => {
    const f = fromEl.value, t = toEl.value;
    fromEl.innerHTML = accountOptions(t);
    toEl.innerHTML = accountOptions(f, t);
    note();
  });
  m.querySelector('#axTrChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip-btn');
    if (!b) return;
    const a = getAccount(fromEl.value);
    let v = b.dataset.v === 'all' ? (a ? a.balance : 0) : Number(b.dataset.v);
    if (b.dataset.v === 'all' && a && a.main) v = Math.min(v, mainLimitLeft());
    amtEl.value = String(round2(v)).replace('.', ',');
  });
  m.querySelector('#axTransferForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = m.querySelector('#axTrBtn');
    const amount = parseAmount(amtEl.value);
    btn.disabled = true; btn.textContent = 'Переказуємо…';
    const ok = await moveMoney(fromEl.value, toEl.value, amount);
    btn.disabled = false; btn.textContent = 'Переказати';
    if (ok) { closeSheet(); toast('Переказано ' + fmt(amount) + ' ₴', 'success'); }
  });
  note();
}
function axOpenTransfer() { openTransfer({ from: 'card:' + _selId }); }

// ═══════════════════════════════════════════════════════════════════
// ДОДАТКОВІ КАРТКИ
// ═══════════════════════════════════════════════════════════════════
function openNewCard() {
  const extra = getCards().length - 1;
  if (extra >= MAX_EXTRA_CARDS) {
    openSheet('Нова картка', '<div class="empty"><p>У тебе вже ' + (MAX_EXTRA_CARDS + 1) + ' картки — це максимум.</p>' +
      '<p class="empty-sub">Закрий непотрібну в налаштуваннях картки, щоб відкрити нову.</p></div>');
    return;
  }
  const types = Object.keys(AX_CARD_TYPES);
  const m = openSheet('Відкрити картку',
    '<p class="sheet-lead">Додаткова картка — окремий рахунок у Аксіомі зі своїм номером і CVV. ' +
      'Гратиме в SlotOK лише основна; на додаткову гроші переказуються з основної.</p>' +
    '<div class="type-list" role="radiogroup" aria-label="Тип картки">' +
      types.map((k, i) => {
        const t = AX_CARD_TYPES[k];
        return '<label class="type-opt">' +
          '<input type="radio" name="axCardType" value="' + k + '"' + (i === 0 ? ' checked' : '') + '>' +
          '<span class="type-mini' + (t.light ? ' is-light' : '') + '" style="background:' + esc(t.bg) + '"><b>∴</b></span>' +
          '<span class="type-txt"><b>' + esc(t.name) + '</b><small>' + esc(t.desc) + '</small></span>' +
        '</label>';
      }).join('') +
    '</div>' +
    '<button class="btn btn-primary btn-block" id="axNewCardBtn">Відкрити картку</button>');
  m.querySelector('#axNewCardBtn').addEventListener('click', async (e) => {
    const type = (m.querySelector('input[name="axCardType"]:checked') || {}).value;
    if (!AX_CARD_TYPES[type]) return;
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Випускаємо…';
    try {
      const ref = db.ref('users/' + currentUser + '/axiomCards').push();
      _pendingSelId = ref.key;
      await ref.set(Object.assign(newCardData(currentUser), { type: type, balance: 0, frozen: false, createdAt: Date.now() }));
      closeSheet();
      setTab('cards');
      render();
      toast('Картку «' + AX_CARD_TYPES[type].name + '» відкрито', 'success');
    } catch (err) {
      console.error(err);
      _pendingSelId = null;
      btn.disabled = false; btn.textContent = 'Відкрити картку';
      toast('Не вдалося відкрити картку. Спробуй ще раз', 'error');
    }
  });
}

// Закриття: залишок спершу переказуємо на основну картку, і лише тоді
// видаляємо запис — щоб гроші не зникли разом із карткою.
async function closeAccount(key) {
  const acc = getAccount(key);
  if (!acc || acc.main) return false;
  if (acc.balance > 0) {
    const ok = await moveMoney(key, 'card:axiom', acc.balance);
    if (!ok) return false;
  }
  const path = acc.kind === 'jar' ? 'axiomSavings/' + acc.id : 'axiomCards/' + acc.id;
  const card = acc.kind === 'card' ? getCard(acc.id) : null;
  try {
    await db.ref('users/' + currentUser + '/' + path).remove();
    if (card) unindexCard(card.number);
    return true;
  } catch (e) {
    console.error(e);
    toast('Не вдалося закрити. Спробуй ще раз', 'error');
    return false;
  }
}

// Двоетапне підтвердження прямо в кнопці (confirm() на телефонах незручний).
function armConfirm(btn, label, action) {
  btn.addEventListener('click', async () => {
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = label;
      btn.classList.add('is-armed');
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; btn.classList.remove('is-armed'); } }, 4000);
      return;
    }
    btn.disabled = true;
    await action();
    if (btn.isConnected) btn.disabled = false;
  });
}

// ── Налаштування вибраної картки ────────────────────────────────────
function axOpenCardSettings() {
  const c = selectedCard();
  const holder = c.holder || String(currentUser || '').toUpperCase();
  let html =
    '<div class="req">' +
      '<div class="req-row"><span>Номер</span><b class="mono">' + esc(c.number || '—') + '</b>' +
        '<button class="icon-btn" onclick="axCopyNumber(\'' + c.id + '\')" aria-label="Скопіювати номер">' + icon('copy') + '</button></div>' +
      '<div class="req-row"><span>Діє до</span><b class="mono">' + esc(c.expiry || '—') + '</b></div>' +
      '<div class="req-row"><span>Власник</span><b class="mono">' + esc(holder) + '</b></div>' +
      '<div class="req-row"><span>Тип</span><b>' + esc(c.main ? 'Основна · зв’язок зі SlotOK' : c.title + ' · лише Аксіома') + '</b></div>' +
    '</div>' +
    '<div class="sheet-section">' +
      '<div class="sheet-sub">Скін</div>' +
      '<button class="choice-row" onclick="openSkinPicker(\'' + c.id + '\')">' +
        '<span class="skin-thumb" style="background:' + esc(c.skin ? c.skin.dot : 'linear-gradient(135deg,#6b5cff,#c06bff)') + '"></span>' +
        '<span class="menu-txt"><b>' + esc(c.skin && !c.skin.builtin ? c.skin.name : 'Стандартний дизайн') + '</b>' +
        '<small>' + (c.main ? 'Скін основної картки видно й у SlotOK' : 'Видно лише в Аксіомі') + '</small></span>' +
        '<span class="chev">' + icon('chevron') + '</span></button>' +
    '</div>';
  if (c.main) {
    const lim = c.dayLimit;
    const vc = userData.virtualCard || {};
    const spent = vc.dayKey === dayKey() ? (Number(vc.daySpent) || 0) : 0;
    html +=
      '<div class="sheet-section">' +
        '<div class="sheet-sub">Денний ліміт</div>' +
        '<p class="sheet-lead">Скільки за добу може піти з основної картки на перекази тут і на вивід, перекази та подарунки в SlotOK. Ставки він не чіпає.' +
          (lim ? ' Сьогодні витрачено ' + fmt(spent) + ' з ' + fmt(lim) + ' ₴.' : '') + '</p>' +
        '<div class="chips">' + LIMIT_PRESETS.map((v) =>
          '<button type="button" class="chip-btn' + (v === lim ? ' is-on' : '') + '" onclick="setMainDayLimit(' + v + ')">' + (v ? fmt(v) + ' ₴' : 'Без ліміту') + '</button>'
        ).join('') + '</div>' +
      '</div>';
  } else {
    html +=
      '<div class="sheet-section">' +
        '<button class="btn btn-danger btn-block" id="axCloseCardBtn" data-orig="Закрити картку">Закрити картку</button>' +
        '<p class="form-note">' + (c.balance > 0 ? 'Залишок ' + fmt(c.balance) + ' ₴ перейде на основну картку.' : 'Картка порожня — її можна закрити одразу.') + '</p>' +
      '</div>';
  }
  const m = openSheet(c.title + ' · ' + digitsTail(c.number), html);
  const closeBtn = m.querySelector('#axCloseCardBtn');
  if (closeBtn) {
    armConfirm(closeBtn, 'Натисни ще раз, щоб закрити', async () => {
      const ok = await closeAccount('card:' + c.id);
      if (ok) { closeSheet(); _selId = 'axiom'; toast('Картку закрито', 'success'); }
    });
  }
}

async function setMainDayLimit(v) {
  v = Math.max(0, Math.floor(Number(v) || 0));
  try {
    await db.ref('users/' + currentUser + '/virtualCard/dayLimit').set(v);
    toast(v ? 'Денний ліміт: ' + fmt(v) + ' ₴' : 'Денний ліміт знято', 'success');
    if ($('axSheet')) axOpenCardSettings();
  } catch (e) {
    console.error(e);
    toast('Не вдалося змінити ліміт', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════
// СКІНИ КАРТОК
// Основна картка пише skin/customPhotoUrl у virtualCard — те саме поле, яке
// SlotOK читає для картки Аксіоми, тож він одразу показує вибраний тут скін
// (і навпаки). Додаткові картки — у axiomCards/<id>, їх бачить лише Аксіома.
// ═══════════════════════════════════════════════════════════════════
const PHOTO_MAX_W = 500;          // як у SlotOK: стискаємо перед записом у базу
const PHOTO_MAX_CHARS = 400000;   // ~300 КБ JPEG — більше в запис профілю не пишемо

function cardRecord(c) {
  const u = userData || {};
  return (c.main ? u.virtualCard : (u.axiomCards || {})[c.id]) || {};
}

function openSkinPicker(cardId) {
  const c = getCard(cardId);
  if (!c) return;
  const current = cardRecord(c).skin || '';
  const defBg = c.main ? 'linear-gradient(135deg,#1b1650,#5b3aa8 55%,#c06bff)' : (AX_CARD_TYPES[cardRecord(c).type] || AX_CARD_TYPES.white).bg;
  const tile = (id, bg, name, cls) =>
    '<button type="button" class="skin-tile' + (cls ? ' ' + cls : '') + (current === id ? ' is-on' : '') + '" data-skin="' + esc(id) + '" style="background:' + esc(bg) + '">' +
      '<span>' + esc(name) + '</span>' + (current === id ? '<i>' + icon('check') + '</i>' : '') + '</button>';
  const cats = (typeof SLOTOK_SKIN_CATEGORIES !== 'undefined' ? SLOTOK_SKIN_CATEGORIES : []).map((cat) =>
    '<div class="sheet-sub skin-cat">' + esc(cat.name) + '</div>' +
    '<div class="skin-grid">' + cat.ids.filter((id) => SKIN_BY_ID[id]).map((id) => tile(id, SKIN_BY_ID[id].prev, SKIN_BY_ID[id].name)).join('') + '</div>'
  ).join('');
  const m = openSheet('Скін · ' + (c.main ? 'Основна' : c.title) + ' ' + digitsTail(c.number),
    '<p class="sheet-lead">' + (c.main ? 'Скін основної картки спільний зі SlotOK — він зміниться в обох застосунках.' : 'Скін додаткової картки видно лише в Аксіомі.') + '</p>' +
    '<div class="skin-grid">' +
      tile('', defBg, 'Стандартний', '') +
      '<button type="button" class="skin-tile is-upload' + (current === 'custom-photo' ? ' is-on' : '') + '" data-skin="custom-photo">' +
        icon('plus') + '<span>Своє фото</span>' + (current === 'custom-photo' ? '<i>' + icon('check') + '</i>' : '') + '</button>' +
    '</div>' + cats);
  m.querySelector('.sheet-body').addEventListener('click', (e) => {
    const b = e.target.closest('.skin-tile');
    if (!b) return;
    const id = b.dataset.skin;
    if (id === 'custom-photo') pickSkinPhoto(cardId);
    else setCardSkin(cardId, id, null);
  });
}

async function setCardSkin(cardId, skinId, photoUrl) {
  const c = getCard(cardId);
  if (!c) return;
  if (skinId && skinId !== 'custom-photo' && !SKIN_BY_ID[skinId]) return;
  if (skinId === 'custom-photo' && !PHOTO_RE.test(photoUrl || '')) return;
  const upd = skinId
    ? { skin: skinId, customPhotoUrl: skinId === 'custom-photo' ? photoUrl : null }
    : { skin: null, customPhotoUrl: null };
  try {
    await db.ref('users/' + currentUser + '/' + c.recPath).update(upd);
    closeSheet();
    toast(skinId ? 'Скін застосовано' + (c.main ? ' — і в SlotOK теж' : '') : 'Повернули стандартний дизайн', 'success');
  } catch (e) {
    console.error(e);
    toast('Не вдалося змінити скін. Спробуй ще раз', 'error');
  }
}

function pickSkinPhoto(cardId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Обери зображення', 'error'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('Фото завелике — максимум 8 МБ', 'error'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PHOTO_MAX_W / img.width);
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * scale));
      cv.height = Math.max(1, Math.round(img.height * scale));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const data = cv.toDataURL('image/jpeg', 0.75);
      if (data.length > PHOTO_MAX_CHARS) { toast('Фото надто деталізоване — спробуй інше', 'error'); return; }
      setCardSkin(cardId, 'custom-photo', data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Не вдалося відкрити фото', 'error'); };
    img.src = url;
  };
  input.click();
}

// ═══════════════════════════════════════════════════════════════════
// ЗАОЩАДЖЕННЯ — скарбнички
// ═══════════════════════════════════════════════════════════════════
function ringSvg(pct, color) {
  const r = 17, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pct)));
  return '<svg class="ring" viewBox="0 0 42 42" aria-hidden="true">' +
    '<circle cx="21" cy="21" r="' + r + '" fill="none" stroke="var(--surface-3)" stroke-width="4"/>' +
    '<circle cx="21" cy="21" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="4" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 21 21)"/>' +
  '</svg>';
}

function renderSavings() {
  const jars = getJars();
  const total = jars.reduce((s, j) => s + j.balance, 0);
  $('axSavTotal').textContent = fmt(total);
  $('axSavCount').textContent = jars.length
    ? jars.length + ' ' + plural(jars.length, 'скарбничка', 'скарбнички', 'скарбничок')
    : 'Поки жодної скарбнички';
  const list = $('axJarList');
  if (!jars.length) {
    list.innerHTML =
      '<div class="empty is-card">' +
        '<div class="empty-ic">' + icon('piggy') + '</div>' +
        '<p>Відкладай на ціль окремо від ігрового балансу</p>' +
        '<p class="empty-sub">Скарбничка — окремий рахунок: гроші в ній не витратяться випадково в SlotOK. Відсотки не нараховуються.</p>' +
        '<button class="btn btn-primary" onclick="openNewJar()">Створити скарбничку</button>' +
      '</div>';
    return;
  }
  list.innerHTML = jars.map((j) => {
    const pct = j.goal ? j.balance / j.goal : 0;
    return '<button class="jar" onclick="openJar(\'' + j.id + '\')">' +
      '<span class="jar-ring">' + ringSvg(j.goal ? pct : 1, j.goal ? j.color : 'color-mix(in srgb, ' + j.color + ' 40%, transparent)') +
        '<span class="jar-dot" style="background:' + j.color + '"></span></span>' +
      '<span class="jar-main"><span class="jar-name">' + esc(j.name) + '</span>' +
        '<span class="jar-sub">' + (j.goal ? 'Ціль ' + fmt(j.goal) + ' ₴ · ' + Math.min(999, Math.floor(pct * 100)) + '%' : 'Без цілі') + '</span></span>' +
      '<span class="jar-amt">' + fmt(j.balance) + ' ₴</span>' +
    '</button>';
  }).join('');
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function jarFormHtml(j) {
  return '<form class="form" id="axJarForm" novalidate>' +
    '<label class="field-label" for="axJarName">Назва</label>' +
    '<input id="axJarName" maxlength="30" autocomplete="off" placeholder="Напр. Новий телефон" value="' + esc(j ? j.name : '') + '">' +
    '<label class="field-label" for="axJarGoal">Ціль, ₴ (необовʼязково)</label>' +
    '<input id="axJarGoal" inputmode="decimal" autocomplete="off" placeholder="Без цілі" value="' + (j && j.goal ? String(j.goal).replace('.', ',') : '') + '">' +
    '<div class="field-label">Колір</div>' +
    '<div class="swatches" role="radiogroup" aria-label="Колір">' +
      JAR_COLORS.map((c, i) => '<label class="swatch"><input type="radio" name="axJarColor" value="' + i + '"' +
        (i === (j ? j.colorIdx : 0) ? ' checked' : '') + '><span style="background:' + c + '"></span></label>').join('') +
    '</div>' +
    '<div class="form-note" id="axJarErr"></div>' +
    '<button type="submit" class="btn btn-primary btn-block" id="axJarSave">' + (j ? 'Зберегти' : 'Створити скарбничку') + '</button>' +
  '</form>';
}
function readJarForm(m) {
  const name = m.querySelector('#axJarName').value.trim().slice(0, 30);
  const goalRaw = m.querySelector('#axJarGoal').value.trim();
  const goal = goalRaw ? parseAmount(goalRaw) : 0;
  const color = Number((m.querySelector('input[name="axJarColor"]:checked') || {}).value) || 0;
  const err = !name ? 'Дай скарбничці назву' : (!(goal >= 0) || goal > 1e9) ? 'Ціль — це сума в гривнях' : '';
  return { name: name, goal: goal || 0, color: color, err: err };
}

function openNewJar() {
  if (getJars().length >= MAX_JARS) { toast('Максимум ' + MAX_JARS + ' скарбничок', 'error'); return; }
  const m = openSheet('Нова скарбничка', jarFormHtml(null));
  m.querySelector('#axJarForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = readJarForm(m);
    if (f.err) { m.querySelector('#axJarErr').textContent = f.err; return; }
    const btn = m.querySelector('#axJarSave');
    btn.disabled = true;
    try {
      const ref = db.ref('users/' + currentUser + '/axiomSavings').push();
      await ref.set({ name: f.name, goal: f.goal, color: f.color, balance: 0, createdAt: Date.now() });
      closeSheet();
      setTab('savings');
      toast('Скарбничку «' + f.name + '» створено', 'success');
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      toast('Не вдалося створити скарбничку', 'error');
    }
  });
}

function openJar(id) {
  const j = getJars().find((x) => x.id === id);
  if (!j) return;
  const txs = Object.values(userData.axiomTx || {}).filter((t) => t && t.acct === 'jar:' + id)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 30);
  const pct = j.goal ? Math.min(1, j.balance / j.goal) : 0;
  const m = openSheet(j.name,
    '<div class="jar-hero">' +
      '<div class="jar-hero-amt">' + fmt(j.balance) + '<span class="cur">₴</span></div>' +
      (j.goal
        ? '<div class="bar"><span style="width:' + (pct * 100).toFixed(1) + '%;background:' + j.color + '"></span></div>' +
          '<div class="jar-hero-sub">' + (j.balance >= j.goal ? 'Ціль досягнуто' : 'Ще ' + fmt(j.goal - j.balance) + ' ₴ до цілі ' + fmt(j.goal) + ' ₴') + '</div>'
        : '<div class="jar-hero-sub">Без цілі</div>') +
    '</div>' +
    '<div class="btn-row">' +
      '<button class="btn btn-primary" onclick="openTransfer({title:\'Поповнити скарбничку\', from:\'card:axiom\', to:\'jar:' + id + '\'})">Поповнити</button>' +
      '<button class="btn btn-quiet" onclick="openTransfer({title:\'Зняти зі скарбнички\', from:\'jar:' + id + '\', to:\'card:axiom\'})"' + (j.balance > 0 ? '' : ' disabled') + '>Зняти</button>' +
    '</div>' +
    '<div class="sheet-section"><div class="sheet-sub">Історія</div></div>' +
    '<div class="sheet-flush">' + (txs.length ? txs.map(txRow).join('') : '<div class="muted">Поповнень ще не було</div>') + '</div>' +
    '<div class="sheet-section btn-row">' +
      '<button class="btn btn-quiet" id="axJarEdit">Змінити</button>' +
      '<button class="btn btn-danger" id="axJarClose" data-orig="Закрити">Закрити</button>' +
    '</div>' +
    '<p class="form-note">' + (j.balance > 0 ? 'Під час закриття ' + fmt(j.balance) + ' ₴ повернеться на основну картку.' : '') + '</p>');
  m.querySelector('#axJarEdit').addEventListener('click', () => editJar(id));
  armConfirm(m.querySelector('#axJarClose'), 'Точно закрити?', async () => {
    const ok = await closeAccount('jar:' + id);
    if (ok) { closeSheet(); toast('Скарбничку закрито', 'success'); }
  });
}

function editJar(id) {
  const j = getJars().find((x) => x.id === id);
  if (!j) return;
  const m = openSheet('Змінити скарбничку', jarFormHtml(j));
  m.querySelector('#axJarForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = readJarForm(m);
    if (f.err) { m.querySelector('#axJarErr').textContent = f.err; return; }
    try {
      await db.ref('users/' + currentUser + '/axiomSavings/' + id).update({ name: f.name, goal: f.goal, color: f.color });
      openJar(id);
      toast('Збережено', 'success');
    } catch (err) {
      console.error(err);
      toast('Не вдалося зберегти', 'error');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// «ЩЕ»
// ═══════════════════════════════════════════════════════════════════
function renderMore() {
  const cards = getCards(), jars = getJars();
  const total = cards.reduce((s, c) => s + c.balance, 0) + jars.reduce((s, j) => s + j.balance, 0);
  const letter = String(currentUser || '?').charAt(0).toUpperCase();
  $('axProfileAvatar').textContent = letter;
  $('axHeaderAvatar').textContent = letter;
  $('axProfileNick').textContent = fullNameOf(userData.axiomProfile) || currentUser || '';
  $('axProfileHandle').textContent = '@' + (currentUser || '');
  const refCount = Object.keys(userData.axiomRefPaid || {}).length;
  $('axMoreRef').textContent = refCount ? refCount + ' ' + plural(refCount, 'друг', 'друзі', 'друзів') : '+' + REF_BONUS + ' ₴';
  $('axProfileSub').textContent = cards.length + ' ' + plural(cards.length, 'картка', 'картки', 'карток') +
    ' · ' + jars.length + ' ' + plural(jars.length, 'скарбничка', 'скарбнички', 'скарбничок');
  $('axProfileTotal').textContent = fmt(total) + ' ₴';
  const vc = userData.virtualCard || {};
  $('axMoreLimit').textContent = Number(vc.dayLimit) > 0 ? fmt(vc.dayLimit) + ' ₴' : 'Без ліміту';
  $('axMoreLink').textContent = vc.axiomLinked ? 'Підключено' : 'Не підключено';
}

function openRequisites() {
  goMainCard();
  axOpenCardSettings();
}

function openPasswordChange() {
  const m = openSheet('Змінити пароль',
    '<p class="sheet-lead">Акаунт спільний зі SlotOK — новий пароль діятиме в обох застосунках.</p>' +
    '<form class="form" id="axPwForm" novalidate>' +
      '<input type="text" name="username" autocomplete="username" value="' + esc(currentUser) + '" hidden>' +
      '<label class="field-label" for="axPwOld">Поточний пароль</label>' +
      '<input id="axPwOld" type="password" autocomplete="current-password">' +
      '<label class="field-label" for="axPwNew">Новий пароль</label>' +
      '<input id="axPwNew" type="password" autocomplete="new-password" placeholder="Мінімум 6 символів">' +
      '<label class="field-label" for="axPwNew2">Повтори новий пароль</label>' +
      '<input id="axPwNew2" type="password" autocomplete="new-password">' +
      '<div class="form-note is-error" id="axPwErr"></div>' +
      '<button type="submit" class="btn btn-primary btn-block" id="axPwBtn">Змінити пароль</button>' +
    '</form>');
  m.querySelector('#axPwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldP = m.querySelector('#axPwOld').value, p1 = m.querySelector('#axPwNew').value, p2 = m.querySelector('#axPwNew2').value;
    const err = m.querySelector('#axPwErr');
    err.textContent = '';
    if (p1.length < 6) { err.textContent = 'Новий пароль — мінімум 6 символів'; return; }
    if (p1 !== p2) { err.textContent = 'Нові паролі не збігаються'; return; }
    if (p1 === oldP) { err.textContent = 'Новий пароль збігається з поточним'; return; }
    const lock = getLoginLock(currentUser);
    if (lock.until && lock.until > Date.now()) {
      err.textContent = 'Забагато спроб. Спробуй через ' + Math.ceil((lock.until - Date.now()) / 1000) + ' с.';
      return;
    }
    const btn = m.querySelector('#axPwBtn');
    btn.disabled = true; btn.textContent = 'Перевіряємо…';
    try {
      const stored = (await db.ref('users/' + currentUser + '/pass').once('value')).val();
      const check = await SlotOKPassword.verify(oldP, stored);
      if (!check || !check.ok) {
        registerLoginFailure(currentUser);
        err.textContent = 'Поточний пароль невірний';
        return;
      }
      registerLoginSuccess(currentUser);
      await db.ref('users/' + currentUser + '/pass').set(await SlotOKPassword.hash(p1));
      closeSheet();
      toast('Пароль змінено — він діє і в SlotOK', 'success');
    } catch (ex) {
      console.error(ex);
      err.textContent = 'Не вдалося змінити пароль. Спробуй ще раз';
    } finally {
      if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Змінити пароль'; }
    }
  });
}

const FAQ = [
  ['Чим основна картка відрізняється від додаткових?',
   'Основну можна підключити до SlotOK кодом — тоді з нею грають і поповнюють через касу SlotOK. Додаткові картки й скарбнички — окремі рахунки лише в Аксіомі: SlotOK їх не бачить, тож гроші на них не витратяться в грі.'],
  ['Як поповнити картку?',
   'Основна поповнюється в SlotOK → Каса, коли вона там активна. Додаткові картки й скарбнички поповнюються переказом з основної.'],
  ['Як змінити скін картки?',
   'Натисни на назву скіна під карткою або «Картка» → «Скін». Є 100 скінів і можна поставити своє фото. Скін основної картки спільний зі SlotOK: зміниш тут — зміниться там, і навпаки. Скіни додаткових карток видно лише в Аксіомі.'],
  ['Чи нараховуються відсотки на скарбнички?',
   'Ні. Скарбничка — окремий рахунок для накопичення на ціль, без відсотків.'],
  ['Що робить денний ліміт?',
   'Обмежує, скільки за добу може піти з основної картки: на перекази в Аксіомі та на вивід, перекази й подарунки в SlotOK. Ставки він не обмежує.'],
  ['Що буде, якщо заблокувати картку?',
   'З неї й на неї не можна переказувати. Блокування основної картки діє і в SlotOK. Розблокувати можна тією ж кнопкою.'],
  ['Як переказати іншому гравцю?',
   'Натисни «Переказ» → «Іншому гравцю» й введи 16-значний номер його картки Аксіоми. Перед відправкою побачиш ім’я отримувача — перевір його: переказ не скасовується. Мінімум — 10 ₴.'],
  ['Як отримати 100 ₴ за друга?',
   'Дай другові свій нік або посилання з розділу «Ще → Запроси друга». Коли новий користувач відкриє рахунок в Аксіомі й вкаже тебе, 100 ₴ прийдуть на твою основну картку. Максимум — 50 друзів.'],
  ['Це справжні гроші?',
   'Ні. Аксіома — ігровий симулятор банку: усі кошти віртуальні, не мають грошової вартості й не виводяться. Деталі — у «Правилах й політиці».'],
  ['Хтось дізнався мій CVV або пароль',
   'Одразу заблокуй картку й зміни пароль у розділі «Ще → Безпека». Нікому не повідомляй CVV і пароль — навіть тим, хто називає себе підтримкою.'],
];
function openFaq() {
  openSheet('Питання й відповіді',
    '<div class="faq">' + FAQ.map((q) =>
      '<details class="faq-item"><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'
    ).join('') + '</div>');
}
function openSupport() {
  openSheet('Підтримка',
    '<p class="sheet-lead">Підтримка Аксіоми працює через SlotOK: відкрий SlotOK і напиши в чат підтримки. ' +
      'Опиши, що сталося, і додай нік — ' + '<b>' + esc(currentUser) + '</b>.</p>' +
    '<p class="sheet-lead">Ніхто з підтримки не питає пароль, CVV чи код підключення.</p>');
}
function openAbout() {
  openSheet('Про Аксіому',
    '<p class="sheet-lead">Аксіома — ігровий симулятор банку, партнер SlotOK. Це не банк і не фінансова установа: усі кошти віртуальні. ' +
      'Той самий акаунт, що в SlotOK; основна картка підключається до SlotOK кодом, а додаткові картки й скарбнички живуть лише тут.</p>' +
    '<button class="btn btn-quiet btn-block" onclick="openRules()">Правила й політика</button>' +
    '<div class="req" style="margin-top:14px"><div class="req-row"><span>Версія</span><b>4.0</b></div>' +
      '<div class="req-row"><span>Партнер</span><b>SlotOK</b></div></div>');
}

// ── Ініціалізація ──────────────────────────────────────────────────
function goMainCard() {
  _selId = 'axiom';
  setTab('cards');
  renderCards();
  renderDetails();
}

function initBank() {
  document.querySelectorAll('.mi[data-ic]').forEach((el) => { el.innerHTML = icon(el.dataset.ic); });
  document.querySelectorAll('.chev').forEach((el) => { el.innerHTML = icon('chevron'); });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
}
