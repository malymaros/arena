// shared/beginner.js - BEGINNER mód (vlastník 2026-11-05, schválený návrh public/dev/beginner.html): prepínač vľavo hore
// v room browseri. Zapnutý = hrajú sa len títo traja mágovia (ostatné postavy sú zakázané - štýl BANNED), len Stone
// Bridge s predvolenými pravidlami (ADVANCED SETTINGS zamknuté), aj proti AI; turnaj povolený. Roomky sú oddelené podľa
// módu: do roomky beginnera sa nepripojí hráč bez beginner módu a naopak (sledovať sa dá). Čistý modul - číta ho
// engine (sanitizeConfig), server (roomky) aj klient (prepínač, lobby).
export const BEGINNER_CHARS = ["fire", "lightning", "wanderer"];
export const isBeginnerChar = (key) => BEGINNER_CHARS.includes(key);
