import { TextureLoader } from "three";

// The whole course shares these images, including subsequent generated lines.
const images = new Map();

export function flightTexture(file) {
  if (typeof document === "undefined") return null;
  if (!images.has(file)) {
    const entry = {};
    entry.ready = new Promise((resolve, reject) => {
      entry.texture = new TextureLoader().load(
        (import.meta.env?.BASE_URL || "./") + "assets/" + file,
        resolve,
        undefined,
        () => reject(new Error("Не удалось загрузить " + file)),
      );
    });
    images.set(file, entry);
  }
  return images.get(file).texture;
}

export function texturesReady() {
  return Promise.all(Array.from(images.values(), (entry) => entry.ready));
}
