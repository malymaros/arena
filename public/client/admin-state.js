// public/client/admin-state.js - či je prihlásený hráč admin (prihlásil sa admin heslom). Posiela to server
// udalosťou `session` hneď po pripojení (net.js ju sem zapíše); admin sekcia menu a reset tlačidlá sa podľa
// toho ukážu. Bez závislosti na sockete, aby ho mohli importovať net.js aj UI moduly bez kruhu.
let admin = false;
const listeners = new Set();

export const isAdmin = () => admin;
export function setAdmin(v) {
  admin = !!v;
  document.documentElement.classList.toggle("admin", admin);
  listeners.forEach(f => f(admin));
}
export const onAdminChange = (f) => { listeners.add(f); };
