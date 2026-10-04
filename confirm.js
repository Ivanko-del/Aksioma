// ═══════════════════════════════════════════════════════════════════
// Міст до Cloudflare Worker: будь-яка зміна балансу йде тільки через
// нього (правила бази забороняють клієнту писати в balance напряму).
// Для операцій із підтвердженням — показує шторку очікування й чекає
// рішення через pendingOps/<uid>/<opId> у реальному часі.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const WORKER_URL = 'https://aksioma-worker.ivankolodeev2.workers.dev';

async function callWorker(path, body) {
  let res, data;
  try {
    res = await fetch(WORKER_URL + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    data = await res.json();
  } catch (e) {
    throw new Error('Немає звʼязку з сервером. Перевір інтернет');
  }
  if (!res.ok) throw new Error(data.error || 'Помилка сервера');
  return data;
}

async function workerIdToken() {
  if (!auth || !auth.currentUser) throw new Error('Не авторизовано');
  return auth.currentUser.getIdToken();
}

// Викликає операцію на Worker. Для авто-операцій резолвиться одразу;
// для тих, що потребують підтвердження в пуші — чекає рішення (до 2 хв).
async function requestOp(type, payload) {
  const idToken = await workerIdToken();
  const res = await callWorker('/request-op', { idToken, type, payload });
  if (res.status === 'done') return true;
  if (res.status === 'failed') throw new Error(res.error || 'Операція не виконана');
  return waitForOp(res.opId, res.expiresAt, type, payload);
}

function waitForOp(opId, expiresAt, type, payload) {
  return new Promise((resolve, reject) => {
    const ref = db.ref('pendingOps/' + currentUid + '/' + opId);
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; ref.off('value', cb); closeWaitingSheet(); fn(arg); };
    const timer = setTimeout(() => finish(reject, new Error('Час на підтвердження вийшов')), Math.max(1000, expiresAt - Date.now() + 3000));
    function cb(snap) {
      const v = snap.val();
      if (!v || v.status === 'pending') return;
      clearTimeout(timer);
      if (v.status === 'done') finish(resolve, true);
      else if (v.status === 'declined') finish(reject, new Error('Відхилено в застосунку'));
      else if (v.status === 'expired') finish(reject, new Error('Час на підтвердження вийшов'));
      else finish(reject, new Error(v.errorMsg || 'Операція не виконана'));
    }
    ref.on('value', cb);
    showWaitingSheet(expiresAt, describeOpClient(type, payload));
  });
}

function describeOpClient(type, payload) {
  const amt = fmt(Number(payload.amount) || 0);
  if (type === 'p2p-transfer') return 'Переказ ' + amt + ' ₴' + (payload.toName ? ' → ' + payload.toName : '');
  if (type === 'sdk-withdraw') return 'Списання ' + amt + ' ₴' + (payload.project ? ' · ' + payload.project : '');
  return 'Операція на ' + amt + ' ₴';
}

let _waitTimer = null;
function showWaitingSheet(expiresAt, desc) {
  openSheet('Підтвердь у додатку', '' +
    '<div class="waiting-op">' +
      '<div class="waiting-spinner" aria-hidden="true"></div>' +
      '<p>' + esc(desc) + '</p>' +
      '<p class="muted">Відкрий пуш-сповіщення на телефоні й натисни «Підтвердити» або «Відхилити».</p>' +
      '<p class="muted" id="axWaitTimer"></p>' +
    '</div>'
  );
  clearInterval(_waitTimer);
  _waitTimer = setInterval(() => {
    const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    const el = document.getElementById('axWaitTimer');
    if (el) el.textContent = left > 0 ? ('Залишилось: ' + left + ' с') : 'Час вийшов';
    if (left <= 0) clearInterval(_waitTimer);
  }, 500);
}
function closeWaitingSheet() {
  clearInterval(_waitTimer);
  closeSheet();
}
