// public/client/session.js - kto som a posledný stav od servera. Exporty sú ES live bindings: importér
// vždy číta aktuálnu hodnotu (import { state } from …), meniť ich smie len cez settery nižšie.
// me = môj slot p1/p2 (fixný na celú sériu), isHost = nastavujem zápas v lobby, isSpectator = len sledujem.
export let me = null;
export let isHost = false;
export let isSpectator = false;
// board = rozmery dosky zo servera, state = posledný snapshot (bez timeline - tú prehráva client.js)
export let board = { w: 4, h: 3 };
export let state = { p1: null, p2: null, arena: null, turn: 1, starter: "p1", phase: "lobby" };

// you_are: slot (a host); starý formát posielal len slot
export function setIdentity(slot, host) { me = slot; if (host !== undefined) isHost = host; }
export function setSpectator() { isSpectator = true; }
// nový snapshot zo servera (board sa mení len ak ho snapshot nesie)
export function setState(s) { state = s; board = s.board || board; }
// druhý slot voči mne (null pre diváka)
export const otherSlot = () => (me === "p1" ? "p2" : me === "p2" ? "p1" : null);
