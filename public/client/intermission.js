// public/client/intermission.js - obrazovka medzi hrami série (koruny oboch strán, kto vyhral hru).
import { pixSvg } from "/client/pix.js";

const intermissionEl = document.getElementById("intermission");

/* ---------- Intermission (medzi hrami série) ---------- */
// me = môj slot (p1/p2) - popisky YOU/OPPONENT a „YOU WON" sú z pohľadu hráča
export function showIntermission(gameWinner, series, me) {
  const mineWon = me && gameWinner === me;
  document.getElementById("im-title").textContent =
    gameWinner === "draw" ? "TIE" : (mineWon ? "YOU WON THIS GAME!" : "YOU LOST THIS GAME");

  const needed = series?.needed || 1;
  // placeholdery + ikony pre obe strany; práve pridaná koruna víťazovi sa animuje
  // (aj v tournamente koruny víťazovi - lebky mŕtvych magov nesie HUD v hre, nie tento prechod)
  const renderSide = (filled, isMarkSide) => Array.from({ length: needed }, (_, i) => {
    const isOn = i < (filled || 0);
    const isNew = isMarkSide && i === (filled || 0) - 1;
    return `<span class="crown${isNew ? " new" : ""}">${pixSvg(isOn ? "crown" : "crown_outline")}</span>`;
  }).join("");
  const fillL = series?.winsP1;
  const fillR = series?.winsP2;
  const markL = gameWinner === "p1";
  const markR = gameWinner === "p2";
  document.getElementById("im-crowns-l").innerHTML = renderSide(fillL, markL);
  document.getElementById("im-crowns-r").innerHTML = renderSide(fillR, markR);

  // popisky strán - kde som ja (sloty sú fixné na celú sériu), drží strany ako koruny v HUD
  const whoL = document.getElementById("im-who-l");
  const whoR = document.getElementById("im-who-r");
  whoL.textContent = me === "p1" ? "YOU" : "OPPONENT";
  whoR.textContent = me === "p2" ? "YOU" : "OPPONENT";
  whoL.className = "im-who " + (me === "p1" ? "you" : "opp");
  whoR.className = "im-who " + (me === "p2" ? "you" : "opp");

  document.getElementById("im-next").textContent = "Next game starting…";
  intermissionEl.classList.remove("hidden");
}
