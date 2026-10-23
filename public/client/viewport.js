// public/client/viewport.js - prispôsobenie hry veľkosti obrazovky (mobil, tablet, malé okno; docs/MOBILE.md).
// Celý layout je v pevných pixeloch (políčka 260×185, HUD po bokoch, toolbar dole) a potrebuje aspoň
// DESIGN_W × DESIGN_H CSS px. Na menšej obrazovke sa preto stránka vykreslí ako na „virtuálnej" obrazovke
// --app-w × --app-h (= skutočná / scale, nikdy menšia než dizajn) a <body> sa zmenší jedným transform: scale.
// Fixné prvky sa vďaka transformu na body vzťahujú k body (nie k oknu), takže ostanú pri okrajoch obrazovky.
// Na obrazovke ≥ DESIGN_W × DESIGN_H je scale 1 a nič sa nemení.
// Pravidlo pre zvyšok klienta: nepoužívaj window.innerWidth/innerHeight ani 100vw/100vh - použi appSize()
// resp. var(--app-w)/var(--app-h); súradnice z udalostí (clientX/Y) sú v skutočných px → vydeľ appScale().
export const DESIGN_W = 1720; // HUD (~310) + board (1070) + HUD (~310) + okraje
export const DESIGN_H = 920;  // ROUND nadpis + board s frontom + toolbar dole
// Telefón (dotyk, kratšia strana displeja ≤ 500 px) má vlastné rozloženie (trieda .phone, styles.css „Telefón"):
// HUD zhustený v bočných stĺpcoch, lišta tlačidiel cez celú šírku. Potrebuje menej výšky → board vyjde väčší.
export const PHONE_DESIGN_H = 830;

const root = document.documentElement;
let scale = 1, appW = DESIGN_W, appH = DESIGN_H;
/** Dotykové zariadenie (mobil, tablet). */
export const isTouch = window.matchMedia("(pointer: coarse)").matches;
root.classList.toggle("touch", isTouch);
/** Telefón - kratšia strana fyzického displeja ≤ 500 CSS px (nezávisí od otočenia). Tablety ostávajú pri desktope. */
export const isPhone = isTouch && Math.min(screen.width, screen.height) <= 500;
root.classList.toggle("phone", isPhone);

function fit() {
  // hra ide cez celý displej aj cez výrez kamery (viewport-fit=cover, safe-area-inset sa neodčíta) - rozhodnutie
  // majiteľa 2026-10-23: radšej celá plocha než sivý pás pri kamere; kamera môže prekryť pár px pri okraji
  // clientWidth/Height = layout viewport (nezávisí od pinch zoomu); innerWidth/Height je na niektorých mobilných
  // prehliadačoch (iOS Safari) visual viewport - pri priblížení by sa zoom „zapiekol" do výpočtu
  const vw = Math.max(1, root.clientWidth);
  const vh = Math.max(1, root.clientHeight);
  scale = Math.min(1, vw / DESIGN_W, vh / (isPhone ? PHONE_DESIGN_H : DESIGN_H));
  appW = vw / scale; appH = vh / scale;
  root.style.setProperty("--app-scale", String(scale));
  root.style.setProperty("--app-w", appW + "px");
  root.style.setProperty("--app-h", appH + "px");
  root.classList.toggle("app-scaled", scale < 1);
  // menu ☰, zvukové okno a pod. na dotyku: 1 CSS px = 1 skutočný px displeja (nezmenšuje sa s hrou, prst je
  // vždy rovnako veľký); na desktope sa zmenšujú spolu so stránkou
  root.style.setProperty("--ui-k", String(isTouch ? 1 / scale : 1));
}

/** Zmenšenie stránky (1 = bez zmeny). */
export const appScale = () => scale;
/** Veľkosť „virtuálnej" obrazovky v CSS px layoutu (súradnice pre position: fixed). */
export const appSize = () => ({ w: appW, h: appH });

// Hra sa zmenšuje sama, prehliadačový zoom je vždy 1. Niektoré prehliadače ho však samy zmenia (iOS priblíži pole
// pri písaní, po otočení ostane starý zoom) - prepis viewport meta s minimum-scale=1 ho vráti na 1.
const vpMeta = document.querySelector('meta[name="viewport"]');
function resetZoom() {
  if (!vpMeta || (window.visualViewport?.scale ?? 1) === 1) return;
  const base = vpMeta.content;
  vpMeta.content = base + ", minimum-scale=1";
  setTimeout(() => { vpMeta.content = base; }, 50);
}

fit();
window.addEventListener("resize", fit);
window.addEventListener("orientationchange", () => setTimeout(() => { fit(); resetZoom(); }, 250)); // iOS: rozmery dobehnú až po otočení
document.addEventListener("focusout", (e) => { if (e.target.matches?.("input, textarea")) setTimeout(resetZoom, 100); });

/* ---------- dotykové zariadenia: celá obrazovka + PWA ---------- */
const standalone = window.matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches || navigator.standalone === true;
root.classList.toggle("standalone", standalone);

/** Celá obrazovka + zámok na šírku (Android Chrome; iPhone Safari to nevie - tam pomôže „Pridať na plochu"). */
export const canFullscreen = !!root.requestFullscreen && !standalone;
export async function toggleFullscreen() {
  if (document.fullscreenElement) { await document.exitFullscreen?.().catch(() => {}); return; }
  try {
    await root.requestFullscreen({ navigationUI: "hide" });
    await screen.orientation?.lock?.("landscape").catch(() => {});
  } catch { /* prehliadač odmietol - nič sa nedeje */ }
}
