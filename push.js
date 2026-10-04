// ═══════════════════════════════════════════════════════════════════
// Реєстрація пристрою для push-сповіщень (тільки в Android-додатку,
// зібраному через Capacitor). У звичайному браузері нічого не робить.
// Обробку кнопок «Підтвердити»/«Відхилити» у самому пуші виконує
// нативний код (MainActivity/ConfirmActionReceiver) — тут лише видача
// deviceId/deviceSecret, щоб той нативний код міг ними скористатись.
// ═══════════════════════════════════════════════════════════════════
'use strict';

(function () {
  if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) return;
  const PushNotifications = window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
  const Preferences = window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
  if (!PushNotifications || !Preferences) return;

  let registered = false;

  async function syncDevice(fcmToken) {
    if (!auth || !auth.currentUser) return;
    const idToken = await auth.currentUser.getIdToken();
    const stored = await Preferences.get({ key: 'axDeviceId' });
    const secretStored = await Preferences.get({ key: 'axDeviceSecret' });
    if (stored.value && secretStored.value) {
      await callWorker('/update-token', {
        idToken, deviceId: stored.value, deviceSecret: secretStored.value, fcmToken,
      }).catch((e) => console.error('push update-token:', e));
      return;
    }
    const res = await callWorker('/register-device', { idToken, fcmToken, label: 'Android' });
    await Preferences.set({ key: 'axDeviceId', value: res.deviceId });
    await Preferences.set({ key: 'axDeviceSecret', value: res.deviceSecret });
  }

  async function initPush() {
    if (registered) return;
    registered = true;
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return;
    await PushNotifications.register();
  }

  PushNotifications.addListener('registration', (token) => {
    syncDevice(token.value).catch((e) => console.error('push register:', e));
  });
  PushNotifications.addListener('registrationError', (e) => console.error('push registration error:', e));

  if (auth) {
    auth.onAuthStateChanged((user) => { if (user) initPush(); });
  }
})();
