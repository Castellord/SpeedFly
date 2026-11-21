const shapes = {
  wing: '<path d="M2 13c3-8 17-8 20 0-6-3-14-3-20 0Zm2-1 7 8m9-8-7 8m-1-9v8"/>',
  book: '<path d="M4 4h13a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4Zm0 13h15M8 8h7"/>',
  camera:
    '<path d="M3 7h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="12.5" r="3"/>',
  mute: '<path d="m3 9 4 0 5-4v14l-5-4H3zM16 9l5 6m0-6-5 6"/>',
  sound: '<path d="M3 9h4l5-4v14l-5-4H3zM16 8q4 4 0 8m3-11q7 7 0 14"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1m-10 3h8"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  map: '<path d="m2 5 7-2 6 2 7-2v16l-7 2-6-2-7 2zm7-2v16m6-14v16"/>',
  play: '<path d="m6 3 14 9-14 9z"/>',
  pause: '<path stroke-width="4" d="M8 5v14m8-14v14"/>',
  shuffle:
    '<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 5-5m2-4c2-3 3-3 5-3h3m-4-4 4 4-4 4"/>',
  route:
    '<circle cx="5" cy="17" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 17h7a3 3 0 0 0 0-6h-4a2.5 2.5 0 0 1 0-5h7"/>',
  descent: '<path d="m2 18 7-11 5 7 3-5 5 9zm7-11 3 5-3-1-2 1"/>',
  gate: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/>',
  activity: '<path d="M2 13h5l3-8 4 14 3-8 2 2h3"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
};
export function icons(root = document) {
  root.querySelectorAll("[data-i]").forEach((el) => {
    el.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      (shapes[el.dataset.i] || "") +
      "</svg>";
  });
}
export function createMap(canvas, world, gates) {
  const bg = document.createElement("canvas"),
    w = 340,
    h = 228;
  bg.width = w;
  bg.height = h;
  canvas.width = w;
  canvas.height = h;
  const ctx = bg.getContext("2d"),
    out = canvas.getContext("2d");
  const minZ = gates.at(-1).z - 320,
    maxZ = 380;
  const minX = -1640,
    maxX = 1640;
  const px = (x) => ((x - minX) / (maxX - minX)) * w,
    py = (z) => ((z - minZ) / (maxZ - minZ)) * h;
  ctx.fillStyle = "#22302b";
  ctx.fillRect(0, 0, w, h);
  const n = 65,
    m = 47,
    surface = Array.from({ length: m }, (_, j) =>
      Array.from({ length: n }, (_, i) =>
        world.height(
          minX + (i / (n - 1)) * (maxX - minX),
          minZ + (j / (m - 1)) * (maxZ - minZ),
        ),
      ),
    );
  for (let level = 0; level < 5400; level += 55) {
    ctx.strokeStyle = level % 275 === 0 ? "#65766a" : "#45584c";
    ctx.lineWidth = level % 275 === 0 ? 1.55 : 1;
    ctx.beginPath();
    for (let j = 0; j < m - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const v = [
          surface[j][i],
          surface[j][i + 1],
          surface[j + 1][i + 1],
          surface[j + 1][i],
        ];
        const corners = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ];
        let pen = false;
        for (let k = 0; k < 4; k++) {
          const b = (k + 1) % 4;
          if (v[k] < level === v[b] < level) continue;
          const f = (level - v[k]) / (v[b] - v[k]);
          const x =
              ((corners[k][0] + f * (corners[b][0] - corners[k][0])) * w) /
              (n - 1),
            y =
              ((corners[k][1] + f * (corners[b][1] - corners[k][1])) * h) /
              (m - 1);
          if (pen) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          pen = !pen;
        }
      }
    ctx.stroke();
  }
  const nodes = [{ x: world.center(0), z: 0 }, ...gates];
  ctx.strokeStyle = "#ff854b";
  ctx.lineWidth = 2.6;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  nodes.forEach((p, i) =>
    i ? ctx.lineTo(px(p.x), py(p.z)) : ctx.moveTo(px(p.x), py(p.z)),
  );
  ctx.stroke();
  ctx.setLineDash([]);
  const end = gates.at(-1);
  ctx.fillStyle = "#e9ead9";
  ctx.fillRect(px(end.x) - 4, py(end.z) - 4, 8, 8);
  return (state) => {
    out.drawImage(bg, 0, 0);
    out.save();
    out.translate(px(state.x), py(state.z));
    out.rotate(state.heading);
    out.fillStyle = "#ff743b";
    out.strokeStyle = "#19241d";
    out.lineWidth = 1.8;
    out.beginPath();
    out.moveTo(0, -12);
    out.lineTo(7, 7);
    out.lineTo(0, 4);
    out.lineTo(-7, 7);
    out.closePath();
    out.fill();
    out.stroke();
    out.restore();
  };
}
export function drawCompass(canvas, angle) {
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (canvas.width !== w * 2 || canvas.height !== h * 2) {
    canvas.width = w * 2;
    canvas.height = h * 2;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const deg = (angle * 180) / Math.PI,
    letters = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let tick = Math.floor((deg - 50) / 5) * 5; tick < deg + 50; tick += 5) {
    const x = w / 2 + ((tick - deg) * w) / 92;
    const major = tick % 15 === 0;
    ctx.globalAlpha = Math.min(
      1,
      Math.max(0, 1.8 - (Math.abs(x - w / 2) / (w / 2)) * 1.7),
    );
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, major ? 20 : 23, 1, major ? 7 : 4);
    if (major) {
      ctx.font = "bold " + (tick % 45 === 0 ? 13 : 10) + "px Manrope";
      let t = ((tick % 360) + 360) % 360;
      ctx.fillText(t % 45 === 0 ? letters[t / 45] : t, x, 4);
    }
  }
  ctx.globalAlpha = 1;
}
