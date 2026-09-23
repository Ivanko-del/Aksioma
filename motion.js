// ═══════════════════════════════════════════════════════════════════
// Аксіома Банк — анімації інтерфейсу.
// Лічильники сум, поява нових рядків, хвилі від натискань, свайп шторки,
// трясіння при помилці, заставка під час завантаження.
// Усе вимикається, якщо в системі ввімкнено «Зменшити рух».
// ═══════════════════════════════════════════════════════════════════
'use strict';

const _rmQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
function reducedMotion() { return !!(_rmQuery && _rmQuery.matches); }

// ── Лічильник суми ─────────────────────────────────────────────────
// Перший показ рахує від нуля, далі — від попереднього значення.
// flash: підсвітити зеленим/червоним, якщо сума зросла/зменшилась.
function animNum(el, value, o) {
  if (!el) return;
  o = o || {};
  value = Number(value) || 0;
  const pre = o.prefix || '', suf = o.suffix || '';
  const show = (v) => { el.textContent = pre + fmt(v) + suf; };
  const from = el._axNum;
  if (from === value) { if (!el._axRaf) show(value); return; }
  el._axNum = value;
  cancelAnimationFrame(el._axRaf);
  el._axRaf = 0;
  if (reducedMotion() || document.hidden) { show(value); return; }
  const start = from === undefined ? 0 : from;
  if (from !== undefined && o.flash !== false) {
    el.classList.remove('num-up', 'num-down');
    void el.offsetWidth;
    el.classList.add(value > from ? 'num-up' : 'num-down');
  }
  const whole = Number.isInteger(start) && Number.isInteger(value);
  const dur = 750, t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const v = start + (value - start) * (1 - Math.pow(1 - k, 3));
    show(k < 1 ? (whole ? Math.round(v) : v) : value);
    el._axRaf = k < 1 ? requestAnimationFrame(step) : 0;
  };
  el._axRaf = requestAnimationFrame(step);
}

// Числа в щойно відкритій шторці: <span data-count="123.5" data-prefix="+" data-suffix=" ₴">
function animCounters(root) {
  root.querySelectorAll('[data-count]').forEach((el) => {
    animNum(el, Number(el.dataset.count), { prefix: el.dataset.prefix || '', suffix: el.dataset.suffix || '', flash: false });
  });
}

// ── Список із появою нових рядків ──────────────────────────────────
// Перемальовує контейнер, лише якщо HTML змінився; рядки, яких не було
// раніше, з'являються по черзі. Повертає true, якщо було перемальовано.
function setListHtml(el, html) {
  if (!el || el._axHtml === html) return false;
  const prev = new Set(el._axRows || []);
  el._axHtml = html;
  el.innerHTML = html;
  const rows = Array.from(el.children);
  el._axRows = rows.map((r) => r.outerHTML);
  if (reducedMotion()) return true;
  let n = 0;
  rows.forEach((r, i) => {
    if (prev.has(el._axRows[i])) return;
    r.style.setProperty('--i', Math.min(n++, 10));
    r.classList.add('ax-enter');
  });
  return true;
}

// Кільця скарбничок доростають від попереднього значення.
const _ringPrev = {};
function animRings(root) {
  root.querySelectorAll('.ring-fg[data-id]').forEach((c) => {
    const id = c.dataset.id, off = c.getAttribute('stroke-dashoffset');
    const from = _ringPrev[id] !== undefined ? _ringPrev[id] : c.getAttribute('stroke-dasharray');
    _ringPrev[id] = off;
    if (from !== off && !reducedMotion()) { c.style.setProperty('--from', from); c.classList.add('is-growing'); }
  });
}

// ── Хвиля від натискання ───────────────────────────────────────────
const RIPPLE_SEL = '.btn, .action-btn, .menu-row, .chip-btn, .jar, .pill-btn, .choice-row, .promo, .icon-btn, .tab, .skin-tile, .type-opt, .avatar, .swap-btn';
document.addEventListener('pointerdown', (e) => {
  if (reducedMotion() || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const host = e.target.closest(RIPPLE_SEL);
  if (!host || host.disabled) return;
  const r = host.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const w = document.createElement('ax-ripple');
  w.style.width = w.style.height = size + 'px';
  w.style.left = (e.clientX - r.left - size / 2) + 'px';
  w.style.top = (e.clientY - r.top - size / 2) + 'px';
  host.appendChild(w);
  w.addEventListener('animationend', () => w.remove());
  setTimeout(() => w.remove(), 900);
}, { passive: true });

// Кнопка «поміняти місцями» у переказі крутиться на півоберта.
document.addEventListener('click', (e) => {
  const b = e.target.closest('.swap-btn');
  if (!b) return;
  b._axTurn = (b._axTurn || 0) + 180;
  b.style.setProperty('--turn', b._axTurn + 'deg');
});

// ── Шторка: свайп донизу, щоб закрити ──────────────────────────────
(function () {
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const sheet = e.target.closest('#axSheet .sheet');
    if (!sheet || !e.target.closest('.sheet-grip, .sheet-head') || e.target.closest('button, input, a, select')) return;
    drag = { sheet: sheet, y0: e.clientY, t0: performance.now(), dy: 0, id: e.pointerId };
    sheet.classList.add('is-dragging');
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, e.clientY - drag.y0);
    drag.sheet.style.transform = drag.dy ? 'translateY(' + drag.dy + 'px)' : '';
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.sheet.classList.remove('is-dragging');
    const speed = d.dy / Math.max(1, performance.now() - d.t0);
    if (d.dy > 110 || (d.dy > 40 && speed > 0.6)) { closeSheet(); return; }
    d.sheet.style.transform = '';
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
})();

// ── Трясіння, коли з'являється текст помилки ───────────────────────
const ERR_SEL = '.auth-error, .form-note.is-error, #axJarErr';
function shake(el) {
  if (!el || reducedMotion() || !el.animate) return;
  el.animate(
    [0, -2, 5, -7, 7, -7, 5, -2, 0].map((x) => ({ translate: x + 'px 0' })),
    { duration: 450, easing: 'cubic-bezier(.36,.07,.19,.97)' });
}
new MutationObserver((list) => {
  const seen = new Set();
  list.forEach((m) => {
    const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    if (!el || seen.has(el) || !el.matches(ERR_SEL) || !el.textContent.trim()) return;
    seen.add(el);
    shake(el.closest('.auth-card') || el);
  });
}).observe(document.documentElement, { childList: true, characterData: true, subtree: true });

// ── Заставка, поки Firebase визначає, хто зайшов ───────────────────
document.addEventListener('DOMContentLoaded', () => {
  const splash = document.getElementById('bootSplash');
  if (!splash) return;
  const screens = ['authScreen', 'onboardScreen', 'appScreen'].map((id) => document.getElementById(id)).filter(Boolean);
  const done = () => {
    if (!screens.some((s) => !s.classList.contains('hidden'))) return false;
    splash.classList.add('is-done');
    setTimeout(() => splash.remove(), 500);
    obs.disconnect();
    return true;
  };
  const obs = new MutationObserver(done);
  screens.forEach((s) => obs.observe(s, { attributes: true, attributeFilter: ['class'] }));
  done();
});
