import assert from "node:assert/strict";
import test from "node:test";
import { measureManeuver } from "../scripts/maneuvers.mjs";

const right = { right: 1 };
const left = { left: 1 };
const sharpLeft = { left: 1, fastLeft: true };
const both = { left: 1, right: 1, fastLeft: true, fastRight: true };

test("reversing the brake exchanges sides progressively and retains roll inertia on release", () => {
  for (const fastRight of [false, true]) {
    const setup = [[5, { right: 1, fastRight }]];
    const observe = (seconds, control) =>
      measureManeuver({ setup, phases: [[seconds, control]] });
    const release = observe(5, {});
    assert.ok(Math.abs(release.bank) < 10);
    assert.ok(
      release.headingChange > 5,
      "the course should continue turning during rollout",
    );

    const quick = observe(1, sharpLeft);
    const gentle = observe(1, left);
    assert.ok(quick.peakRollRate > gentle.peakRollRate * 1.2);
    assert.ok(quick.energyLossPerKg > 0 && gentle.energyLossPerKg > 0);
    // Identical depth in the opposite hand does not erase the preceding turn.
    const continued = observe(8, left);
    assert.ok(continued.headingChange < -45);
  }
});

test("after deep symmetric braking the wing dives and recovers differently from a short flare", () => {
  const release = (brakeTime, releaseTime) =>
    measureManeuver({
      setup: [[brakeTime, both]],
      phases: [[releaseTime, {}]],
    });
  const initial = measureManeuver({ phases: [[8, both]] });
  const deep = release(8, 1),
    short = release(0.5, 1);
  assert.equal(deep.bank, 0);
  assert.equal(deep.headingChange, 0);
  assert.ok(initial.bestClimb > initial.climb + 5);
  assert.ok(deep.speed > initial.speed && deep.climb < initial.climb);
  assert.ok(deep.heightLoss > short.heightLoss + 5);
  assert.ok(deep.energyLossPerKg > 0 && short.energyLossPerKg > 0);
  const recovered = release(8, 6);
  assert.ok(
    recovered.climb > deep.climb + 4 && recovered.speed > initial.speed,
  );
});

test("roll, yaw and energy traces mirror and converge across display frame rates", () => {
  for (const rapid of [false, true]) {
    for (const fps of [24, 144]) {
      const reference = measureManeuver({
        setup: [[5, right]],
        phases: [[4, { left: 1, fastLeft: rapid }]],
      });
      const mirrored = measureManeuver(
        { setup: [[5, left]], phases: [[4, { right: 1, fastRight: rapid }]] },
        fps,
      );
      assert.ok(
        Math.abs(reference.headingChange + mirrored.headingChange) < 1e-6,
      );
      assert.ok(Math.abs(reference.heightLoss - mirrored.heightLoss) < 1e-6);
      assert.ok(Math.abs(reference.speed - mirrored.speed) < 1e-6);
      assert.ok(Math.abs(reference.peakRollRate - mirrored.peakRollRate) < 12);
      assert.equal(reference.rolls, mirrored.rolls);
      assert.equal(reference.inverted, mirrored.inverted);
    }
  }
});

test("the canopy nose and ground track separate in a turn and realign after release", () => {
  for (const [control, direction] of [
    [left, -1],
    [right, 1],
  ]) {
    const entry = measureManeuver({ phases: [[1.5, control]] });
    assert.ok(entry.noseToCourse * direction > 0.5);
    const exit = measureManeuver({
      setup: [[1.5, control]],
      phases: [[6, {}]],
    });
    assert.ok(Math.abs(exit.noseToCourse) < Math.abs(entry.noseToCourse) * 0.2);
  }
});

test("adding the other brake in a turn retains initial course momentum and removes roll asymmetry", () => {
  const setup = [[5, right]];
  const hold = measureManeuver({ setup, phases: [[3, right]] });
  const flare = measureManeuver({ setup, phases: [[3, both]] });
  assert.equal(flare.rolls, 0);
  assert.ok(Math.abs(flare.bank) < 10);
  assert.ok(
    flare.headingChange > 3 && flare.headingChange < hold.headingChange,
  );
  assert.ok(flare.speed < hold.speed && flare.heightLoss < hold.heightLoss);
});
