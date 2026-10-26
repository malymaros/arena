// public/client/char-roll.js - losovanie postáv (lobby „RANDOM CHARACTERS“). Server postavy (single/BO3)
// alebo tím (turnaj) už pridelil a poslal char_roll PRED stavom; tu sa výsledok len ZINSCENUJE ako ruleta
// farieb: mriežka hláv vo vlastnej palete, kurzor (v turnaji 3 kurzory 1-2-3) poskakuje, spomaľuje, dôjde
// na postavu, chvíľu postojí a až potom sa postava potvrdí (meno + zvuk voľby + intro hlas). Overlay leží
// pod ruletou farieb a nad char-selectom/plochou. Divák nevidí nič. Kto stránku obnoví počas animácie,
// udalosť už nedostane a vidí rovno výsledok (rovnako ako pri rulete farieb).
import { me } from "/client/session.js";
import { drawMageHeadAnim, mageHeadHtml } from "/client/mage-head.js";
import { usesAltColor } from "/client/sprites.js";
import { CHAR_META, SIDE_CHARS } from "/chars/index.js";
import { sfx, resolveKey, entryFor, urlDuration } from "/client/sound.js";
import { HIDDEN_GLITCH_CHARS } from "/client/char-select.js";
import {
  ROLL_TICKS, ROLL_TEAM_STAGGER, ROLL_LINGER_MS, ROLL_FADE_MS, rollTickMs, COLOR_ROLL_MS,
} from "/shared/timing.js";

// poradie mriežky (zľava doprava, zhora nadol) - side-postavy podľa strany; null = budúca postava (stlmená, nedá sa vybrať)
const LAYOUT = {
  p1: ["fire", "lightning", "wanderer", "countess", "medusa", "minotaur", "naruto", "luffy", "escanor", "soldier", "werewolf", null],
  p2: ["fire", "lightning", "wanderer", "onre",     "medusa", "minotaur", "naruto", "jotaro", "escanor", "soldier", "werewolf", null],
};
// skrátené mená len pre túto obrazovku (intro hlas ostáva celý)
const SHORT_NAME = { lightning: "LIGHTNING", wanderer: "WANDERER" };
// pixel font nemá veľké Ō → bez diakritiky (ONRYO), rovnako ako peek okno
const rollName = (c) => SHORT_NAME[c] || (CHAR_META[c]?.name || c).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

let rootEl = null, gridEl = null, resultEl = null, titleEl = null;
let gen = 0;          // každé nové losovanie / zrušenie zahodí bežiace časovače staršieho
let active = false;   // overlay je hore (turn-timer počas neho neukazuje odpočet)
let rafId = 0, glitchTimer = 0;

export const charRollActive = () => active;

function build() {
  if (rootEl) return;
  rootEl = document.createElement("div");
  rootEl.id = "char-roll";
  rootEl.className = "char-roll hidden";
  rootEl.innerHTML = `<div class="rr-title"></div><div class="rr-grid"></div><div class="rr-result"></div>`;
  document.body.appendChild(rootEl);
  titleEl = rootEl.querySelector(".rr-title");
  gridEl = rootEl.querySelector(".rr-grid");
  resultEl = rootEl.querySelector(".rr-result");
}

function renderGrid(slot) {
  titleEl.className = "rr-title " + (slot === "p1" ? "white" : "black");
  titleEl.textContent = slot === "p1" ? "⚪ WHITE" : "⚫ BLACK";
  rootEl.classList.toggle("p2-side", slot === "p2");
  gridEl.innerHTML = LAYOUT[slot].map((c, i) => c
    ? `<div class="rr-cell${SIDE_CHARS[c] ? " corrupt" : ""}" data-i="${i}"><div class="rr-face">${mageHeadHtml(c, usesAltColor(c, slot) ? "alt-color" : "", slot)}</div><div class="rr-name">${rollName(c)}</div></div>`
    : `<div class="rr-cell future" data-i="${i}"><div class="rr-face"><span class="rr-q">???</span></div><div class="rr-name"></div></div>`).join("");
}

// hlavy sa animujú len kým je overlay hore
function startLoops() {
  const loop = (now) => {
    if (!active) { rafId = 0; return; }
    gridEl.querySelectorAll("canvas.mage-head").forEach(cv => drawMageHeadAnim(cv, cv.dataset.char, now));
    rafId = requestAnimationFrame(loop);
  };
  if (!rafId) rafId = requestAnimationFrame(loop);
  // glitch skrytých postáv - mená sa rozbíjajú znakmi Hidden stránky, hlava občas preblikne (ako corrupt hlavy v HUD)
  clearInterval(glitchTimer);
  glitchTimer = setInterval(() => {
    if (!active) { clearInterval(glitchTimer); glitchTimer = 0; return; }
    gridEl.querySelectorAll(".rr-cell.corrupt").forEach(cell => {
      cell.classList.toggle("flash", Math.random() < 0.22);
      const nameEl = cell.querySelector(".rr-name");
      const real = nameEl.dataset.name || (nameEl.dataset.name = nameEl.textContent);
      nameEl.textContent = [...real].map(ch => ch !== " " && Math.random() < 0.35
        ? HIDDEN_GLITCH_CHARS[Math.floor(Math.random() * HIDDEN_GLITCH_CHARS.length)] : ch).join("");
    });
  }, 120);
}

// intro hlas (ten istý ako hover nad kartou v char-selecte); hlasy idú za sebou, nie cez seba
let voiceChain = Promise.resolve();
async function introMs(char) {
  const k = resolveKey("ui.hover_char", char);
  const e = k && entryFor(k);
  const tr = e?.trims?.[0];
  if (tr) return tr[1] - tr[0];
  const d = e?.urls?.[0] ? await urlDuration(e.urls[0]).catch(() => 0) : 0;
  return d || 1200;
}
function queueIntro(char, myGen) {
  voiceChain = voiceChain.then(async () => {
    if (myGen !== gen) return;
    sfx("ui.hover_char", { char });
    await wait(await introMs(char) + 120);
  });
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function placeCursor(cur, idx) {
  const cell = gridEl.querySelector(`.rr-cell[data-i="${idx}"]`);
  cur.el.style.left = cell.offsetLeft + "px";
  cur.el.style.top = cell.offsetTop + "px";
  cur.at = idx;
}

// info = { team, picks: { p1: [...], p2: [...] }, afterColor }
export async function startCharRoll(info) {
  if (me !== "p1" && me !== "p2") return;              // divák nevidí nič až do začiatku hry
  const chars = info?.picks?.[me];
  if (!Array.isArray(chars) || !chars.length) return;
  build();
  const myGen = ++gen;
  const slot = me;
  renderGrid(slot);
  resultEl.className = "rr-result" + (chars.length > 1 ? " team" : "");
  resultEl.innerHTML = chars.map(() => `<span class="rr-res-name" style="visibility:hidden">·</span>`).join("");
  rootEl.getAnimations().forEach(a => a.cancel());
  rootEl.classList.remove("hidden", "done");
  active = true;
  startLoops();

  // v hre 1 s losovaním farby beží najprv ruleta (leží NAD týmto overlayom); kurzory štartujú, až zmizne
  if (info.afterColor) await wait(COLOR_ROLL_MS);
  if (myGen !== gen) return;

  const layout = LAYOUT[slot];
  const targets = chars.map(c => layout.indexOf(c));
  if (targets.some(t => t < 0)) { stopCharRoll(); return; } // neznáma postava (nová verzia servera) - radšej nič
  const valid = layout.map((c, i) => c ? i : -1).filter(i => i >= 0); // „???“ nikdy
  const n = targets.length;
  // kedy ktorý kurzor dôjde na cieľ: turnaj postupne 1 → 2 → 3, posledný na ROLL_TICKS
  const landAt = targets.map((_, k) => ROLL_TICKS - (n - 1 - k) * ROLL_TEAM_STAGGER);
  const curs = targets.map((t, k) => {
    const el = document.createElement("div");
    el.className = "rr-cursor c" + (k + 1);
    if (n > 1) el.innerHTML = `<span class="rr-num">${k + 1}</span>`;
    gridEl.appendChild(el);
    return { el, at: -1, target: t, landed: false, k };
  });
  const start = [];
  for (const c of curs) { let s; do s = pick(valid); while (start.includes(s)); start.push(s); placeCursor(c, s); }

  for (let tick = 1; tick <= ROLL_TICKS; tick++) {
    await wait(rollTickMs(tick));
    if (myGen !== gen) return;
    const moving = curs.filter(c => !c.landed);
    const landingNow = moving.filter(c => landAt[c.k] === tick);
    // obsadené: dobehnuté kurzory + ciele práve dopadajúcich; dva kurzory nikdy na jednom políčku
    const reserved = new Set([...curs.filter(c => c.landed).map(c => c.at), ...landingNow.map(c => c.target)]);
    for (const c of landingNow) { placeCursor(c, c.target); c.landed = true; }
    for (const c of moving.filter(c => !c.landed)) {
      // cieľ kurzora, ktorý dopadne v ďalšom skoku, nesmie nikto obsadiť (ani on sám o skok skôr)
      const nextTargets = curs.filter(o => !o.landed && landAt[o.k] === tick + 1).map(o => o.target);
      let free = valid.filter(i => i !== c.at && !reserved.has(i) && !nextTargets.includes(i));
      if (!free.length) free = valid.filter(i => i !== c.at && !reserved.has(i));
      const nxt = pick(free);
      placeCursor(c, nxt); reserved.add(nxt);
    }
    if (moving.length) sfx("ui.random_hop");
    // kurzor na cieli chvíľu postojí (ako ďalší skok) a až potom sa postava potvrdí
    if (landingNow.length) setTimeout(() => { if (myGen === gen) reveal(landingNow, layout, myGen); }, rollTickMs(tick + 1));
  }
  await wait(rollTickMs(ROLL_TICKS + 1));
  if (myGen !== gen) return;
  rootEl.classList.add("done");
  await wait(ROLL_LINGER_MS);
  if (myGen !== gen) return;
  const fade = rootEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ROLL_FADE_MS, easing: "ease-in", fill: "forwards" });
  fade.onfinish = () => { if (myGen === gen) stopCharRoll(); fade.cancel(); };
}

function reveal(landed, layout, myGen) {
  sfx("ui.pick");
  for (const c of landed) {
    c.el.classList.add("landed");
    gridEl.querySelector(`.rr-cell[data-i="${c.target}"]`)?.classList.add("picked");
    const char = layout[c.target];
    const span = resultEl.children[c.k];
    if (span) {
      span.className = "rr-res-name c" + (c.k + 1) + (SIDE_CHARS[char] ? " corrupt" : "");
      span.textContent = rollName(char);
      span.style.visibility = "";
    }
    queueIntro(char, myGen);
  }
}

// skry overlay a zruš bežiace losovanie (koniec animácie, reset roomky, návrat do room-browsera)
export function stopCharRoll() {
  gen++;
  active = false;
  if (!rootEl) return;
  rootEl.classList.add("hidden");
  gridEl.innerHTML = "";
  resultEl.innerHTML = "";
}
