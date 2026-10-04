// ═══════════════════════════════════════════════════════════════════
// Аксіома — Cloudflare Worker: бекенд для push-сповіщень і підтвердження
// операцій. Тримає сервісний акаунт Firebase, тому єдиний, хто справді
// може змінювати баланси (клієнтам правила бази це забороняють).
//
// Ендпоінти (усі POST, JSON):
//   /register-device  { idToken, fcmToken, label } -> { deviceId, deviceSecret }
//   /update-token      { idToken, deviceId, deviceSecret, fcmToken } -> { ok }
//   /notify            { idToken, title, body } -> { ok, sent }
//   /request-op        { idToken, type, payload } -> { opId, status, ... }
//   /respond-op        { uid, deviceId, deviceSecret, opId, decision } -> { ok, status }
// ═══════════════════════════════════════════════════════════════════

const APPROVAL_TYPES = new Set(['p2p-transfer', 'sdk-withdraw']);
const OP_TTL_MS = 120000; // 2 хвилини на підтвердження в пуші
const REF_BONUS = 100;
const REF_MAX = 50;
const P2P_MIN = 10;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders()),
  });
}
function fail(status, msg) { return json({ error: msg }, status); }

// ── base64url / крипто-хелпери ────────────────────────────────────
function b64url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function textToB64url(s) { return b64url(new TextEncoder().encode(s)); }
function randomHex(nBytes) {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
}
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// ── OAuth2 доступ до Google API через сервісний акаунт ────────────
let _tokenCache = { token: null, exp: 0 };
async function getGoogleAccessToken(env) {
  if (_tokenCache.token && Date.now() < _tokenCache.exp - 60000) return _tokenCache.token;
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = textToB64url(JSON.stringify(header)) + '.' + textToB64url(JSON.stringify(claim));
  const keyData = pemToArrayBuffer(env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'));
  const key = await crypto.subtle.importKey(
    'pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64url(sig);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('google token: ' + JSON.stringify(data));
  _tokenCache = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

// ── Перевірка Firebase ID token (без firebase-admin, через JWKS) ──
let _jwksCache = { keys: null, exp: 0 };
async function getFirebaseJwks() {
  if (_jwksCache.keys && Date.now() < _jwksCache.exp) return _jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const data = await res.json();
  _jwksCache = { keys: data.keys, exp: Date.now() + 3600000 };
  return data.keys;
}
async function verifyIdToken(idToken, projectId) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('bad token');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('token expired');
  if (payload.aud !== projectId) throw new Error('bad audience');
  if (payload.iss !== 'https://securetoken.google.com/' + projectId) throw new Error('bad issuer');
  if (!payload.sub) throw new Error('no subject');

  const keys = await getFirebaseJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  if (!ok) throw new Error('bad signature');
  return { uid: payload.sub, email: payload.email || '' };
}

// ── RTDB REST ──────────────────────────────────────────────────────
function rtdbUrl(env, path) { return env.FIREBASE_DB_URL + '/' + path + '.json'; }
async function rtdbGet(env, token, path) {
  const res = await fetch(rtdbUrl(env, path), { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('rtdb get ' + path + ': ' + res.status);
  return res.json();
}
async function rtdbPut(env, token, path, data) {
  const res = await fetch(rtdbUrl(env, path), {
    method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('rtdb put ' + path + ': ' + res.status + ' ' + (await res.text()));
  return res.json();
}
async function rtdbPatch(env, token, path, data) {
  const res = await fetch(rtdbUrl(env, path), {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('rtdb patch ' + path + ': ' + res.status + ' ' + (await res.text()));
  return res.json();
}
async function rtdbDelete(env, token, path) {
  const res = await fetch(rtdbUrl(env, path), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('rtdb delete ' + path + ': ' + res.status);
}
async function rtdbPush(env, token, path, data) {
  const res = await fetch(rtdbUrl(env, path), {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('rtdb push ' + path + ': ' + res.status);
  return res.json(); // { name: "<new key>" }
}

async function getUserEmail(env, gToken, uid) {
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + gToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: [uid] }),
  });
  const data = await res.json();
  if (!res.ok || !data.users || !data.users[0]) throw new Error('user lookup failed');
  return data.users[0].email || '';
}

function round2(n) { return Math.round(n * 100) / 100; }
function dayKeyNow() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

// ── FCM push ───────────────────────────────────────────────────────
async function sendFcm(env, token, fcmToken, { title, body, data, actions }) {
  const message = {
    token: fcmToken,
    data: Object.assign({ title: title || '', body: body || '' }, data || {}),
    android: { priority: 'high' },
  };
  if (!actions) {
    message.notification = { title, body };
  }
  const res = await fetch('https://fcm.googleapis.com/v1/projects/' + env.FIREBASE_PROJECT_ID + '/messages:send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) console.error('fcm send failed', res.status, await res.text());
}
async function notifyAllDevices(env, gToken, uid, payload) {
  const devices = (await rtdbGet(env, gToken, 'users/' + uid + '/devices')) || {};
  const sends = Object.values(devices).filter((d) => d && d.fcmToken).map((d) => sendFcm(env, gToken, d.fcmToken, payload));
  await Promise.all(sends);
  return sends.length;
}

// ── Виконання операцій (спільна логіка для авто- й ручного підтвердження) ──
async function execOp(env, gToken, uid, type, payload, email) {
  const myHandle = String(email || '').split('@')[0];
  const user = (await rtdbGet(env, gToken, 'users/' + uid)) || {};
  const cards = user.cards || {};
  const savings = user.savings || {};

  function resolveBalPath(key) {
    const [kind, id] = String(key).split(':');
    if (kind === 'card') { if (!cards[id]) return null; return { path: 'users/' + uid + '/cards/' + id + '/balance', node: cards[id], main: id === 'main' }; }
    if (kind === 'jar') { if (!savings[id]) return null; return { path: 'users/' + uid + '/savings/' + id + '/balance', node: savings[id], main: false }; }
    return null;
  }
  function mainLimitLeft() {
    const c = cards.main || {};
    const lim = Math.max(0, Number(c.dayLimit) || 0);
    if (!lim) return Infinity;
    const spent = c.dayKey === dayKeyNow() ? (Number(c.daySpent) || 0) : 0;
    return Math.max(0, lim - spent);
  }
  async function noteMainSpend(amount) {
    const c = cards.main || {};
    if (!(Number(c.dayLimit) > 0)) return;
    const key = dayKeyNow();
    const spent = (c.dayKey === key ? (Number(c.daySpent) || 0) : 0) + amount;
    await rtdbPatch(env, gToken, 'users/' + uid + '/cards/main', { dayKey: key, daySpent: round2(spent) });
  }
  async function pushTx(acct, tx) {
    await rtdbPush(env, gToken, 'users/' + uid + '/tx', Object.assign({ acct, ts: Date.now() }, tx));
  }
  async function debit(balPath, amount) {
    // Умовний запис через ETag — захист від одночасних списань.
    const getRes = await fetch(rtdbUrl(env, balPath), {
      headers: { Authorization: 'Bearer ' + gToken, 'X-Firebase-ETag': 'true' },
    });
    const etag = getRes.headers.get('ETag');
    const cur = Number(await getRes.json()) || 0;
    if (cur + 1e-9 < amount) throw { axioma: true, msg: 'Недостатньо коштів' };
    const putRes = await fetch(rtdbUrl(env, balPath), {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + gToken, 'Content-Type': 'application/json', 'if-match': etag },
      body: JSON.stringify(round2(cur - amount)),
    });
    if (putRes.status === 412) throw { axioma: true, msg: 'Спробуй ще раз — баланс щойно змінився' };
    if (!putRes.ok) throw new Error('debit failed: ' + putRes.status);
    return round2(cur - amount);
  }
  async function credit(balPath, amount) {
    const cur = Number(await rtdbGet(env, gToken, balPath)) || 0;
    await rtdbPut(env, gToken, balPath, round2(cur + amount));
  }

  if (type === 'own-transfer') {
    const { fromKey, toKey, amount } = payload;
    const amt = round2(Number(amount) || 0);
    const from = resolveBalPath(fromKey), to = resolveBalPath(toKey);
    if (!from || !to) throw { axioma: true, msg: 'Рахунок не знайдено' };
    if (fromKey === toKey) throw { axioma: true, msg: 'Обери різні рахунки' };
    if (!(amt > 0) || amt > 1e9) throw { axioma: true, msg: 'Введи суму більше нуля' };
    if (from.node.frozen) throw { axioma: true, msg: 'Картку-відправника заблоковано' };
    if (from.main && amt > mainLimitLeft()) throw { axioma: true, msg: 'Денний ліміт основної картки вичерпано' };
    await debit(from.path, amt);
    await credit(to.path, amt);
    if (from.main) await noteMainSpend(amt);
    const fromName = from.main ? 'Основна картка' : (fromKey.startsWith('jar') ? 'Скарбничка' : 'Картка');
    const toName = to.main ? 'Основна картка' : (toKey.startsWith('jar') ? 'Скарбничка' : 'Картка');
    const acctField = (key) => (key.startsWith('card:') ? key.slice(5) : key); // картка -> лише id, скарбничка -> "jar:id"
    await Promise.all([
      pushTx(acctField(fromKey), { dir: 'out', amount: amt, title: 'Переказ → ' + toName, subtitle: 'Між своїми рахунками', own: true }),
      pushTx(acctField(toKey), { dir: 'in', amount: amt, title: 'Переказ ← ' + fromName, subtitle: 'Між своїми рахунками', own: true }),
    ]);
    return { title: 'Переказ між своїми рахунками', body: fmtUAH(amt) + ' ₴ переказано' };
  }

  if (type === 'p2p-transfer') {
    const { fromCardId, toCardNumber, amount, note } = payload;
    const amt = round2(Number(amount) || 0);
    const from = cards[fromCardId];
    if (!from) throw { axioma: true, msg: 'Картку не знайдено' };
    if (!(amt >= P2P_MIN) || amt > 1e9) throw { axioma: true, msg: 'Мінімальна сума переказу — ' + P2P_MIN + ' ₴' };
    if (from.frozen) throw { axioma: true, msg: 'Картку заблоковано' };
    if (fromCardId === 'main' && amt > mainLimitLeft()) throw { axioma: true, msg: 'Денний ліміт основної картки вичерпано' };
    const idx = await rtdbGet(env, gToken, 'cardIndex/' + String(toCardNumber).replace(/\D/g, ''));
    if (!idx || !idx.uid) throw { axioma: true, msg: 'Картку отримувача не знайдено' };
    if (idx.uid === uid) throw { axioma: true, msg: 'Для своїх карток є переказ між своїми рахунками' };
    const myProfile = user.profile || {};
    const myName = myProfile.firstName ? myProfile.firstName + (myProfile.lastName ? ' ' + myProfile.lastName.charAt(0) + '.' : '') : '';
    await debit('users/' + uid + '/cards/' + fromCardId + '/balance', amt);
    await rtdbPush(env, gToken, 'inbox/' + idx.uid, {
      fromHandle: myHandle, fromName: myName || myHandle,
      amount: amt, note: note || '', card: idx.card || 'main', ts: Date.now(),
    });
    if (fromCardId === 'main') await noteMainSpend(amt);
    await pushTx(fromCardId, { dir: 'out', amount: amt, title: 'Переказ: ' + (payload.toName || '@' + (idx.handle || '')), subtitle: note || '', p2p: true });
    return { title: 'Переказ гравцю', body: fmtUAH(amt) + ' ₴ відправлено' };
  }

  if (type === 'claim-inbox') {
    const { inboxId } = payload;
    const it = await rtdbGet(env, gToken, 'inbox/' + uid + '/' + inboxId);
    if (!it) return { title: '', body: '', noop: true };
    const amt = round2(Number(it.amount) || 0);
    if (!(amt > 0)) { await rtdbDelete(env, gToken, 'inbox/' + uid + '/' + inboxId); return { noop: true }; }
    const cardId = it.card && cards[it.card] ? it.card : 'main';
    await rtdbDelete(env, gToken, 'inbox/' + uid + '/' + inboxId);
    await credit('users/' + uid + '/cards/' + cardId + '/balance', amt);
    return { title: 'Гроші надійшли', body: '+' + fmtUAH(amt) + ' ₴' + (it.fromName ? ' від ' + it.fromName : '') };
  }

  if (type === 'claim-referrals') {
    const refs = (await rtdbGet(env, gToken, 'referrals/' + myHandle)) || {};
    const refPaid = user.refPaid || {};
    const todo = Object.keys(refs).filter((h) => h !== myHandle && !refPaid[h]);
    let got = 0;
    for (const h of todo) {
      if (Object.keys(refPaid).length + Math.floor(got / REF_BONUS) >= REF_MAX) break;
      await rtdbPut(env, gToken, 'users/' + uid + '/refPaid/' + h, Date.now());
      await credit('users/' + uid + '/cards/main/balance', REF_BONUS);
      await pushTx('main', { dir: 'in', amount: REF_BONUS, title: 'Бонус за друга: @' + h, subtitle: 'Реферальна програма', ref: true });
      got += REF_BONUS;
    }
    if (!got) return { noop: true };
    return { title: 'Реферальний бонус', body: '+' + fmtUAH(got) + ' ₴ за друзів' };
  }

  if (type === 'sdk-withdraw') {
    const { amount, project, title } = payload;
    const amt = round2(Number(amount) || 0);
    const card = cards.main;
    if (!card) throw { axioma: true, msg: 'Картку Аксіоми ще не випущено' };
    if (!(amt > 0)) throw { axioma: true, msg: 'Некоректна сума' };
    if (project && !(user.partners && user.partners[project])) throw { axioma: true, msg: 'Проєкт не підключено до картки' };
    if (card.frozen) throw { axioma: true, msg: 'Картку заблоковано' };
    if (amt > mainLimitLeft()) throw { axioma: true, msg: 'Денний ліміт картки вичерпано' };
    await debit('users/' + uid + '/cards/main/balance', amt);
    await noteMainSpend(amt);
    await pushTx('main', { dir: 'out', amount: amt, title: title || 'Списання', subtitle: project || '', partner: project || '' });
    return { title: 'Списання: ' + (project || 'проєкт'), body: '-' + fmtUAH(amt) + ' ₴' + (title ? ' · ' + title : '') };
  }

  if (type === 'sdk-deposit') {
    const { amount, project, title } = payload;
    const amt = round2(Number(amount) || 0);
    if (!(amt > 0)) throw { axioma: true, msg: 'Некоректна сума' };
    if (!cards.main) throw { axioma: true, msg: 'Картку Аксіоми ще не випущено' };
    await credit('users/' + uid + '/cards/main/balance', amt);
    await pushTx('main', { dir: 'in', amount: amt, title: title || 'Зарахування', subtitle: project || '', partner: project || '' });
    return { title: 'Зарахування: ' + (project || 'проєкт'), body: '+' + fmtUAH(amt) + ' ₴' + (title ? ' · ' + title : '') };
  }

  throw { axioma: true, msg: 'Невідомий тип операції' };
}
function fmtUAH(n) { return new Intl.NumberFormat('uk-UA').format(n); }

// ── Хендлери ендпоінтів ─────────────────────────────────────────────
async function handleRegisterDevice(req, env) {
  const body = await req.json();
  const { uid } = await verifyIdToken(body.idToken, env.FIREBASE_PROJECT_ID);
  const gToken = await getGoogleAccessToken(env);
  const deviceId = randomHex(8);
  const deviceSecret = randomHex(24);
  const secretHash = await sha256Hex(deviceSecret);
  await rtdbPut(env, gToken, 'users/' + uid + '/devices/' + deviceId, {
    fcmToken: body.fcmToken || '', secretHash, label: body.label || 'Android', createdAt: Date.now(),
  });
  return json({ deviceId, deviceSecret });
}

async function handleUpdateToken(req, env) {
  const body = await req.json();
  const { uid } = await verifyIdToken(body.idToken, env.FIREBASE_PROJECT_ID);
  const gToken = await getGoogleAccessToken(env);
  const dev = await rtdbGet(env, gToken, 'users/' + uid + '/devices/' + body.deviceId);
  if (!dev || dev.secretHash !== (await sha256Hex(body.deviceSecret))) return fail(403, 'bad device');
  await rtdbPatch(env, gToken, 'users/' + uid + '/devices/' + body.deviceId, { fcmToken: body.fcmToken || '' });
  return json({ ok: true });
}

async function handleNotify(req, env) {
  const body = await req.json();
  const { uid } = await verifyIdToken(body.idToken, env.FIREBASE_PROJECT_ID);
  const gToken = await getGoogleAccessToken(env);
  const sent = await notifyAllDevices(env, gToken, uid, { title: body.title, body: body.body });
  return json({ ok: true, sent });
}

async function handleRequestOp(req, env) {
  const body = await req.json();
  const { uid, email } = await verifyIdToken(body.idToken, env.FIREBASE_PROJECT_ID);
  const gToken = await getGoogleAccessToken(env);
  const type = body.type;
  const payload = body.payload || {};
  const opId = randomHex(12);
  const now = Date.now();

  if (!APPROVAL_TYPES.has(type)) {
    try {
      const result = await execOp(env, gToken, uid, type, payload, email);
      await rtdbPut(env, gToken, 'pendingOps/' + uid + '/' + opId, {
        type, payload, status: 'done', createdAt: now, resolvedAt: Date.now(),
      });
      if (result && !result.noop) await notifyAllDevices(env, gToken, uid, { title: result.title, body: result.body });
      return json({ opId, status: 'done' });
    } catch (e) {
      const msg = (e && e.axioma) ? e.msg : 'Операція не виконана';
      await rtdbPut(env, gToken, 'pendingOps/' + uid + '/' + opId, { type, payload, status: 'failed', errorMsg: msg, createdAt: now });
      return json({ opId, status: 'failed', error: msg });
    }
  }

  const expiresAt = now + OP_TTL_MS;
  await rtdbPut(env, gToken, 'pendingOps/' + uid + '/' + opId, { type, payload, status: 'pending', createdAt: now, expiresAt });
  const devices = (await rtdbGet(env, gToken, 'users/' + uid + '/devices')) || {};
  const desc = describeOp(type, payload);
  const sends = Object.values(devices).filter((d) => d && d.fcmToken).map((d) => sendFcm(env, gToken, d.fcmToken, {
    title: 'Підтвердь операцію', body: desc,
    actions: true,
    data: { kind: 'confirm-op', opId, uid, title: 'Підтвердь операцію', body: desc },
  }));
  await Promise.all(sends);
  return json({ opId, status: 'pending', expiresAt });
}

function describeOp(type, payload) {
  const amt = fmtUAH(round2(Number(payload.amount) || 0));
  if (type === 'p2p-transfer') return 'Переказ ' + amt + ' ₴' + (payload.toName ? ' → ' + payload.toName : '');
  if (type === 'sdk-withdraw') return 'Списання ' + amt + ' ₴' + (payload.project ? ' · ' + payload.project : '') + (payload.title ? ' (' + payload.title + ')' : '');
  return 'Операція на ' + amt + ' ₴';
}

async function handleRespondOp(req, env) {
  const body = await req.json();
  const { uid, deviceId, deviceSecret, opId, decision } = body;
  if (!uid || !deviceId || !deviceSecret || !opId || !['approve', 'decline'].includes(decision)) return fail(400, 'bad request');
  const gToken = await getGoogleAccessToken(env);

  const dev = await rtdbGet(env, gToken, 'users/' + uid + '/devices/' + deviceId);
  if (!dev || dev.secretHash !== (await sha256Hex(deviceSecret))) return fail(403, 'bad device');

  const op = await rtdbGet(env, gToken, 'pendingOps/' + uid + '/' + opId);
  if (!op) return fail(404, 'op not found');
  if (op.status !== 'pending') return json({ ok: true, status: op.status }); // вже оброблено (інший пристрій/дубль)
  if (Date.now() > op.expiresAt) {
    await rtdbPatch(env, gToken, 'pendingOps/' + uid + '/' + opId, { status: 'expired' });
    return json({ ok: true, status: 'expired' });
  }

  if (decision === 'decline') {
    await rtdbPatch(env, gToken, 'pendingOps/' + uid + '/' + opId, { status: 'declined', resolvedAt: Date.now() });
    await notifyAllDevices(env, gToken, uid, { title: 'Операцію відхилено', body: describeOp(op.type, op.payload) });
    return json({ ok: true, status: 'declined' });
  }

  try {
    const email = await getUserEmail(env, gToken, uid);
    const result = await execOp(env, gToken, uid, op.type, op.payload, email);
    await rtdbPatch(env, gToken, 'pendingOps/' + uid + '/' + opId, { status: 'done', resolvedAt: Date.now() });
    await notifyAllDevices(env, gToken, uid, { title: 'Підтверджено', body: result.body || describeOp(op.type, op.payload) });
    return json({ ok: true, status: 'done' });
  } catch (e) {
    const msg = (e && e.axioma) ? e.msg : 'Не вдалося виконати операцію';
    await rtdbPatch(env, gToken, 'pendingOps/' + uid + '/' + opId, { status: 'failed', errorMsg: msg, resolvedAt: Date.now() });
    await notifyAllDevices(env, gToken, uid, { title: 'Операція не виконана', body: msg });
    return json({ ok: true, status: 'failed', error: msg });
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/ping') return json({ ok: true });
      if (request.method !== 'POST') return fail(405, 'method not allowed');
      switch (url.pathname) {
        case '/register-device': return await handleRegisterDevice(request, env);
        case '/update-token': return await handleUpdateToken(request, env);
        case '/notify': return await handleNotify(request, env);
        case '/request-op': return await handleRequestOp(request, env);
        case '/respond-op': return await handleRespondOp(request, env);
        default: return fail(404, 'not found');
      }
    } catch (e) {
      console.error(e);
      return fail(500, String((e && e.message) || e));
    }
  },
};
