// test/balance-ui.mjs - strážca jediného zdroja balansu (shared/balance.js).
// 1) V klientskych textoch (public/chars, public/client, index.html) nesmie byť natvrdo zapísané číslo ceny
//    alebo dmg - musí ísť cez ${…} zo shared/balance.js, inak by zmena balansu nechala v UI staré číslo.
// 2) Tooltipy / cenovky / náhľady z registra postáv naozaj ukazujú hodnoty z balance.js.
import fs from "node:fs";
import path from "node:path";
import * as B from "../shared/balance.js";
import { CHAR_BUTTONS, ABILITY_PREVIEW } from "../public/chars/index.js";

let fails = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails++; };

/* ---------- 1) žiadne natvrdo zapísané čísla balansu v UI textoch ---------- */
// vzory: cenovka „−5{💧}" / „8{☠️}", tooltip „(−4 mana", „5 dmg", „+4 mana", „(−10 HP"
const PATTERNS = [
  /[−+]\d+\{/u, /(?<![\w$}])\d+\{☠️\}/u, /\([−+]\d+ (mana|HP)\b/u, /(?<![\w$}])\d+ dmg\b/u, /[−+]\d+ mana\b/u,
];
const files = [
  ...fs.readdirSync("public/chars").filter(f => f.endsWith(".js")).map(f => path.join("public/chars", f)),
  ...fs.readdirSync("public/chars/fx").filter(f => f.endsWith(".js")).map(f => path.join("public/chars/fx", f)),
  ...fs.readdirSync("public/client").filter(f => f.endsWith(".js")).map(f => path.join("public/client", f)),
  "public/index.html",
];
const offenders = [];
for (const f of files) {
  fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/<!--.*?-->/g, ""); // komentáre neriešime
    if (PATTERNS.some(re => re.test(code))) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}
check(offenders.length === 0, "UI texty nemajú natvrdo zapísané ceny/dmg (všetko cez shared/balance.js)");
offenders.forEach(o => console.log("        " + o));

/* ---------- 2) texty postáv ukazujú hodnoty z balance.js ---------- */
const title = (k, slot, ui = {}) => { const d = CHAR_BUTTONS[k]?.[slot]; return typeof d === "function" ? d(ui) : d; };
for (const k of ["fire", "lightning", "wanderer", "escanor"]) {
  const s = title(k, "special");
  check(s.title.includes(`−${B.SPECIAL_COST} mana, ${B.SPECIAL_ZONE_DMG[k]} dmg`) && s.cost.includes(`${B.SPECIAL_ZONE_DMG[k]}{☠️}`),
    `${k}: special tooltip/cenovka = SPECIAL_COST ${B.SPECIAL_COST}, dmg ${B.SPECIAL_ZONE_DMG[k]}`);
  check(ABILITY_PREVIEW[k].dmg === B.SPECIAL_ZONE_DMG[k], `${k}: náhľad vo výbere dmg = ${B.SPECIAL_ZONE_DMG[k]}`);
}
check(title("soldier", "special").title.includes(`${B.SOLDIER_SPECIAL_DMG} dmg`) && ABILITY_PREVIEW.soldier.dmg === B.SOLDIER_SPECIAL_DMG, "soldier: dmg lúča");
check(title("medusa", "melee").cost === `−${B.MELEE_COST}{💧} ${B.MEDUSA_MELEE_DMG}{☠️}`, "medusa: melee cenovka");
check(title("medusa", "special").cost.includes(`${B.STONE_ACTIONS}×`), "medusa: počet skamenených akcií");
check(title("jotaro", "melee").cost.includes(`${B.JOTARO_MELEE_DMG}{☠️}`) && title("jotaro", "mirror").cost === `−${B.JOTARO_S1_COST}{💧} ${B.JOTARO_S1_DMG}{☠️}`, "jotaro: melee + Special 1");
check(title("jotaro", "special", { worldUsed: true }).cost === `−${B.JOTARO_S2_COST}{💧} ${B.JOTARO_S2_DMG}{☠️}`, "jotaro: Special 2 po THE WORLD");
check(title("jotaro", "special", { worldUsed: false }).cost.startsWith(`−${B.WORLD_COST}{💧}`), "jotaro: THE WORLD cena");
check(title("luffy", "special", { gear3: true }).cost.includes(`${B.LUFFY_SPECIAL_DMG.gear3}{☠️}`) && title("luffy", "special", { gear3: false }).cost.includes(`${B.LUFFY_SPECIAL_DMG.base}{☠️}`), "luffy: special dmg podľa formy");
for (const k of ["countess", "onre"]) {
  check(title(k, "dash").cost.startsWith(`−${B.DASH_COST}{💧} ${B.VAMP_CHARGE_DMG}{☠️}`) && title(k, "special").cost.startsWith(`−${B.SPECIAL_COST}{💧} ${B.VAMP_TRAP_DMG}{☠️}`), `${k}: charge + pasca`);
}
for (let moon = 0; moon < 4; moon++) {
  const s = title("werewolf", "special", { st: { moon, char: "werewolf" }, moon });
  check(s.cost === `−${B.SPECIAL_COST}{💧} ${B.WOLF_MOON_DMG[moon]}{☠️}`, `werewolf: mesiac ${moon} → ${B.WOLF_MOON_DMG[moon]} dmg`);
}

console.log(fails ? `\nBALANS UI: ${fails} chýb` : "\nBALANS UI SEDÍ");
process.exit(fails ? 1 : 0);
