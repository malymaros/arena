// public/client/lobby-bot.js - hra proti AI botovi z room browsera: hlava bota vpravo dole (nie karta v zozname
// roomiek). Klik = sadneš si do stálej AI roomky (join_room); keď v nej už niekto hrá (max 1 hra s AI na server),
// bot „premýšľa" a klik ťa pustí sledovať (spectate_room). Hlava je tá istá monitor-tvár ako v HUD (bot-face.js).
// Voľný bot: klik najprv otvorí okno CHOOSE DIFFICULTY (ai-difficulty.js) - BABY / NORMAL / CHEATER; obsadený: v rohu je hlava
// toho bota, proti ktorému sa práve hrá (aiRoom.level).
import { drawBotFigure, FIGURE_W, FIGURE_H } from "/client/bot-face.js";
import { openDifficulty, closeDifficulty } from "/client/ai-difficulty.js";
import { sfx } from "/client/sound.js";

const SCALE = 4; // umelecký pixel → px plátna (CSS ho na telefóne zväčší, image-rendering: pixelated)
let el = null, cvs = null, bubble = null;
let room = null, hover = false, busyClick = false, raf = 0;
let intro = null; // intro NORMAL bota pri prejdení na voľnú hlavu (nové prejdenie predchádzajúce utne)
let onPick = null;

function build(roomsEl) {
  el = document.createElement("button");
  el.type = "button";
  el.className = "lobby-bot";
  el.setAttribute("aria-label", "Play vs AI");
  bubble = document.createElement("div");
  bubble.className = "lobby-bot-bubble";
  cvs = document.createElement("canvas");
  cvs.className = "lobby-bot-figure";
  cvs.width = FIGURE_W * SCALE; cvs.height = FIGURE_H * SCALE;
  el.append(bubble, cvs); // obsadenosť ukazuje tvár + bublina (bez popisu AI 0/1)
  el.addEventListener("mouseenter", () => {
    hover = true; sync();
    if (room?.canJoin) { intro?.then?.(h => h?.stop()); intro = sfx("bot.intro", { char: "normal" }); }
  });
  el.addEventListener("mouseleave", () => { hover = false; sync(); });
  el.addEventListener("click", () => {
    if (!room || busyClick) return;
    const go = (level) => { if (!room) return; busyClick = true; el.classList.add("pressed"); onPick?.(room, level); };
    if (room.canJoin) { hover = false; sync(); openDifficulty(go); } else go();
  });
  roomsEl.appendChild(el);
}

function sync() {
  if (!el) return;
  const free = !!room?.canJoin;
  el.classList.toggle("busy", !free);
  el.classList.toggle("hover", hover);
  bubble.textContent = free ? (hover ? "LET'S DUEL!" : "PLAY VS AI") : (hover ? "WATCH THE MATCH" : "BUSY… IN A MATCH");
}

function loop(now) {
  raf = 0;
  if (!el || el.offsetParent === null) return; // room browser skrytý → nekresli
  const free = !!room?.canJoin;
  const mood = !free ? "thinking" : hover ? "happy" : "neutral";
  drawBotFigure(cvs, mood, now, { hop: free && hover, level: free ? "normal" : room?.level });
  raf = requestAnimationFrame(loop);
}

// net.js volá pri každom `rooms`: aiRoom = { players, max, canJoin, level, ... } alebo null (server AI roomku nemá);
// pick(room, level) - level len pri vstupe ("baby" / "normal" / "cheater"), pri sledovaní undefined
export function setLobbyBot(roomsEl, aiRoom, pick) {
  if (!roomsEl) return;
  if (!el) build(roomsEl);
  room = aiRoom; onPick = pick; busyClick = false;
  if (!aiRoom?.canJoin) closeDifficulty(); // bota medzitým obsadil niekto iný → okno výberu nemá zmysel
  el.classList.remove("pressed");
  el.classList.toggle("hidden", !aiRoom);
  sync();
  if (!raf && aiRoom) raf = requestAnimationFrame(loop);
}
