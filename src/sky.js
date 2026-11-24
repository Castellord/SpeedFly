import * as THREE from "three";

// Draw the sky once. Wrap the cloud banks across the panorama seam.
export function alpineSky() {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  for (const [at, color] of [
    [0, "#4a99cc"],
    [0.32, "#81c8e1"],
    [0.52, "#dfebdf"],
    [1, "#ecddbc"],
  ])
    gradient.addColorStop(at, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const banks = [
    [0.02, 0.42, 0.85],
    [0.14, 0.34, 0.8],
    [0.24, 0.46, 0.61],
    [0.34, 0.39, 1.1],
    [0.49, 0.33, 0.76],
    [0.6, 0.435, 0.96],
    [0.72, 0.37, 0.68],
    [0.85, 0.43, 0.77],
    [0.98, 0.31, 0.57],
  ];
  for (const [x, y, scale] of banks) {
    for (const wrap of [-1, 0, 1]) {
      ctx.save();
      ctx.translate((x + wrap) * canvas.width, y * canvas.height);
      ctx.scale(scale, scale);
      ctx.beginPath();
      ctx.moveTo(-70, 1);
      ctx.lineTo(-56, -6);
      ctx.lineTo(-40, -7);
      ctx.lineTo(-30, -15);
      ctx.lineTo(-14, -17);
      ctx.lineTo(-3, -27);
      ctx.lineTo(17, -29);
      ctx.lineTo(33, -22);
      ctx.lineTo(39, -13);
      ctx.lineTo(58, -12);
      ctx.lineTo(73, -5);
      ctx.lineTo(91, 0);
      ctx.lineTo(54, 4);
      ctx.lineTo(-32, 5);
      ctx.closePath();
      ctx.fillStyle = "#fffae7";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-70, 1);
      ctx.lineTo(-19, -2);
      ctx.lineTo(2, 0);
      ctx.lineTo(26, -6);
      ctx.lineTo(48, -1);
      ctx.lineTo(91, 0);
      ctx.lineTo(54, 4);
      ctx.lineTo(-32, 5);
      ctx.closePath();
      ctx.fillStyle = "#e5e3d8";
      ctx.fill();
      ctx.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
