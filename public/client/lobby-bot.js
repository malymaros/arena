// public/client/lobby-bot.js - hra proti AI botovi z room browsera: hlava bota vpravo dole (nie karta v zozname
// roomiek). Klik = sadneš si do stálej AI roomky (join_room); keď v nej už niekto hrá (max 1 hra s AI na server),
// bot „premýšľa" a klik ťa pustí sledovať (spectate_room). Hlava je tá istá monitor-tvár ako v HUD (bot-face.js).
import { drawBotFigure, FIGURE_W, FIGURE_H } from "/client/bot-face.js";

const SCALE = 4; // umelecký pixel → px plátna (CSS ho na telefóne zväčší, image-rendering: pixelated)
let el = null, cvs = null, bubble = null;
let room = null, hover = false, busyClick = false, raf = 0;
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
  el.addEventListener("mouseenter", () => { hover = true; sync(); });
  el.addEventListener("mouseleave", () => { hover = false; sync(); });
  el.addEventListener("click", () => {
    if (!room || busyClick) return;
    busyClick = true; el.classList.add("pressed");
    onPick?.(room);
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
  drawBotFigure(cvs, mood, now, { hop: free && hover });
  raf = requestAnimationFrame(loop);
}

// net.js volá pri každom `rooms`: aiRoom = { players, max, canJoin, ... } alebo null (server AI roomku nemá)
export function setLobbyBot(roomsEl, aiRoom, pick) {
  if (!roomsEl) return;
  if (!el) build(roomsEl);
  room = aiRoom; onPick = pick; busyClick = false;
  el.classList.remove("pressed");
  el.classList.toggle("hidden", !aiRoom);
  sync();
  if (!raf && aiRoom) raf = requestAnimationFrame(loop);
}
