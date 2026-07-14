// Assety buducej postavy -> public/assets/jotaro/ (P1/P2 sa zatial nerozlisuje).
// Jotaro a Star Platinum su SAMOSTATNE sprity (vzajomnu poziciu riesi klient pri
// integracii): Jotarov pas nesie herny nazov akcie, standov pas ma priponu _P.
// Zdroje su hotove pasy z out/jus a out/sp — tu sa len kopiruju pod herne nazvy.
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "..", "public", "assets", "jotaro");
fs.mkdirSync(OUT, { recursive: true });

// herny subor -> zdrojovy pas (null = akcia nema danu vrstvu)
const MAP = {
  "Idle.png":        "jus/J_CoatIdle.png",
  "Idle_P.png":      "sp/SP_Idle.png",
  "Run.png":         "jus/J_Run.png",
  "Run_P.png":       "sp/SP_Jabs.png",
  "Attack_1.png":    "jus/J_FistRaise.png",
  "Attack_1_P.png":  "sp/SP_Idle.png",
  "Attack_2.png":    "jus/J_Idle.png",
  "Attack_2_P.png":  "sp/SP_Barrage.png",
  "Special_1.png":   "jus/J_Idle.png",
  "Special_1_P.png": "sp/SP_BarrageUp.png",
  "Special_2.png":   "jus/J_Idle.png",
  "Special_2_P.png": "sp/SP_Punch.png",
  "Special_3_P.png": "sp/SP_SnesMenace.png",   // samotny stand (SNES trup)
  "Dead.png":        "jus/J_Dead.png",
  "Dead_P.png":      "sp/SP_Unsummon.png",
  "Hurt.png":        "jus/J_Hurt.png",
  // Charge.png (ruka standu zo SNES) generuje pack_snes.cjs priamo do assets
};

for (const [dst, src] of Object.entries(MAP)) {
  fs.copyFileSync(path.join(__dirname, "out", src), path.join(OUT, dst));
  console.log(`${dst} <- ${src}`);
}
