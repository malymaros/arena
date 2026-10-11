// engine/labyrinth.js - Labyrint (Minotaurov special): redakcia dát pre obe strany, niť, odhalenie/koniec, maze buff.
// Továreň dostane E = vnútorný scope enginu (createEngine v engine/game.js): stav hry (E.game) a funkcie
// ostatných sekcií. Vracia svoje funkcie; engine ich zverejní cez E a destrukturuje pre vlastný kód.
import {
  SMALL_DELAY_MS, MIRROR_BEAM_MS, LAB_REVEAL_MS, MAZE_DEAL_MUL,
} from "./constants.js";

export function labyrinthModule(E) {
// prekliaty nevidí súperovu pozíciu, obrany ani MANU (nemá prehľad, kedy Minotaur dosiahne na special/melee);
// niť/obrys súpera (mirror match dvoch Minotaurov) tiež skry. HP ostáva - zásah labyrint aj tak končí.
function redactActor(a) {
  if (!a) return a;
  // clone: prekliaty nesmie vidieť ani súperovho tieňového klona (pozícia = informácia o lovcovi)
  return { ...a, x: null, y: null, mana: null, shield: false, shieldGold: false, mirror: false, mirrorGold: false, thread: [], threadMark: null, clone: null };
}

// LOVEC (Minotaur) zas nevidí Ariadninu niť ani obrys (nemôže sa jej cielene vyhýbať - šliapne na ňu
// nevedomky) a nevidí ani manu prekliateho - počas labyrintu ani jeden nemá prehľad o mane súpera
function redactHunterActor(a) {
  if (!a) return a;
  return { ...a, mana: null, thread: [], threadMark: null };
}

// prekliaty vidí len Damage a Block dlaždice + IK (IK/`iks` sa neredigujú vôbec) - hazardy, ktoré sa ho
// priamo týkajú; heal/mana/POWER dlaždice (výhody-pickupy) LEN keď na nich priamo stojí ALEBO na nich stojí
// jeho tieňový klon - klon je druhá fakľa a osvetľuje svoju bunku rovnako ako hráč (inak by mu prezradili,
// kde sú pickupy). IK vždy (sú to overlaye v `iks`, mimo `tiles`).
function redactTilesFor(mySlot, snap) {
  if (!Array.isArray(snap.tiles)) return snap;
  const me = snap[mySlot];
  const onTorchCell = (t) => me && ((me.x != null && t.x === me.x && t.y === me.y)
    || (me.clone && t.x === me.clone.x && t.y === me.clone.y));
  const alwaysVisible = (type) => type === "dmg" || type === "block";
  const out = { ...snap, tiles: snap.tiles.filter(t => alwaysVisible(t.type) || onTorchCell(t)) };
  // preview (config.tilePreview) sa rediguje ROVNAKO ako existujúce tiles: dmg/block/IK spawny a ciele presunu IK
  // prekliaty vidí vždy, heal/mana/power spawn len keď na tej bunke priamo stojí on alebo jeho tieňový klon
  if (out.pending) {
    out.pending = { ...out.pending, spawns: out.pending.spawns.filter(s => alwaysVisible(s.type) || s.type === "ik" || onTorchCell(s)) };
  }
  return out;
}

// lovec (alebo jeho tieňový klon) PRÁVE stojí na niektorej „fakľovej" bunke prekliateho - na jeho vlastnej
// ALEBO na bunke jeho tieňového klona (klon = druhá fakľa; lovec nevie, ktorá figúra je pravá, takže obe
// bunky sa správajú identicky). Vracia zoznam buniek lovcových figúr stojacich na fakľových bunkách
// ([[x,y],…], max 2 - lovec + jeho klon; duplicitná bunka = obe lovcove figúry na tej istej bunke), inak null.
// Počíta sa čerstvo z každého snapshotu/framu, takže po odchode lovca hneď zhasne (žiadny „stale" obrys).
function hunterLitCells(me, opp) {
  if (!me || !opp || me.x == null) return null;
  const torch = [[me.x, me.y]];
  if (me.clone) torch.push([me.clone.x, me.clone.y]);
  const onTorch = (x, y) => x != null && torch.some(([tx, ty]) => tx === x && ty === y);
  const out = [];
  if (onTorch(opp.x, opp.y)) out.push([opp.x, opp.y]);
  if (opp.clone && onTorch(opp.clone.x, opp.clone.y)) out.push([opp.clone.x, opp.clone.y]);
  return out.length ? out : null;
}

function redactSnapshotFor(mySlot, snap) {
  const oppSlot = mySlot === "p1" ? "p2" : "p1";
  const me = snap[mySlot], opp = snap[oppSlot];
  const hunterHere = hunterLitCells(me, opp);
  return redactTilesFor(mySlot, { ...snap, [mySlot]: { ...me, hunterHere }, [oppSlot]: redactActor(opp) });
}

// tournament × labyrint: počas kliatby nevidí ANI JEDNA strana manu súperovho tímu - roster nesie
// uložené hodnoty magov (lavička + posledný uložený stav nasadeného), rediguje sa obojsmerne ako živá mana
function redactRosterMana(oppSlot, snap) {
  if (!snap.rosterMana) return snap;
  return { ...snap, rosterMana: { ...snap.rosterMana, [oppSlot]: null } };
}

// efekt vo frame, v ktorom je príjemca prekliaty: súperove akcie sa maskujú na "unknown" (beat kvôli
// pozícii v lište), všetko ostatné od/na súpera aj cudzie tile efekty sa zahodia - úplná tma
function redactEffect(mySlot, oppSlot, e, frame) {
  if (!e) return null;
  if (e.kind === "action" && e.from === oppSlot) {
    const t = e.action?.type;
    const beat = (t === "golden_shield" || t === "golden_mirror") ? "gpre"
               : (t === "golden_mana" || t === "last_stand") ? "gmana"
               : (t === "last_hope") ? "lhope" : "act";
    return { kind: "action", from: oppSlot, action: { type: "unknown", dir: null, to: null, beat } };
  }
  if (e.from === oppSlot && e.kind !== "beat_empty") return null; // charge/special/melee/recharge/gold/demon… prezrádzajú pozíciu alebo úmysel
  if (e.target === oppSlot) return null;                          // hit/heal/invalid na súperovi (napr. tile dmg) = pozícia
  if (e.kind === "tile_proc") {
    // tiles samotné prekliaty vidí, ale PROC blik cudzej bunky = súper na nej stojí → len vlastná bunka
    const p = frame[mySlot];
    if (!p || !Array.isArray(e.cell) || e.cell[0] !== p.x || e.cell[1] !== p.y) return null;
  }
  return e;
}

// timeline pre daný slot: framy, v ktorých je príjemca v labyrinte, dostanú redigovaný snapshot aj efekty;
// framy, v ktorých je v labyrinte SÚPER, skryjú príjemcovi (lovcovi) niť/obrys/manu + thread_mark efekty.
// Frame, v ktorom labyrint končí (labyrinth=false), už redigovaný nie je → odhalenie sa prehrá prirodzene.
// labReveal (istý zásah v tomto ťahu): redakcia padá už od reveal frame-u - akcia sa odohrá odhalená.
// pasca (Countess/Onre) v timeline framoch: súperov trap + jeho trap_set efekt sa príjemcovi maskujú
// VŽDY (nielen v labyrinte) - trigger/deštrukcia (trap_trigger/trap_break) ostávajú viditeľné obom
function maskTrapFrame(oppSlot, f) {
  let out = f;
  if (out?.[oppSlot]?.trap) out = { ...out, [oppSlot]: { ...out[oppSlot], trap: null } };
  if ((out.effects || []).some(e => e?.kind === "trap_set" && e.from === oppSlot)) {
    out = { ...out, effects: out.effects.filter(e => !(e?.kind === "trap_set" && e.from === oppSlot)) };
  }
  return out;
}

function redactTimelineFor(mySlot, tl) {
  const oppSlot = mySlot === "p1" ? "p2" : "p1";
  return tl.map(f0 => {
    const f = maskTrapFrame(oppSlot, f0);
    if (f?.[mySlot]?.labyrinth && !f[mySlot].labReveal) {
      // hunterHere sa musí počítať aj pre každý FRAME timeline (nielen root snapshot) - inak keď prekliaty
      // POČAS kola vstúpi na lovcovu bunku, frame ho nenesie a klient ukáže čierny tieň namiesto ožiareného lovca
      const hunterHere = hunterLitCells(f[mySlot], f[oppSlot]);
      return redactRosterMana(oppSlot, redactTilesFor(mySlot, {
        ...f,
        [mySlot]: { ...f[mySlot], hunterHere },
        [oppSlot]: redactActor(f[oppSlot]),
        effects: (f.effects || []).map(e => redactEffect(mySlot, oppSlot, e, f)).filter(Boolean),
      }));
    }
    if (f?.[oppSlot]?.labyrinth && !f[oppSlot].labReveal) {
      return redactRosterMana(oppSlot, {
        ...f,
        [oppSlot]: redactHunterActor(f[oppSlot]),
        effects: (f.effects || []).filter(e => !(e.kind === "thread_mark" && e.target === oppSlot)),
      });
    }
    return f;
  });
}

// 2× VÝSTUPNÝ dmg pre hráča s maze buffom (ten, čo úspešne priamym castom zaklial súpera do labyrintu).
// Aplikuje sa na raw pred zásahom (resolveStrike) → ak je Minotaurov útok odrazený, doubled dmg sa vráti späť naňho.
// mazeBuff nezíska mirror-lovec (labyrint cez odraz) ani prekliaty Minotaur → presne cielené na hráča Minotaura.
function labyrinthMul(slot) { return E.game.players[slot]?.mazeBuff ? MAZE_DEAL_MUL : 1; }

// akýkoľvek zásah AKCIOU medzi hráčmi ukončí labyrint (oboch pri mirror matchi) - počíta sa aj
// zablokovaný/odrazený zásah (resolveStrike/applyPetrify/applyLabyrinth sa volajú len keď akcia trafila);
// tile damage ide mimo resolveStrike, takže labyrint neukončuje. Volá sa až PO zásahových frame-och
// (block/odraz/hit + úbytok HP) - ESCAPED a rozsvietenie arény prídu po dohratí zásahu; odhalenie
// súpera prebehlo už pred animáciou akcie (revealLabyrinths), vtedy zanikla aj niť s obrysom.
function endLabyrinths(tl) {
  for (const slot of ["p1", "p2"]) {
    const p = E.game.players[slot];
    if (!p.labyrinth) continue;
    p.labyrinth = false;
    p.labReveal = false;
    p.thread = [];
    p.threadMark = null;
    E.game.players[E.other(slot)].mazeBuff = false; // labyrint skončil → kaster stráca 2× dmg
    E.pushStateFrame(tl, [{ kind: "labyrinth_end", target: slot }], SMALL_DELAY_MS);
  }
}

// Ak akcia labyrint ISTO ukončí (zásah padne - počíta sa aj do štítu/zrkadla), odhalenie prebehne
// ešte PRED jej animáciou: labReveal zruší redakciu aj hmlu (klient zjaví skrytého súpera fade-om
// a odkryje jeho widget - HP/mana sú opäť viditeľné), samotný labyrinth flag ale beží ďalej,
// takže aréna ostáva stmavená až po labyrinth_end. Niť a obrys zanikajú už pri odhalení,
// aby ich lovec nevidel ani na okamih. Zásah je deterministický - pozície sa počas animácie nemenia.
function revealLabyrinths(tl) {
  if (E.frozenActive()) return; // THE WORLD (bod 8): počas zamrazenia sa labyrint neodhaľuje - odklad na obnovenie času
  for (const slot of ["p1", "p2"]) {
    const p = E.game.players[slot];
    if (!p.labyrinth || p.labReveal) continue;
    p.labReveal = true;
    p.thread = [];
    p.threadMark = null;
    E.pushStateFrame(tl, [{ kind: "labyrinth_reveal", target: slot }], LAB_REVEAL_MS);
  }
}

// labyrint cez obrany obrancu - zrkadlí applyPetrify: shield ho zablokuje (a spotrebuje sa),
// mirror ho odrazí na Minotaura (v labyrinte skončí sám kaster - oslepne a niť ťahá on)
function applyLabyrinth(targetSlot, tl) {
  const t = E.game.players[targetSlot];
  if (t.shield) {
    E.pushStateFrame(tl, [{ kind: "block", target: targetSlot, gold: !!t.shieldGold }], SMALL_DELAY_MS);
    endLabyrinths(tl); // zasahujúci (hoci zablokovaný) labyrint je tiež zásah - prípadný bežiaci labyrint kastera končí
    return;
  }
  // starý labyrint musí skončiť PRED novým zakliatím (nikdy nebežia dva naraz) - až po prípadnej odrazovej animácii
  if (t.mirror) {
    const atkSlot = E.other(targetSlot);
    E.pushStateFrame(tl, [{ kind: "mirror", target: targetSlot, dmg: 0, atk: "special", gold: !!t.mirrorGold }], MIRROR_BEAM_MS);
    endLabyrinths(tl);
    loseInLabyrinth(atkSlot, tl);
    return;
  }
  endLabyrinths(tl);
  loseInLabyrinth(targetSlot, tl);
  // priamy (neodrazený) cast → KASTER (ten, čo hrá Minotaura) získa maze buff: 2× dmg + imunita na Damage/IK
  // dlaždice, kým labyrint trvá. Pri odraze/štíte sa sem nedostaneme, takže mirror-lovec buff nezíska.
  E.game.players[E.other(targetSlot)].mazeBuff = true;
}

function loseInLabyrinth(slot, tl) {
  const p = E.game.players[slot];
  p.labyrinth = true;
  p.thread = [[p.x, p.y]]; // niť začína tam, kde postava stála pri zakliatí
  p.threadMark = null;
  E.pushStateFrame(tl, [{ kind: "labyrinth", target: slot }], SMALL_DELAY_MS);
}

// labyrint: prekliaty necháva niť na každom políčku, na ktoré vstúpi (dash aj cez medzibunku).
// threadMark = POSLEDNÉ políčko, kde sa niť a Minotaur stretli - vznikne oboma smermi:
// (a) Minotaur vstúpi na niť (aj prebehnutím dashom), (b) prekliaty dorastie niťou na bunku,
// kde Minotaur práve stojí. Prekliaty tam vidí jeho obrys. Vracia efekty k pohybovému frame-u.
function trackSteps(slot, cells) {
  // pasca (Countess/Onre): zbieraj bunky, ktorými figúra počas akcie prešla (vrátane teleportu triggera) -
  // resolveTrapsAfterAction z nich po dokončení akcie vyhodnotí vstup/prechod cez pascu
  if (E.actionSteps) E.actionSteps[slot].push(...cells.map(c => [...c]));
  const fx = [];
  const p = E.game.players[slot];
  const foeS = E.other(slot);
  const foe = E.game.players[foeS];
  if (p.labyrinth) {
    let mark = null;
    for (const [x, y] of cells) {
      if (!p.thread.some(([tx, ty]) => tx === x && ty === y)) p.thread.push([x, y]);
      if (foe && !foe.labyrinth && foe.x === x && foe.y === y) mark = [x, y]; // niť dorástla na Minotaurovu bunku
      // lovcov tieňový klon sa ráta tiež - prekliaty na jeho bunke uvidí siluetu (nevie, že je to klon)
      if (foe && !foe.labyrinth && foe.clone && foe.clone.x === x && foe.clone.y === y) mark = [x, y];
    }
    if (mark) {
      p.threadMark = mark;
      fx.push({ kind: "thread_mark", cell: mark, target: slot });
    }
  }
  if (foe?.labyrinth) {
    // lovec prechádza niťou → preblik na KAŽDEJ prejdenej niťovej bunke (nie len na poslednej);
    // threadMark ostane posledná bunka (tam silueta natrvalo ostane)
    for (const [x, y] of cells) {
      if (foe.thread.some(([tx, ty]) => tx === x && ty === y)) {
        foe.threadMark = [x, y];
        fx.push({ kind: "thread_mark", cell: [x, y], target: foeS }); // target = kto obrys uvidí
      }
    }
  }
  return fx;
}

return { redactActor, redactHunterActor, redactTilesFor, hunterLitCells, redactSnapshotFor, redactRosterMana, redactEffect, maskTrapFrame, redactTimelineFor, labyrinthMul, endLabyrinths, revealLabyrinths, applyLabyrinth, loseInLabyrinth, trackSteps };
}
