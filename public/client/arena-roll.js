// public/client/arena-roll.js - losovanie arény (lobby kocka, docs/RANDOM_ARENA_PLAN.md). Server arénu už vybral
// a poslal arena_roll PRED ruletou farieb a stavom; tu sa výsledok len ZINSCENUJE ako posuvný pás: karty arén stále
// v poradí bridge → portal → swamp → bridge… prebiehajú okienkom popod pevnú zlatú značku, pás spomaľuje, zastaví sa
// kúsok vedľa stredu vylosovanej karty a dobehne pod značku, ostatné zošednú, pod okienkom sa ukáže názov, výsledok
// drží a overlay zmizne (fázy a dĺžka v shared/timing.js ARENA_ROLL_*). Leží NAD ruletou farieb (tá počká -
// afterArena). Vidia ho hráči aj diváci. Kto stránku obnoví počas animácie, udalosť už nedostane a vidí rovno výsledok.
import { sfx } from "/client/sound.js";
import { ARENA_KEYS, ARENA_NAMES, drawArenaThumb } from "/client/arena-thumbs.js";
import { ARENA_ROLL_INTRO_MS, ARENA_ROLL_SPIN_MS, ARENA_ROLL_SETTLE_MS, ARENA_ROLL_HOLD_MS, ARENA_ROLL_RESULT_MS,
  ARENA_ROLL_FADE_MS } from "/shared/timing.js";

const LAP = 30;          // vylosovaná karta je v 11. trojici pásu
const COUNT = LAP + 6;   // za ňou ešte pár kariet, nech pás pod značkou nekončí
const START = 1;         // na začiatku je pod značkou PORTAL REALM (vľavo STONE BRIDGE, vpravo SHREK SWAMP - ako v lobby)
const TICK_MIN_MS = 60;  // zvuk preskoku najviac raz za 60 ms (na začiatku prebieha veľa kariet)

let rootEl = null;
let gen = 0;          // nové losovanie / zrušenie zahodí bežiace časovače staršieho
let active = false;

export const arenaRollActive = () => active;
// po zmiznutí overlayu - napr. hudba / odpočet ťahu sa môžu rozbehnúť (sound-map.js)
const endListeners = [];
export function onArenaRollEnd(fn) { endListeners.push(fn); }

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function build() {
  if (rootEl) return;
  rootEl = document.createElement("div");
  rootEl.id = "arena-roll";
  rootEl.className = "arena-roll hidden";
  document.body.appendChild(rootEl);
}

// info = { arena: "bridge" | "portal" | "swamp" }
export async function startArenaRoll(info) {
  const target = ARENA_KEYS.indexOf(info?.arena);
  if (target < 0) return;
  build();
  const myGen = ++gen;
  const seq = Array.from({ length: COUNT }, (_, i) => ARENA_KEYS[i % ARENA_KEYS.length]);
  const at = LAP + target;
  rootEl.innerHTML = `<div class="cr-title">ARENA</div>
    <div class="ar-window"><div class="ar-strip">${seq.map(k =>
      `<div class="ar-card"><canvas width="600" height="340"></canvas><span>${ARENA_NAMES[k]}</span></div>`).join("")}</div>
      <div class="ar-mark"><div class="ar-line"></div></div></div>
    <div class="ar-name"></div>`;
  const cards = [...rootEl.querySelectorAll(".ar-card")];
  cards.forEach((c, i) => drawArenaThumb(c.querySelector("canvas"), seq[i]));
  rootEl.getAnimations().forEach(a => a.cancel());
  rootEl.classList.remove("hidden");
  active = true;

  // posun pásu, pri ktorom je stred karty i pod značkou (rozmery raz pri štarte)
  const win = rootEl.querySelector(".ar-window"), strip = rootEl.querySelector(".ar-strip");
  const cw = cards[0].offsetWidth, step = cards[1].offsetLeft - cards[0].offsetLeft, mid = win.offsetWidth / 2;
  const shift = (i) => mid - (cards[i].offsetLeft + cw / 2);
  // zastaví sa kúsok mimo stredu („ešte jedna?") - čisto kozmetická náhoda klienta, výsledok je daný serverom
  const from = shift(START), end = shift(at), stop = end + (Math.random() * 0.7 - 0.35) * cw;
  strip.style.transform = `translateX(${from}px)`;
  cards[START].classList.add("hop");
  await wait(ARENA_ROLL_INTRO_MS);
  if (myGen !== gen) return;

  const spin = strip.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${stop}px)` }],
    { duration: ARENA_ROLL_SPIN_MS, easing: "cubic-bezier(.08,.6,.12,1)", fill: "forwards" });
  // karta pod značkou sa rozsvieti (+ zvuk preskoku); poloha z priebehu animácie, bez čítania layoutu
  let last = START, lastSfx = 0;
  const tick = (now) => {
    if (myGen !== gen || spin.playState !== "running") return;
    const x = from + (stop - from) * (spin.effect.getComputedTiming().progress ?? 0);
    const i = Math.round((mid - x - cw / 2) / step);
    if (i !== last && cards[i]) {
      cards[last]?.classList.remove("hop");
      cards[i].classList.add("hop");
      last = i;
      if (now - lastSfx >= TICK_MIN_MS) { sfx("ui.random_hop"); lastSfx = now; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await wait(ARENA_ROLL_SPIN_MS);
  if (myGen !== gen) return;
  cards.forEach((c, i) => c.classList.toggle("hop", i === at));
  strip.animate([{ transform: `translateX(${stop}px)` }, { transform: `translateX(${end}px)` }],
    { duration: ARENA_ROLL_SETTLE_MS, easing: "ease-in-out", fill: "forwards" });
  await wait(ARENA_ROLL_SETTLE_MS + ARENA_ROLL_HOLD_MS);
  if (myGen !== gen) return;

  cards.forEach((c, i) => { c.classList.remove("hop"); c.classList.add(i === at ? "win" : "lose"); });
  rootEl.querySelector(".ar-line").classList.add("off");
  const name = rootEl.querySelector(".ar-name");
  name.textContent = ARENA_NAMES[ARENA_KEYS[target]];
  name.classList.add("show");
  sfx("ui.pick");
  await wait(ARENA_ROLL_RESULT_MS);
  if (myGen !== gen) return;
  const fade = rootEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ARENA_ROLL_FADE_MS, easing: "ease-in", fill: "forwards" });
  fade.onfinish = () => { if (myGen === gen) stopArenaRoll(); fade.cancel(); };
}

// skry overlay a zruš bežiace losovanie (koniec animácie, reset roomky, návrat do room-browsera)
export function stopArenaRoll() {
  gen++;
  const was = active;
  active = false;
  if (was) endListeners.forEach(fn => { try { fn(); } catch {} });
  if (!rootEl) return;
  rootEl.classList.add("hidden");
  rootEl.innerHTML = "";
}
