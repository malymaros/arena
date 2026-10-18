// public/client/debug-hope.js - DEBUG nástroj (?hopedebug=1): samostatný náhľad sprite stripu „hope" postavy.
// Bez vplyvu na hru; aktivuje sa len query parametrom.

/* ---------- DEBUG: hope sprite animácia (?hopedebug=1) ----------
   Samostatný náhľad - nájdi správny počet framov v sprite_strip.png (frame inference predpokladá štvorec).
   [ / ]  počet framov   |   - / =  fps   |   ←/→  ručný krok   |   medzerník  pauza   |   0  auto */
(function hopeDebug() {
  const params = new URLSearchParams(location.search);
  if (!params.has("hopedebug")) return;

  const ov = document.createElement("div");
  Object.assign(ov.style, {
    position: "fixed", inset: "0", zIndex: "2000000", background: "#101012",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px",
  });
  const info = document.createElement("div");
  Object.assign(info.style, { color: "#fff", font: "15px monospace", textAlign: "center", whiteSpace: "pre", lineHeight: "1.5" });
  const cv = document.createElement("canvas");
  cv.width = 512; cv.height = 512;
  Object.assign(cv.style, { width: "512px", height: "512px", imageRendering: "pixelated", background: "#1c1c20", border: "1px solid #444" });
  ov.appendChild(info); ov.appendChild(cv);
  document.body.appendChild(ov);

  const ctx = cv.getContext("2d");
  let frames = Number(params.get("frames")) || 18; // štart = inference (9216/512)
  let fps = 10, manual = -1, paused = false;

  const img = new Image();
  img.src = "/assets/hope/sprite_strip.png";

  function draw(t) {
    if (img.complete && img.naturalWidth) {
      const fw = img.naturalWidth / frames, fh = img.naturalHeight;
      const idx = manual >= 0 ? manual : (paused ? 0 : Math.floor((t / (1000 / fps)) % frames));
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min(cv.width / fw, cv.height / fh);
      const dw = fw * scale, dh = fh * scale;
      ctx.drawImage(img, Math.round(idx * fw), 0, Math.round(fw), fh, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
      info.textContent =
        `hope sprite ${img.naturalWidth}×${img.naturalHeight}\n` +
        `frames=${frames}  frameW=${(img.naturalWidth / frames).toFixed(1)}  fps=${fps}  frame=${idx}${manual >= 0 ? " [MANUAL]" : paused ? " [PAUSE]" : ""}\n` +
        `[ / ] frames     - / = fps     ←/→ krok     medzerník pauza     0 auto`;
    } else {
      info.textContent = "načítavam /assets/hope/sprite_strip.png …";
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  window.addEventListener("keydown", (e) => {
    if (e.key === "[") frames = Math.max(1, frames - 1);
    else if (e.key === "]") frames = Math.min(64, frames + 1);
    else if (e.key === "-" || e.key === "_") fps = Math.max(1, fps - 1);
    else if (e.key === "=" || e.key === "+") fps = Math.min(30, fps + 1);
    else if (e.key === "ArrowLeft")  manual = ((manual < 0 ? 0 : manual - 1) + frames) % frames;
    else if (e.key === "ArrowRight") manual = ((manual < 0 ? 0 : manual + 1)) % frames;
    else if (e.key === " ") { manual = -1; paused = !paused; e.preventDefault(); }
    else if (e.key === "0") { manual = -1; paused = false; }
  });
})();
