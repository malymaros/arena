// public/client/bug-report.js - okno REPORT BUG (otvára ho menu ☰): textový formulár, hráč napíše, čo sa stalo, a
// odošle (socket `bug_report`). Automaticky sa pribalí zariadenie (MOBILE / TABLET / PC podľa toho istého určenia,
// aké používa rozloženie hry - viewport.js), systém, prehliadač, nainštalovaná appka, obrazovka, grafika, aktuálna
// obrazovka hry a posledné JS chyby. Server doplní zápas (telemetria → replay), kolo a stranu - meno hráča nie.
// Okno sa roluje (na telefóne sa nevojde); keď na dotyku vyskočí klávesnica, prilepí sa k hornému okraju viditeľnej
// časti obrazovky a jeho výška sa zmenší na ňu (visualViewport - iOS layout viewport nezmenší).
import { socket } from "/client/net.js";
import { isTouch, isPhone, appScale } from "/client/viewport.js";
import { perf } from "/client/perf.js";
import { state, isSpectator } from "/client/session.js";

const TEXT_MAX = 1000;

// posledné JS chyby (zbierajú sa od načítania stránky - modul sa načíta s menu)
const errors = [];
const noteError = (msg) => { errors.push(`${new Date().toISOString().slice(11, 19)} ${msg}`.slice(0, 300)); if (errors.length > 5) errors.shift(); };
window.addEventListener("error", (e) => noteError(`${e.message} @ ${(e.filename || "").split("/").pop()}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => noteError(`unhandled: ${e.reason?.message || e.reason}`));

const ua = navigator.userAgent;
const app = window.matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches || navigator.standalone === true;
function osName() {
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPod/.test(ua)) return "iOS";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && isTouch)) return "iPadOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "?";
}
function browserName() {
  if (/EdgA?\/|Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser/.test(ua)) return "Samsung";
  if (/FxiOS|Firefox\//.test(ua)) return "Firefox";
  if (/CriOS|Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "?";
}
const KIND = isPhone ? "mobile" : isTouch ? "tablet" : "pc";
const KIND_LABEL = { mobile: "📱 MOBILE", tablet: "📱 TABLET", pc: "🖥 PC" }[KIND];

function device() {
  return {
    kind: KIND, os: osName(), browser: browserName(), app,
    screen: `${screen.width}×${screen.height}`, view: `${window.innerWidth}×${window.innerHeight}`,
    dpr: window.devicePixelRatio || 1, orient: window.innerWidth >= window.innerHeight ? "landscape" : "portrait",
    graphics: perf.lite ? "lite" : "full", lang: navigator.language || "",
  };
}
// ktorá obrazovka je práve hore
function screenName() {
  const shown = (id) => document.getElementById(id) && !document.getElementById(id).classList.contains("hidden");
  if (shown("login")) return "login";
  if (shown("rooms")) return "rooms";
  if (shown("lobby")) return "lobby";
  if (shown("char-select")) return "char-select";
  return (isSpectator ? "spectate " : "") + (state?.phase || "?");
}

const backdrop = document.createElement("div");
backdrop.className = "ui-backdrop hidden";
const win = document.createElement("div");
win.id = "bug-win";
win.className = "ui-modal hidden";
win.setAttribute("role", "dialog");
win.setAttribute("aria-label", "Report bug");
win.innerHTML = `
  <div class="um-head"><span>REPORT BUG</span><button type="button" class="um-close" aria-label="Close">✕</button></div>
  <p class="bug-hint">What happened? What did you expect?</p>
  <textarea class="bug-text" maxlength="${TEXT_MAX}" rows="6" placeholder="e.g. Shrek stayed stuck in the roar after round 3…"></textarea>
  <div class="bug-count"></div>
  <div class="bug-device"></div>
  <div class="bug-status"></div>
  <button type="button" class="menu-item bug-send">SEND REPORT</button>`;
document.body.append(backdrop, win);
const ta = win.querySelector(".bug-text");
const statusEl = win.querySelector(".bug-status");
const sendBtn = win.querySelector(".bug-send");
const countEl = win.querySelector(".bug-count");

function setStatus(text, cls = "") { statusEl.textContent = text; statusEl.className = "bug-status " + cls; }
const updateCount = () => { countEl.textContent = `${ta.value.length} / ${TEXT_MAX}`; };

export function openBugWindow() {
  const d = device();
  win.querySelector(".bug-device").textContent = `${KIND_LABEL} · ${d.os} · ${d.browser}${d.app ? " · APP" : ""}`;
  setStatus("");
  sendBtn.disabled = false;
  updateCount();
  backdrop.classList.remove("hidden");
  win.classList.remove("hidden");
  fitKeyboard();
  if (!isTouch) ta.focus(); // na dotyku nie - klávesnica by hneď zakryla okno
}
export function closeBugWindow() { backdrop.classList.add("hidden"); win.classList.add("hidden"); ta.blur(); }

win.querySelector(".um-close").addEventListener("click", closeBugWindow);
backdrop.addEventListener("click", closeBugWindow);
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !win.classList.contains("hidden")) closeBugWindow(); });
ta.addEventListener("input", updateCount);

sendBtn.addEventListener("click", () => {
  const text = ta.value.trim();
  if (!text) { setStatus("Write what happened first.", "err"); ta.focus(); return; }
  if (!socket.connected) { setStatus("No connection to the server - try again after RELOAD GAME.", "err"); return; }
  sendBtn.disabled = true;
  setStatus("Sending…");
  const client = { device: device(), ua, screenName: screenName(), errors: errors.slice() };
  socket.timeout(8000).emit("bug_report", { text, client }, (err, res) => {
    if (err || !res?.ok) {
      sendBtn.disabled = false;
      const why = { empty: "Write what happened first.", wait: "Wait a moment before sending another report.",
        limit: "Too many reports today - try again tomorrow." }[res?.error] || "Sending failed - try again.";
      setStatus(why, "err");
      return;
    }
    ta.value = "";
    updateCount();
    setStatus("SENT - THANK YOU!", "ok");
    setTimeout(() => { if (statusEl.classList.contains("ok")) closeBugWindow(); }, 1500);
  });
});

// dotyk + klávesnica: okno k hornému okraju viditeľnej časti a výška podľa nej (súradnice: body je zmenšené
// o appScale, okno má na dotyku scale(--ui-k) = 1/appScale → 1 px okna = 1 skutočný px)
const vv = window.visualViewport;
function fitKeyboard() {
  if (!isTouch || !vv || win.classList.contains("hidden")) return;
  const kb = vv.height < document.documentElement.clientHeight * 0.8; // klávesnica zjedla časť výšky
  win.classList.toggle("kb-open", kb);
  if (kb) {
    win.style.top = `${(vv.offsetTop + 6) / appScale()}px`;
    win.style.maxHeight = `${vv.height - 12}px`;
  } else {
    win.style.top = "";
    win.style.maxHeight = "";
  }
}
vv?.addEventListener("resize", fitKeyboard);
vv?.addEventListener("scroll", fitKeyboard);
ta.addEventListener("focus", () => setTimeout(fitKeyboard, 300));
ta.addEventListener("blur", () => setTimeout(fitKeyboard, 300));
