// public/client/side-tag.js - jednotný štítok strany: ⚪ WHITE (p1, svetlý) / ⚫ BLACK (p2, fialový) - rovnaký vzhľad
// všade v hre (koniec hry, losovanie farby / postáv, zákazy postáv, opona diváka, MATCHES); farby v styles.css .side-tag
export const SIDE_LABEL = { p1: "⚪ WHITE", p2: "⚫ BLACK" };
// slot p1 / p2 (aj "white" / "black") → HTML štítok; text = vlastný text namiesto ⚪ WHITE / ⚫ BLACK
export function sideTag(slot, text = null) {
  const s = slot === "white" ? "p1" : slot === "black" ? "p2" : slot;
  return `<span class="side-tag ${s}">${text ?? SIDE_LABEL[s] ?? ""}</span>`;
}
