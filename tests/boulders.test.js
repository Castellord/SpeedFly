import assert from "node:assert/strict";
import test from "node:test";
import { Scene } from "three";
import { createBoulders } from "../src/boulders.js";

test("the two launch boulders are visible obstacles before the first frame", () => {
  const scene = new Scene();
  const world = { center: () => 0, height: () => 0, addPass() {} };
  const rocks = createBoulders(scene, world, 1847);
  rocks.update(0, 0);
  assert.ok(
    scene.children[0].children.some((mesh) => mesh.visible && mesh.count),
  );
  for (const [x, z] of [
    [18, -18],
    [-20, -43],
  ]) {
    assert.ok(rocks.hits(x, 1, z));
    assert.equal(rocks.hits(x, 17, z), false);
  }
  assert.equal(rocks.hits(0, 1, -18), false);
  rocks.dispose();
  assert.equal(scene.children.length, 0);
});
