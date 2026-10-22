// public/client/last-stand-state.js - klientský stav vizuálu Last Stand / Last Hope (golden žiara, aury, banish).
// Riadi ho timeline (efekty) a raf; server je jediný zdroj HP/many, toto je len choreografia.
export const lastStand = {
  goldenSlot: null,  // slot v golden stave (číta actorFilter pre žiaru postavy)
  realActive: false, // beží reálny buffnutý stav (na upratanie po smrti/výhre)
  banishing: false,  // počas banishu nepripínaj démona za postavu (ide do stredu)
  hopeActive: false, // beží Last Hope ultra mód (na upratanie po skončení kola/hry)
};
