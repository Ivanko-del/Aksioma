// Банер «встанови застосунок»: на Android пропонує завантажити APK,
// на iOS/десктопі — встановити як PWA (беручи системний install-prompt, якщо є).
(function () {
  if (window.Capacitor) return; // усередині самого застосунку банер не потрібен

  const DISMISS_KEY = 'installBannerDismissedAt';
  const DISMISS_DAYS = 14;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return;

  const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
  if (dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 86400000) return;

  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isAndroid) show();
  });

  const banner = document.getElementById('installBanner');
  const sub = document.getElementById('installBannerSub');
  const btn = document.getElementById('installBannerBtn');
  const closeBtn = document.getElementById('installBannerClose');
  if (!banner) return;

  function show() {
    banner.classList.remove('hidden');
  }
  function dismiss() {
    banner.classList.add('hidden');
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  }

  closeBtn.addEventListener('click', dismiss);

  if (isAndroid) {
    sub.textContent = 'Android-застосунок (.apk)';
    btn.textContent = 'Завантажити APK';
    btn.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = 'Aksioma.apk';
      a.download = 'Aksioma.apk';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    show();
  } else if (isIOS) {
    sub.textContent = 'Додай на головний екран через «Поділитися»';
    btn.textContent = 'Як встановити';
    btn.addEventListener('click', () => {
      toast('Натисни "Поділитися" внизу браузера → "На екран «Домівка»"');
    });
    show();
  } else {
    sub.textContent = 'Швидший запуск і офлайн-доступ';
    btn.textContent = 'Встановити';
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      dismiss();
    });
    // показуємо лише коли браузер справді готовий запропонувати встановлення
  }
})();
