// public/client/training.js - TRAINING GROUNDS v hre (shared/training.js, schválený návrh public/dev/tutorial.html):
// banner TRAINING GROUNDS + názov scenára na začiatku (aj medzi kolami, démonie kolo ostáva klasické FINAL ROUND),
// a na konci scenára Baby bot v strede: smutný (FAILED - LEAVE / TRY AGAIN), šťastný (WELL DONE! - LEAVE / NEXT)
// alebo prekvapený (★ CREATIVE ★ - hráč vyhral iným než predpísaným ťahom; LEAVE / NEXT), so zvukom nálady.
// Výsledok počíta server (training_result); okno sa ukáže až po dohraní timeline (timeline.js → trainingEnd).
import { socket, forgetSpectate } from "/client/net.js";
import { state, isSpectator } from "/client/session.js";
import { playback } from "/client/playback.js";
import { roundBannerEl } from "/client/dom.js";
import { NEW_ROUND_MS } from "/client/anim.js";
import { sfx } from "/client/sound.js";
import { drawBotFigure, FIGURE_W, FIGURE_H } from "/client/bot-face.js";
import { TRAINING, trainingScenario } from "/shared/training.js";
import { setTrainingDraft } from "/client/queue.js";

const RESULT = {
  fail:     { mood: "sad",       badge: "FAILED",       text: "AWW... THAT DIDN'T WORK." },
  win:      { mood: "happy",     badge: "WELL DONE!",   text: "YAY! YOU DID IT!" },
  creative: { mood: "surprised", badge: "★ CREATIVE ★", text: "WOW! YOU FOUND A CREATIVE SOLUTION! YOU'RE SO SMART!" },
};

let result = null;   // { n, result } z servera - čaká na koniec prehrávania
let shown = false;

/* ---------- banner ---------- */
export function trainingBannerHtml() {
  const sc = trainingScenario(state?.training?.n);
  return `<span class="rb-main">TRAINING GROUNDS</span>${sc ? `<span class="rb-sub">${sc.n} · ${sc.name}</span>` : ""}`;
}
let bannerTimer = 0;
function playStartBanner() {
  if (!roundBannerEl) return;
  sfx("round.start");
  roundBannerEl.innerHTML = trainingBannerHtml();
  roundBannerEl.classList.remove("hidden", "show");
  void roundBannerEl.offsetWidth; // reštart animácie
  roundBannerEl.classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { roundBannerEl.classList.remove("show"); roundBannerEl.classList.add("hidden"); }, NEW_ROUND_MS);
}

/* ---------- okno výsledku ---------- */
let back = null, cvs = null, raf = 0, mood = "neutral";
function build() {
  back = document.createElement("div");
  back.className = "tr-back hidden";
  back.innerHTML = `<div class="tr-res">
      <div class="tr-bubble"></div><div class="tr-sparks"></div>
      <canvas width="${FIGURE_W * 7}" height="${FIGURE_H * 7}"></canvas>
      <div class="tr-badge"></div>
      <div class="tr-btns"><button class="tr-btn leave" type="button">LEAVE</button><button class="tr-btn again" type="button"></button></div>
    </div>`;
  cvs = back.querySelector("canvas");
  back.querySelector(".leave").addEventListener("click", () => {
    sfx("ui.click");
    hide();
    forgetSpectate();
    socket.emit("leave_room");
  });
  back.querySelector(".again").addEventListener("click", () => {
    sfx("ui.click");
    const n = result?.n || state?.training?.n || 1;
    // TRY AGAIN = ten istý scenár; NEXT = ďalší (po poslednom znova prvý)
    const next = result?.result === "fail" ? n : (n % TRAINING.length) + 1;
    hide();
    socket.emit("training_play", next);
  });
  document.body.appendChild(back); // pevné prekrytie patrí do body (docs/MOBILE.md)
}
function loop(now) {
  raf = 0;
  if (!back || back.classList.contains("hidden")) return;
  drawBotFigure(cvs, mood, now, { level: "baby", hop: mood === "happy" });
  raf = requestAnimationFrame(loop);
}
function show() {
  if (!result || shown) return;
  shown = true;
  if (!back) build();
  const R = RESULT[result.result] || RESULT.fail;
  mood = R.mood;
  const res = back.querySelector(".tr-res");
  res.className = `tr-res ${result.result}`;
  back.querySelector(".tr-bubble").textContent = R.text;
  back.querySelector(".tr-badge").textContent = R.badge;
  back.querySelector(".tr-sparks").innerHTML = result.result === "creative"
    ? [[-150, -90], [150, -80], [-170, 30], [170, 40], [-110, 110], [120, 115], [0, -150]]
      .map(([dx, dy], i) => `<i style="--dx:${dx}px;--dy:${dy}px;animation-delay:${i * 0.22}s"></i>`).join("") : "";
  const again = back.querySelector(".again");
  again.textContent = result.result === "fail" ? "TRY AGAIN" : "NEXT ▶";
  again.classList.toggle("next", result.result !== "fail");
  back.querySelector(".tr-btns").classList.toggle("hidden", !!isSpectator); // divák má svoju lištu (LEAVE)
  if (cvs._botFace) cvs._botFace.mood = ""; // nálada (výkričník prekvapenia) sa rozbehne odznova
  back.classList.remove("hidden");
  sfx(`bot.${R.mood}`, { char: "baby" });
  if (!raf) raf = requestAnimationFrame(loop);
}
function hide() { back?.classList.add("hidden"); }

// timeline.js: prehrávanie kola skončilo (po animácii smrti, ak niekto padol) - čaká výsledok scenára?
export function trainingResultReady() { return !!state?.training && !!result && !shown; }
export function trainingEnd() { show(); }

/* ---------- socket ---------- */
// divák: čo hráč práve plánuje (lišta kola)
socket.on("training_draft", (d) => setTrainingDraft(d));
socket.on("training_start", () => {
  result = null; shown = false; hide(); setTrainingDraft(null);
  playStartBanner();
});
socket.on("training_result", (r) => {
  result = r; shown = false;
  if (!playback.playing) show(); // reload / divák prišiel na okno výsledku (žiadna timeline na dohranie)
});
for (const ev of ["reset", "rooms"]) socket.on(ev, () => { result = null; shown = false; hide(); });
