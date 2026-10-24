// public/client/preview-hovers.js - hover náhľady pri plánovaní: special/melee tlačidlá a šípky pickerov (special,
// Jotaro S1, vlkolakov charge, Vampire/Onryō charge, diagonálna strela, basic) - zóny z ghost pozície, teda
// po už naplánovaných akciách.
// hover preview pre special
import { specialBtn, specialPicker, s1Picker, wolfPicker, meleeBtn, dashPicker, aimPickerDiag, aimPicker } from "/client/dom.js";
import { ghostCharAt, ghostPos, showPreviewCells, clearPreviewCells, cellsForAimPreview } from "/client/ghost.js";
import { specialTargetOf } from "/client/controls.js";
import { cellsForSpecialPreview, cellsForJotaroS1, cellsForMeleePreview, cellsForVampChargePreview } from "/client/zones.js";
import { state, me, otherSlot } from "/client/session.js";
import { VAMP_CHARS } from "/chars/index.js";
if (specialBtn){
  // preview z ghost pozície - special by sa vykonal po už naplánovaných akciách
  specialBtn.addEventListener("mouseenter", ()=>{
    const char = ghostCharAt();   // po prípadnom swape vo fronte = nový mág
    const p = ghostPos();
    if (!char || !p) return;
    const target = specialTargetOf(char);
    if (target === "dir" || target === "wolf") return; // smerový special - preview ukazujú až šípky pickeru
    showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char, worldUsed: state?.[me]?.worldUsed }));
  });
  specialBtn.addEventListener("mouseleave", clearPreviewCells);
}
// hover preview zóny Medúzinho specialu na šípkach pickeru (←/→) - z ghost pozície
specialPicker?.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const char = ghostCharAt();
    const p = ghostPos();
    if (specialTargetOf(char) === "dir" && p)
      showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char, pride: state?.[me]?.pride, worldUsed: state?.[me]?.worldUsed }, dir));
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});
// hover preview Jotarovho Special 1 na šípkach s1-pickera (←/→) - obe diagonály strany z ghost pozície
s1Picker?.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => { const p = ghostPos(); if (p) showPreviewCells(cellsForJotaroS1(p, dir)); });
  btn.addEventListener("mouseleave", clearPreviewCells);
});
// hover preview dráhy vlkolakovho charge na šípkach 8-smerového pickera - z ghost pozície,
// stop na viditeľnej figúre súpera (foe); skrytý súper v labyrinte → dráha až na okraj
wolfPicker?.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    const char = ghostCharAt();
    if (specialTargetOf(char) === "wolf" && p)
      showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char, foe: state?.[otherSlot()] }, dir));
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});

// hover preview zásahovej bunky melee - vlastná bunka z ghost pozície po naplánovaných akciách
// (Countess/Onre dráhy ukazujú až šípky vamp pickera)
if (meleeBtn) {
  meleeBtn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    if (p) showPreviewCells(cellsForMeleePreview(p, ghostCharAt()));
  });
  meleeBtn.addEventListener("mouseleave", clearPreviewCells);
}
// hover preview dráhy charge Vampire/Onryō na šípkach dash pickera (dash = charge; stop na
// viditeľnej figúre súpera) - pre ostatné postavy dash hover nič neukazuje (čistý pohyb)
dashPicker?.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    const char = ghostCharAt();
    if (VAMP_CHARS[char] && p) // dash = charge
      showPreviewCells(cellsForVampChargePreview(p, dir, state?.[otherSlot()]));
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});
// hover preview lomenej dráhy diagonálnej strely (Vampire/Onryō) na šípkach diag aim pickera
aimPickerDiag?.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    if (p) showPreviewCells(cellsForAimPreview(p, dir, ghostCharAt()));
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});

// hover preview dráhy strely na šípkach aim pickeru - z ghost pozície po naplánovaných akciách
aimPicker.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    if (!p) return;
    showPreviewCells(cellsForAimPreview(p, dir, ghostCharAt())); // char kvôli diagonálnej odrazovej strele side-postáv
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});
