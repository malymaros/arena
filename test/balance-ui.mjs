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

/* ---------- 3) štítky na telefóne (label) - cena a účinok z balance.js ---------- */
const lbl = (k, slot, ui = {}) => title(k, slot, ui)?.label;
check(lbl("medusa", "special") === `{💧}${B.SPECIAL_COST} {🗿}${B.STONE_ACTIONS}`, "medusa: štítok s kameňom 🗿");
check(lbl("countess", "dash") === `{💧}${B.DASH_COST} {☠️}${B.VAMP_CHARGE_DMG} HEAL ${B.VAMP_CHARGE_BONUS}`
  && lbl("onre", "dash") === `{💧}${B.DASH_COST} {☠️}${B.VAMP_CHARGE_DMG} DRAIN ${B.VAMP_CHARGE_BONUS}`, "vampire/onryo: štítok chargu");
check(lbl("jotaro", "special", { worldUsed: false }) === `{💧}${B.WORLD_COST} TIME STOP`
  && lbl("jotaro", "special", { worldUsed: true }) === `{💧}${B.JOTARO_S2_COST} {☠️}${B.JOTARO_S2_DMG}`, "jotaro: štítok THE WORLD / Special 2");
for (let moon = 0; moon < 4; moon++) {
  check(lbl("werewolf", "special", { st: { moon, char: "werewolf" }, moon }) === `{💧}${B.SPECIAL_COST} {☠️}${B.WOLF_MOON_DMG[moon]}`, `werewolf: štítok pri mesiaci ${moon}`);
}
for (const k of ["fire", "lightning", "wanderer", "escanor"]) {
  check(lbl(k, "special") === `{💧}${B.SPECIAL_COST} {☠️}${B.SPECIAL_ZONE_DMG[k]}`, `${k}: štítok specialu`);
}

/* ---------- 4) okno pri podržaní tlačidla (client/peek.js) - cena z balance.js ---------- */
const info = (k, slot, ui = {}) => title(k, slot, ui)?.info;
check(info("medusa", "melee")?.cost === `{💧}${B.MELEE_COST} {☠️}${B.MEDUSA_MELEE_DMG}`, "medusa: okno melee");
check(info("jotaro", "mirror")?.cost === `{💧}${B.JOTARO_S1_COST} {☠️}${B.JOTARO_S1_DMG}` && info("jotaro", "special", { worldUsed: true })?.cost === `{💧}${B.JOTARO_S2_COST} {☠️}${B.JOTARO_S2_DMG}`, "jotaro: okno Star Platinum + Special 2");
check(!info("jotaro", "special", { worldUsed: false }), "jotaro: pred THE WORLD special ukáže okno postavy (bez vlastného textu)");
for (const k of ["countess", "onre"]) check(info(k, "dash")?.cost === `{💧}${B.DASH_COST} {☠️}${B.VAMP_CHARGE_DMG}` && info(k, "dash").text.includes(String(B.VAMP_CHARGE_BONUS)), `${k}: okno chargu`);
check(info("luffy", "attack", { gear3: true })?.name === "GIANT PISTOL" && info("luffy", "attack", { gear3: false })?.name === "RANGE ATTACK", "luffy: okno útoku podľa formy");
check(info("luffy", "recharge")?.cost === `+${B.RECHARGE_GAIN}{💧}` && title("luffy", "recharge").title.startsWith(`SWITCH GEAR (+${B.RECHARGE_GAIN} mana)`), "luffy: okno + tooltip Switch Gear z jedného textu");

console.log(fails ? `\nBALANS UI: ${fails} chýb` : "\nBALANS UI SEDÍ");
process.exit(fails ? 1 : 0);
