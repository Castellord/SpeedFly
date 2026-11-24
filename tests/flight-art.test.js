import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadFlightArt, useCompactArt } from "../src/flight-art.js";

test("a stalled download yields a bundled rock on timeout or quick start", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const file = "models/rock_09-lod.glb";
  const streams = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url instanceof URL) return new Response(await readFile(url));
    // Some browsers deliver a late response even after abort. It must never
    // replace the mesh the pilot saw when the line opened.
    return new Promise((finish) =>
      streams.push({ finish, signal: options.signal }),
    );
  });
  const decode = async (blob) => await blob.slice(0, 4).text();
  for (const trigger of [() => t.mock.timers.tick(12000), useCompactArt]) {
    const ready = loadFlightArt(file, decode);
    trigger();
    assert.equal(await ready, "glTF");
    const stream = streams.at(-1);
    assert.equal(stream.signal.aborted, true);
    stream.finish(new Response("late"));
  }
});

test("an unavailable texture or a decode failure uses its embedded image", async (t) => {
  let response = new Response(null, { status: 404 });
  t.mock.method(globalThis, "fetch", async (url) =>
    url instanceof URL ? new Response(await readFile(url)) : response,
  );
  const decode = async (blob) => {
    const header = await blob.slice(0, 4).text();
    if (header !== "RIFF") throw new Error("invalid WebP");
    return header;
  };
  assert.equal(await loadFlightArt("meadow.webp", decode), "RIFF");
  response = new Response("bad image");
  assert.equal(await loadFlightArt("meadow.webp", decode), "RIFF");
});
