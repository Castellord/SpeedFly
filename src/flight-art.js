// Ship a smaller copy of every flight asset in the game bundle. Once the
// application starts, the launch path can finish without any further network.
const active = new Set();
const progress = new EventTarget();
let completed = 0,
  requested = 0;

export function watchFlightArt(callback) {
  const report = () => callback(completed, requested);
  report();
  progress.addEventListener("change", report);
  return () => progress.removeEventListener("change", report);
}

export function useCompactArt() {
  for (const controller of active) controller.abort();
}

export async function loadFlightArt(file, decode) {
  const controller = new AbortController();
  requested++;
  active.add(controller);
  const signal = controller.signal;
  const deadline = setTimeout(() => controller.abort(), 12000);
  const interrupted = new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Interrupted")), {
      once: true,
    });
  });
  async function detailed() {
    const url = (import.meta.env?.BASE_URL || "./") + "assets/" + file;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return decode(await response.blob());
  }
  let asset;
  try {
    asset = await Promise.race([detailed(), interrupted]);
  } catch {
    const name = file.split("/").at(-1);
    const response = await fetch(
      new URL(`./compact/${name}?inline`, import.meta.url),
    );
    asset = await decode(await response.blob());
  } finally {
    clearTimeout(deadline);
    active.delete(controller);
  }
  completed++;
  progress.dispatchEvent(new Event("change"));
  return asset;
}
