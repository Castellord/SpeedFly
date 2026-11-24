import { Texture } from "three";
import { loadFlightArt } from "./flight-art.js";

const images = new Map();

async function decodeImage(blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function flightTexture(file) {
  if (typeof document === "undefined") return null;
  if (!images.has(file)) {
    const texture = new Texture();
    const ready = loadFlightArt(file, decodeImage).then((image) => {
      texture.image = image;
      texture.needsUpdate = true;
    });
    images.set(file, { texture, ready });
  }
  return images.get(file).texture;
}

export function texturesReady() {
  return Promise.all(Array.from(images.values(), (entry) => entry.ready));
}
