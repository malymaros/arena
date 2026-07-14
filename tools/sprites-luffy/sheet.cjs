// Konfiguracia Luffyho JUS sheetu (fan sheet od Degue, kolaz na jednofarebnom pozadi).
module.exports = {
  luffy: {
    src: "C:/Users/maly/Desktop/Luffy/time_skip_monkey_d__luffy_jus_sprite_sheet_by_degue_1297_d7c3p82.png",
    bg: [0, 102, 102],   // teal pozadie
    // artwork (portret + credit box) je v pravom hornom rohu -> vyhodit boxy v tom regione
    exclude: (b) => b.x0 > 1550 && b.y0 < 400,
    minH: 9,             // textove popisky riadkov ("Stand", "Walk", ...) su ~7px vysoke
    maxW: 800,           // gumene natahovacie utoky su sirsie nez Jotarov limit 400
    maxH: 400,
    cells: "cells.json",
    overview: "overview.png",
  },
};
