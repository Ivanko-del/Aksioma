// Копіює вебфайли з кореня репозиторію в www/ — теку, яку Capacitor
// пакує в Android-додаток. www/ — згенерована, у git не йде.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const FILES = [
  'index.html', 'app.js', 'bank.js', 'social.js', 'migrate.js',
  'motion.js', 'password.js', 'skins.js', 'confirm.js', 'push.js', 'style.css',
  'manifest.json', 'sw.js', 'install-banner.js',
];

fs.mkdirSync(WWW, { recursive: true });
for (const f of FILES) {
  fs.copyFileSync(path.join(ROOT, f), path.join(WWW, f));
}

const ICONS_SRC = path.join(ROOT, 'icons');
const ICONS_DST = path.join(WWW, 'icons');
fs.mkdirSync(ICONS_DST, { recursive: true });
for (const f of fs.readdirSync(ICONS_SRC)) {
  fs.copyFileSync(path.join(ICONS_SRC, f), path.join(ICONS_DST, f));
}

console.log('www/ synced (' + FILES.length + ' files + icons/)');
