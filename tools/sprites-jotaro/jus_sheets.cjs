// Konfiguracia JUS sheetov (fan sprity od Ryudara323, kolaze na jednofarebnom pozadi).
module.exports = {
  sp: {
    src: "C:/Users/maly/Desktop/Jotaro/star_platinum_ova_sprite_jus_by_ryudara323_deaxfn3.png",
    bg: [63, 63, 63],   // sede pozadie
    maxX: 1000,         // vpravo je velky artwork -> boxy zacinajuce za touto hranicou vyhodit
    cells: "cells_sp.json",
    overview: "overview_sp.png",
  },
  jotaro: {
    src: "C:/Users/maly/Desktop/Jotaro/jotaro_kujo_update_by_ryudara323_deaorlc.png",
    bg: [0, 127, 14],   // zelene pozadie
    maxX: 850,
    cells: "cells_jus.json",
    overview: "overview_jus.png",
  },
  snes: {
    src: "C:/Users/maly/Desktop/Jotaro/SNES - JoJo's Bizarre Adventure (JPN) - Playable Characters - Jotaro Kujo _ Star Platinum.png",
    bg: [0, 64, 128],   // modre pozadie (sheet od SmithyGCN)
    maxX: 470,
    cells: "cells_snes.json",
    overview: "overview_snes.png",
  },
};
