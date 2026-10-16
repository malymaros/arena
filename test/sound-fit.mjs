// test/sound-fit.mjs - prispôsobenie zvuku oknu akcie (public/sounds/fit.js)
import { fitPlan, defaultFit, FADE_MS, RATE_MAX } from "../public/sounds/fit.js";

let failures = 0;
function check(cond, label, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const J = JSON.stringify;

check(fitPlan(3000, 1000, "keep").playMs === null, "keep: hrá celý aj keď prečnieva");
check(fitPlan(800, 1000, "fade").playMs === null, "kratší zvuk sa nereže");
check(fitPlan(800, 1000, "fit").rate === 1, "kratší zvuk sa nenaťahuje");
check(fitPlan(3000, 0, "fade").playMs === null && fitPlan(3000, null, "fit").playMs === null, "neznáme okno = celý zvuk");
check(fitPlan(3000, 1000, "nonsense").mode === "keep", "neznámy režim = keep");
{
  const p = fitPlan(3000, 1000, "fade");
  check(p.playMs === 1000 && p.fadeAtMs === 1000 - FADE_MS && p.rate === 1, "fade: orez na okno + stíšenie na konci", J(p));
  check(fitPlan(3000, 50, "fade").fadeAtMs === 0, "fade: okno kratšie ako stíšenie → stíšenie od začiatku");
}
{
  const p = fitPlan(1100, 1000, "fit");
  check(p.mode === "fit" && Math.abs(p.rate - 1.1) < 1e-9 && p.playMs === 1000 && p.fadeAtMs === null, "fit: zrýchlenie v rozsahu", J(p));
  const edge = fitPlan(1000 * RATE_MAX, 1000, "fit");
  check(edge.mode === "fit", "fit: presne na hranici rozsahu");
  const far = fitPlan(2000, 1000, "fit");
  check(far.mode === "fade" && far.rate === 1 && far.playMs === 1000, "fit mimo rozsahu → fade", J(far));
}
check(defaultFit("special.escanor") === "fade" && defaultFit("move") === "fade" && defaultFit("attack") === "fade", "predvolené fade: casty, lety, kroky");
check(defaultFit("hit") === "keep" && defaultFit("ui.click") === "keep" && defaultFit("labyrinth_end") === "keep", "predvolené keep: nárazy, UI");

console.log(failures ? `\n${failures} ZLYHANÍ` : "\nsound-fit: VŠETKO PREŠLO");
if (failures) process.exit(1);
