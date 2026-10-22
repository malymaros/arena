// public/client/style-cache.js - zápis inline štýlu len pri zmene (docs/PERF_PLAN.md, etapa 7).
// Slučka kreslenia (raf.js) nastavuje polohu/viditeľnosť/transform figúr 60× za sekundu, väčšinou na tú istú
// hodnotu. Každý zápis do el.style môže zneplatniť štýl prvku (prepočet štýlov v ďalšom frame), preto najprv
// porovnáme s aktuálnou inline hodnotou (čítanie el.style nevynúti layout). Bez vlastnej pamäte - pravdou je
// vždy inline štýl, takže sa nič nerozíde, ani keď ten istý prvok mení iný modul.
export function setStyle(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value;
}
