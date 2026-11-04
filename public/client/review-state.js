// public/client/review-state.js - príznak režimu rozboru zápasu (ANALYZE, docs/MATCH_REVIEW_PLAN.md).
// Samostatný modul bez závislostí, aby ho mohli čítať queue.js / raf.js / socket-handlers.js bez cyklov.
// active = herná obrazovka ukazuje uložený záznam (statický: idle frame 0, žiadne efekty, ovládanie skryté);
// dirty = počas rozboru prišiel herný event roomky (napr. súper dal PLAY AGAIN) → po zatvorení sa stránka obnoví.
// drawUntil = do kedy raf.js kreslí (po každom prepnutí chvíľu, potom slučka nič nerobí - statická obrazovka)
export const review = { active: false, dirty: false, lastMatchId: null, drawUntil: 0 };
