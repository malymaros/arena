// public/client/arena-roll.js - losovanie arény (lobby kocka, docs/RANDOM_ARENA_PLAN.md). Server arénu už vybral
// a poslal arena_roll PRED ruletou farieb a stavom; tu sa výsledok len ZINSCENUJE: tri karty arén, zlatý rám
// skáče a spomaľuje (ARENA_ROLL_HOPS skokov, posledný dôjde na vylosovanú), chvíľu postojí, ostatné zošednú,
// pod víťazom vyskočí názov, výsledok drží a overlay zmizne. Leží NAD ruletou farieb (tá počká - afterArena).
// Vidia ho hráči aj diváci. Kto stránku obnoví počas animácie, udalosť už nedostane a vidí rovno výsledok.
import { sfx } from "/client/sound.js";
import { ARENA_KEYS, ARENA_NAMES, drawArenaThumb } from "/client/arena-thumbs.js";
import { ARENA_ROLL_HOPS, ARENA_ROLL_HOLD_MS, ARENA_ROLL_RESULT_MS, ARENA_ROLL_FADE_MS, arenaRollHopMs } from "/shared/timing.js";

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
  rootEl.innerHTML = `<div class="cr-title">ARENA</div>
    <div class="ar-row">${ARENA_KEYS.map(k => `<div class="ar-card"><canvas width="600" height="340"></canvas><span>${ARENA_NAMES[k]}</span></div>`).join("")}</div>
    <div class="ar-name"></div>`;
  const cards = [...rootEl.querySelectorAll(".ar-card")];
  cards.forEach((c, i) => drawArenaThumb(c.querySelector("canvas"), ARENA_KEYS[i]));
  rootEl.getAnimations().forEach(a => a.cancel());
  rootEl.classList.remove("hidden");
  active = true;

  // štart volený tak, aby posledný (HOPS-ty) skok dopadol na vylosovanú arénu
  const n = ARENA_KEYS.length, start = ((target - (ARENA_ROLL_HOPS - 1)) % n + n) % n;
  for (let i = 0; i < ARENA_ROLL_HOPS; i++) {
    cards.forEach((c, k) => c.classList.toggle("hop", k === (start + i) % n));
    sfx("ui.random_hop");
    await wait(arenaRollHopMs(i));
    if (myGen !== gen) return;
  }
  await wait(ARENA_ROLL_HOLD_MS);
  if (myGen !== gen) return;
  cards.forEach((c, k) => { c.classList.remove("hop"); c.classList.add(k === target ? "win" : "lose"); });
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
