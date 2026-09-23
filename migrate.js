// ═══════════════════════════════════════════════════════════════════
// Аксіома Банк — одноразове перенесення гравця SlotOK.
// Раніше Аксіома жила в базі SlotOK (users/<nick>/virtualCard, axiomCards,
// axiomSavings, axiomTx, axiomProfile). Під час першого входу гравця SlotOK:
//   1) пароль звіряємо з хешем у базі SlotOK;
//   2) створюємо вхід в Аксіомі з тим самим паролем;
//   3) переносимо картки, скарбнички й історію в базу Аксіоми;
//   4) прибираємо дані Аксіоми з бази SlotOK (там вони були відкриті всім).
// Гроші основної картки переносимо, лише якщо вона НЕ була активною в SlotOK:
// у активної живий баланс — це ігровий баланс SlotOK, він там і лишається.
// ═══════════════════════════════════════════════════════════════════
'use strict';

let _prefillProfile = null; // ПІБ зі SlotOK — підставимо у форму відкриття рахунку

function slotActiveCardId(u) {
  const ids = [];
  if (u.virtualCard && u.virtualCard.axiomLinked) ids.push('axiom');
  Object.keys(u.linkedCards || {}).forEach((k) => ids.push(k));
  if (!ids.length) return null;
  return u.activeCardId && ids.indexOf(u.activeCardId) >= 0 ? u.activeCardId : ids[0];
}

async function migrateFromSlotOK(nick, pass) {
  const stored = (await slotDb.ref('users/' + nick + '/pass').once('value')).val();
  if (stored === null || stored === undefined) return 'none';
  let check;
  try { check = await SlotOKPassword.verify(pass, stored); } catch (e) { return 'bad'; }
  if (!check || !check.ok) return 'bad';
  if (pass.length < 6) return 'weak';

  let user;
  try {
    user = (await auth.createUserWithEmailAndPassword(nickEmail(nick), pass)).user;
  } catch (e) {
    // Вхід створила попередня, перервана спроба — просто входимо ним.
    if (e && e.code === 'auth/email-already-in-use') user = (await auth.signInWithEmailAndPassword(nickEmail(nick), pass)).user;
    else throw e;
  }
  if (!(await db.ref('users/' + user.uid + '/nick').once('value')).exists()) await migrateData(nick, user.uid);
  return 'ok';
}

function money(v) { return Math.max(0, Math.round((Number(v) || 0) * 100) / 100); }

function copyCard(src, extra) {
  const c = {
    number: String(src.number || ''), cvv: String(src.cvv || ''), expiry: String(src.expiry || ''),
    holder: String(src.holder || ''), frozen: !!src.frozen, createdAt: Number(src.createdAt) || Date.now(),
  };
  if (src.skin === 'custom-photo' ? PHOTO_RE.test(src.customPhotoUrl || '') : SKIN_BY_ID[src.skin]) {
    c.skin = src.skin;
    if (src.skin === 'custom-photo') c.customPhotoUrl = src.customPhotoUrl;
  }
  return Object.assign(c, extra);
}

async function migrateData(nick, uid) {
  const u = (await slotDb.ref('users/' + nick).once('value')).val() || {};
  const vc = u.virtualCard || {};
  const mainActiveInSlot = slotActiveCardId(u) === 'axiom';
  const now = Date.now();
  const txRef = db.ref('users/' + uid + '/tx');

  const cards = {};
  cards.main = vc.number
    ? copyCard(vc, { type: 'main', balance: mainActiveInSlot ? 0 : money(vc.balance), dayLimit: Math.max(0, Number(vc.dayLimit) || 0) })
    : Object.assign(newCardData(nick), { type: 'main', balance: 0, frozen: false, createdAt: now });
  const oldNumbers = [vc.number];
  Object.keys(u.axiomCards || {}).filter((k) => KEY_RE.test(k) && k !== 'main' && u.axiomCards[k]).forEach((id) => {
    const c = u.axiomCards[id];
    cards[id] = copyCard(c, { type: AX_CARD_TYPES[c.type] ? c.type : 'white', balance: money(c.balance) });
    oldNumbers.push(c.number);
  });

  const savings = {};
  Object.keys(u.axiomSavings || {}).filter((k) => KEY_RE.test(k) && u.axiomSavings[k]).forEach((id) => {
    const j = u.axiomSavings[id];
    savings[id] = {
      name: String(j.name || 'Скарбничка').slice(0, 30), goal: money(j.goal), balance: money(j.balance),
      color: Number.isInteger(j.color) ? j.color : 0, createdAt: Number(j.createdAt) || now,
    };
  });

  // Історія: операції додаткових карток і скарбничок + останні операції основної.
  const tx = {};
  const addTx = (t, acct) => {
    if (!t || !(Number(t.amount) >= 0)) return;
    const row = { acct: acct, dir: t.dir === 'in' ? 'in' : 'out', amount: money(t.amount), title: String(t.title || '').slice(0, 80),
      subtitle: String(t.subtitle || '').slice(0, 80), ts: Number(t.ts) || now };
    if (t.own) row.own = true;
    tx[txRef.push().key] = row;
  };
  Object.values(u.axiomTx || {}).forEach((t) => {
    const acct = String((t && t.acct) || '');
    if (cards[acct] || (acct.startsWith('jar:') && savings[acct.slice(4)])) addTx(t, acct);
  });
  Object.values(u.cardTx || {}).filter((t) => t && t.cardId === 'axiom')
    .sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 50).forEach((t) => addTx(t, 'main'));

  const p = u.axiomProfile;
  _prefillProfile = p && p.firstName ? { lastName: p.lastName || '', firstName: p.firstName || '', middleName: p.middleName || '' } : null;

  const taken = (await db.ref('handles/' + handleOf(nick)).once('value')).val();
  if (taken && taken !== uid) throw new Error('nick taken');
  if (!taken) await db.ref('handles/' + handleOf(nick)).set(uid);
  await db.ref('users/' + uid).set({
    nick: nick, createdAt: firebase.database.ServerValue.TIMESTAMP,
    migratedFrom: 'slotok', migratedAt: now,
    cards: cards, savings: savings, tx: tx,
  });

  // Прибираємо старі дані Аксіоми з бази SlotOK. Якщо не вдасться — гроші
  // вже в Аксіомі, а в SlotOK ці поля більше ніхто не читає.
  const upd = {};
  ['axiomCards', 'axiomSavings', 'axiomTx', 'axiomProfile', 'axiomRefPaid'].forEach((k) => { upd['users/' + nick + '/' + k] = null; });
  upd['users/' + nick + '/virtualCard/migratedToAxioma'] = now;
  if (!mainActiveInSlot) upd['users/' + nick + '/virtualCard/balance'] = 0;
  upd['axiomPublic/' + nick] = null;
  upd['axiomReferrals/' + nick] = null;
  upd['axiomLinkCodes/' + nick] = null;
  oldNumbers.forEach((n) => {
    const d = String(n || '').replace(/\D/g, '');
    if (d.length === 16) upd['axiomCardIndex/' + d] = null;
  });
  try { await slotDb.ref().update(upd); } catch (e) { console.error('slotok cleanup:', e); }
}
