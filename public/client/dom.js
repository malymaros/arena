// public/client/dom.js - odkazy na statické DOM elementy z index.html a rozmery dosky z CSS premenných.
// Moduly sa vyhodnocujú až po načítaní DOM (type="module" = defer), takže getElementById tu vždy nájde element.

export const gridEl   = document.getElementById("grid");
export const actorsEl = document.getElementById("actors");
// vrstva figúr (hráči, tieňové klony, Jotarov stand) v #actors - ako celok na úrovni .sprite-actor (z-index 3),
// vo vnútri sa figúry prekrývajú podľa riadku: nižší riadok (väčšie y) je vpredu
export const figuresEl = document.getElementById("figures");
export const rowZ = (y) => 10 + 10 * (Number.isFinite(y) ? y : 0);
export const actorP1  = document.getElementById("actor-p1");
export const actorP2  = document.getElementById("actor-p2");
export const queueEl  = document.getElementById("queue");
export const undoBtn  = document.getElementById("undo");
export const lockBtn  = document.getElementById("lock");
export const selEl    = document.getElementById("char-select");
export const arenaEl  = document.getElementById("arena");
export const hudTurn  = document.getElementById("hud-turn");
export const hudBoxP1 = document.getElementById("hud-p1");
export const hudBoxP2 = document.getElementById("hud-p2");
export const hudP1Hp   = document.getElementById("p1-hp");
export const hudP1Mana = document.getElementById("p1-mana");
export const hudP2Hp   = document.getElementById("p2-hp");
export const hudP2Mana = document.getElementById("p2-mana");
export const hudCharP1 = document.getElementById("hud-char-p1");
export const hudCharP2 = document.getElementById("hud-char-p2");
export const flagP1    = document.getElementById("flag-p1");
export const flagP2    = document.getElementById("flag-p2");
export const logP1     = document.getElementById("log-p1");
export const logP2     = document.getElementById("log-p2");
export const goOverlay= document.getElementById("gameover");
export const retryBtn = document.getElementById("retry");
export const lobbyEl     = document.getElementById("lobby");
export const lobbyWaitEl = document.getElementById("lobby-wait");
export const hostWaitEl  = document.getElementById("host-wait");
export const intermissionEl = document.getElementById("intermission");
export const crownsP1El = document.getElementById("crowns-p1");
export const crownsP2El = document.getElementById("crowns-p2");
export const turnTimerEl    = document.getElementById("turn-timer");
export const roundBannerEl  = document.getElementById("round-banner");
export const turnStatusEl = document.getElementById("turn-status");
export const teamConfirmBtn = document.getElementById("team-confirm");
export const teamWaitEl = document.getElementById("team-wait");
export const charAbilityEl = document.getElementById("char-ability");
export const charPrevBtn = document.getElementById("char-page-prev");
export const charNextBtn = document.getElementById("char-page-next");
export const charPageTitle = document.getElementById("char-page-title");
export const hiddenRune = document.getElementById("hidden-rune");
export const moveBtn    = document.getElementById("move-btn");
export const dirPicker  = document.getElementById("dir-picker");
export const attackBtn  = document.getElementById("attack-btn");
export const aimPicker  = document.getElementById("aim-picker");
export const dashBtn    = document.getElementById("dash-btn");
export const dashPicker = document.getElementById("dash-picker");
export const specialBtn    = document.getElementById("special-btn");
export const specialPicker = document.getElementById("special-picker"); // smer pohľadu - používa len Medúza
export const cellPicker    = document.getElementById("cell-picker");    // Vojak/Countess/Onre - mini mapa plochy na výber cieľovej bunky
export const wolfPicker    = document.getElementById("wolf-picker");    // Vlkolak - 8 smerov charge (aj diagonály)
export const aimPickerDiag = document.getElementById("aim-picker-diag"); // Countess/Onre/Jotaro - diagonálny basic (4 smery)
export const mirrorBtn = document.getElementById("mirror-btn"); // pre Jotara sa mení na Special 1
export const s1Picker  = document.getElementById("s1-picker");  // Jotarov Special 1 - smer left/right
export const s1CellPicker = document.getElementById("s1-cell-picker"); // Luffyho Special 1 - cieľová bunka
// Shield / Mirror Breaker: výber obrana | breaker nad štítom a mirrorom (docs/BREAKER_PLAN.md)
export const shieldBtn = document.querySelector('.controls .btn.act.shield[data-act="shield"]');
export const shieldPicker = document.getElementById("shield-picker");
export const mirrorDefPicker = document.getElementById("mirror-def-picker");
export const meleeBtn = document.getElementById("melee-btn"); // melee má picker (Countess/Onre) → vlastné id a handler
export const rechargeBtn = document.querySelector('.btn.act.mana[data-act="recharge"]');
export const goldenBtn = document.getElementById("golden-btn");
export const goldDualBtn = document.getElementById("gold-dual-btn");
export const gmCostEl = document.getElementById("gm-cost");
export const demonBtn = document.getElementById("demon-btn");
export const lastHopeBtn = document.getElementById("last-hope-btn");
export const connErrorEl = document.getElementById("conn-error");
export const colorRollEl = document.getElementById("color-roll");
export const crArrowEl   = document.getElementById("cr-arrow");
export const crResultEl  = document.getElementById("cr-result");

// rozmery dlaždice a medzery dosky (--tile-w/--tile-h v styles.css)
const cs = getComputedStyle(document.documentElement);
export const TILE_W = parseInt(cs.getPropertyValue("--tile-w")) || 260;
export const TILE_H = parseInt(cs.getPropertyValue("--tile-h")) || 185;
export const GAP  = parseInt(getComputedStyle(gridEl).gap || "10") || 10;
// ľavý horný roh bunky (x, y) v px vrstvy dosky
export function cellToPx(x, y) { return { left: x * (TILE_W + GAP), top: y * (TILE_H + GAP) }; }
