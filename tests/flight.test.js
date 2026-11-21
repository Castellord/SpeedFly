import test from "node:test";
import assert from "node:assert/strict";
import { Scene } from "three";
import { createFlight } from "../src/flight.js";
import { createWorld } from "../src/world.js";

const plane = { height: (x, z) => z * 0.32, center: () => 0 };
const dt = 1 / 60;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function flyFor(flight, seconds, controls) {
  for (let frame = 0; frame < Math.round(seconds / dt); frame++) {
    flight.step(dt, controls(frame * dt));
  }
}

test("the trim polar changes speed and glide, and an energetic flare trades speed for height", () => {
  const flight = createFlight(plane);
  const s = flight.reset("free");
  flyFor(flight, 15, () => ({ trim: 0 }));
  const closedSpeed = s.speed,
    closedSink = s.climb;
  flyFor(flight, 15, () => ({ trim: 1 }));
  assert.ok(s.speed > closedSpeed + 8);
  assert.ok(s.climb < closedSink - 8);
  flight.reset("free");
  flyFor(flight, 5, () => ({ trim: 0 }));
  flyFor(flight, 6, () => ({ trim: 0, right: 1 }));
  const entrySpeed = s.speed;
  flyFor(flight, 1.5, () => ({
    trim: 0,
    left: 1,
    right: 1,
    fastLeft: true,
    fastRight: true,
  }));
  assert.ok(s.climb > 0 && s.speed < entrySpeed);
});

const levelField = { height: () => 0, center: () => 0 };

test("a held brake orbits in a descending spiral in either direction without inverting", () => {
  for (const side of ["left", "right"]) {
    const flight = createFlight(levelField);
    const s = flight.reset("free");
    const cruise = s.speed,
      initialSink = s.climb;
    let highestBank = 0;
    flyFor(flight, 16, () => {
      highestBank = Math.max(highestBank, Math.abs(s.canopyBank));
      return { [side]: 1 };
    });
    assert.equal(s.status, "flying");
    assert.equal(s.spirals, 1);
    assert.equal(s.inSpiral, true);
    assert.equal(s.rolls, 0);
    assert.ok(highestBank < Math.PI / 2);
    assert.ok(Math.abs(s.heading) >= 2 * Math.PI);
    assert.ok(s.speed > cruise && s.climb < initialSink - 3);
    const beforeRelease = s.heading;
    flyFor(flight, 2.5, () => ({}));
    assert.ok(Math.abs(s.heading - beforeRelease) > 0.15);
    assert.equal(s.inSpiral, false);
  }
});

test("a progressive stroke with weight can roll in a loaded recovery; a late or interrupted stroke falls back", () => {
  for (const direction of [-1, 1]) {
    const entry = direction < 0 ? "right" : "left";
    const roll = direction < 0 ? "left" : "right";
    function attempt(delay, activeSeconds = 1.6) {
      const flight = createFlight(levelField);
      const s = flight.reset("free");
      let inverted = false;
      let maxLoad = 0;
      const run = (seconds, input) =>
        flyFor(flight, seconds, () => {
          if (Math.cos(s.canopyBank) * Math.cos(s.canopyPitch) < -0.25)
            inverted = true;
          maxLoad = Math.max(maxLoad, s.loadFactor);
          return input;
        });
      run(5, { [entry]: 1 });
      run(0.9, {});
      run(0.55, { left: 1, right: 1 });
      run(delay, {});
      const exitHeading = s.heading;
      const yAtEntry = s.y;
      run(activeSeconds, { [roll]: 1, weight: direction });
      run(5, {});
      return {
        s,
        inverted,
        maxLoad,
        headingChange: s.heading - exitHeading,
        heightLoss: yAtEntry - s.y,
      };
    }
    const good = attempt(0),
      late = attempt(5),
      interrupted = attempt(0, 0.25);
    assert.equal(good.s.status, "flying");
    assert.equal(good.s.rolls, 1);
    assert.equal(good.s.spirals, 0);
    assert.ok(good.inverted && good.maxLoad > 1.4 && good.heightLoss > 0);
    assert.ok(Math.abs(good.headingChange) < Math.PI / 2);
    assert.ok(Math.abs(good.s.bank - direction * 2 * Math.PI) < 0.14);
    assert.equal(late.s.rolls, 0);
    assert.equal(interrupted.s.rolls, 0);
  }
});

test("a hard reversal from trim flight produces a wingover and comes back on the same side", () => {
  const f = createFlight(levelField),
    s = f.reset("free");
  flyFor(f, 1.15, () => ({ right: 1 }));
  flyFor(f, 2.7, () => ({ left: 1 }));
  flyFor(f, 5, () => ({}));
  assert.equal(s.rolls, 0);
  assert.equal(s.spirals, 0);
  assert.ok(Math.abs(s.bank) < 0.12);
});

test("both stroke rates reach the same travel; a short sharp pull or symmetric flare cannot auto-complete a roll", () => {
  const f = createFlight(levelField),
    s = f.reset("free");
  flyFor(f, 0.15, () => ({ right: 1 }));
  const gentle = s.right;
  flyFor(f, 1, () => ({ right: 1 }));
  assert.equal(s.right, 1);
  f.reset("free");
  flyFor(f, 0.15, () => ({ right: 1, fastRight: true, weight: 1 }));
  assert.ok(s.right > gentle * 4);
  flyFor(f, 5, () => ({}));
  assert.equal(s.rolls, 0);
  f.reset("free");
  flyFor(f, 1, () => ({ right: 1, left: 1, fastRight: true, fastLeft: true }));
  assert.equal(s.left, 1);
  assert.equal(s.right, 1);
  assert.equal(s.bank, 0);
  assert.equal(s.rolls, 0);
});

test("a sharp input rolls directly and out of an established same-side spiral", () => {
  for (const side of ["left", "right"]) {
    const sign = side === "right" ? 1 : -1;
    const quick = side === "right" ? "fastRight" : "fastLeft";
    for (const enterFromTurn of [false, true]) {
      for (const fps of [24, 120]) {
        const f = createFlight(levelField),
          s = f.reset("free");
        // Give the prolonged post-manoeuvre hold room to settle.
        s.y = s.agl = 1000;
        if (enterFromTurn) {
          for (let i = 0; i < 15 * fps; i++) f.step(1 / fps, { [side]: 1 });
          assert.equal(s.spirals, 1);
          assert.equal(s.rolls, 0);
          assert.equal(s[side], 1);
        }
        let inverted = false;
        for (let i = 0; i < 3 * fps; i++) {
          f.step(1 / fps, { [side]: 1, [quick]: true, weight: sign });
          if (Math.cos(s.canopyBank) * Math.cos(s.canopyPitch) < -0.4)
            inverted = true;
        }
        assert.ok(inverted);
        assert.equal(s.rolls, 1);
        for (let i = 0; i < 8 * fps; i++)
          f.step(1 / fps, { [side]: 1, [quick]: true, weight: sign });
        assert.equal(s.rolls, 1);
        assert.equal(s.status, "flying");
      }
    }
  }
});

test("an unprepared roll consumes more height and airspeed than the same stroke on a loaded exit", () => {
  function measure(prepared) {
    const f = createFlight(levelField),
      s = f.reset("free");
    if (prepared) {
      flyFor(f, 6, () => ({ left: 1 }));
      flyFor(f, 1.2, () => ({}));
      flyFor(f, 0.3, () => ({
        left: 1,
        right: 1,
        fastLeft: true,
        fastRight: true,
      }));
      flyFor(f, 0.35, () => ({}));
    }
    const y = s.y,
      speed = s.speed;
    for (let i = 0; i < 240 && !s.rolls; i++)
      f.step(1 / 120, { right: 1, fastRight: true, weight: 1 });
    assert.equal(s.rolls, 1);
    return { height: y - s.y, speed: speed - s.speed };
  }
  const direct = measure(false),
    prepared = measure(true);
  assert.ok(prepared.height > 0 && prepared.speed > 0);
  assert.ok(direct.height > prepared.height + 3);
  assert.ok(direct.speed > prepared.speed + 0.8);
});

// Sample the visible line ahead, then apply keyboard-sized 200 ms pulses. This
// test pilot only supplies ordinary controls and cannot move the simulated wing.
function followLine(flight, world) {
  const s = flight.state,
    heights = [];
  let left = 0,
    right = 0,
    trim = s.trim,
    pulse = 0,
    previousBank = 0;
  for (let frame = 0; frame < 18000 && s.status === "flying"; frame++) {
    if (frame % 12 === 0) {
      const gate = flight.gates[s.nextGate],
        look = 42,
        z = s.z - look;
      const x =
        world.center(z) +
        clamp((gate.z - z) / look, 0, 1) * (gate.x - world.center(gate.z));
      const headingError = Math.atan2(x - s.x, look) - s.heading;
      const bankRate = (s.bank - previousBank) / 0.2;
      previousBank = s.bank;
      pulse += clamp(
        2.3 * Math.atan2(Math.sin(headingError), Math.cos(headingError)) -
          0.68 * s.bank -
          0.34 * bankRate,
        -0.95,
        0.95,
      );
      right = Number(pulse > 0.43);
      left = Number(pulse < -0.43);
      pulse -= right - left;
      // Look across sudden rock shelves and choose a glide between their lips.
      let envelope = world.height(x, z);
      for (const offset of [-85, -42, 42, 85]) {
        const probeZ = z + offset;
        const projected =
          world.height(world.center(probeZ), probeZ) - 0.325 * offset;
        envelope = Math.max(envelope, projected);
      }
      const slope = (s.y - envelope - 9) / Math.hypot(look, x - s.x);
      const targetTrim = clamp(
        (Math.max(0, slope - 0.19) / 0.42) ** (1 / 1.16),
        0,
        1,
      );
      if (Math.abs(targetTrim - trim) > 0.026)
        trim = clamp(trim + Math.sign(targetTrim - trim) * 0.05, 0, 1);
    }
    flight.step(dt, { left, right, trim });
    heights.push(s.agl);
  }
  return heights.sort((a, b) => a - b);
}

test("proximity courses can be flown continuously with discrete controls", () => {
  for (const seed of [1847, 6, 42]) {
    const world = createWorld(new Scene(), seed);
    try {
      const flight = createFlight(world, seed);
      assert.equal(flight.reset("free").agl, 350);
      flight.reset();
      for (const gate of flight.gates) {
        const height = gate.y - world.height(gate.x, gate.z);
        assert.ok(height >= 8 && height <= 11);
        assert.ok(gate.radius >= 6 && gate.radius <= 8);
      }
      const heights = followLine(flight, world);
      assert.equal(flight.state.status, "finished", String(seed));
      assert.equal(flight.state.passed, flight.gates.length, String(seed));
      assert.ok(heights[Math.floor(0.95 * heights.length)] < 20);
      assert.ok(flight.state.proximityDistance > 0.85 * flight.state.distance);
      assert.ok(flight.state.proximityDistance <= flight.state.distance);
    } finally {
      world.dispose();
    }
  }
});

test("the canopy can hit the slope before the harness in an inverted pass", () => {
  const world = { height: () => 0, center: () => 0 };
  const flight = createFlight(world);
  const s = flight.state;
  s.y = 4;
  s.bank = Math.PI;
  flight.step(dt, {});
  assert.ok(s.agl > 3);
  assert.equal(s.status, "crashed");
  assert.equal(s.impact, "terrain");
});

test("proximity distance clips both directions of the 15 metre crossing", () => {
  const dt = 1 / 240;
  // A level field crosses the threshold on descent; the steep field falls
  // away underneath the wing and crosses the same threshold on ascent.
  for (const [slope, start] of [
    [0, 15.006],
    [1.1, 14.994],
  ]) {
    const world = { height: (x, z) => slope * z, center: () => 0 };
    const flight = createFlight(world);
    const s = flight.state;
    s.y = start;
    s.agl = start;
    flight.step(dt);
    assert.ok((s.agl - 15) * (start - 15) < 0);
    const expected =
      (s.distance * (15 - Math.min(s.agl, start))) / Math.abs(s.agl - start);
    assert.ok(Math.abs(s.proximityDistance - expected) < 1e-9);
    assert.equal(flight.reset("free").proximityDistance, 0);
  }
});
