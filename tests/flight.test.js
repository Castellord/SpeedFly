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

const horizontalRadius = (s) =>
  (s.speed * Math.cos(s.pitch)) / Math.abs(s.headingRate);

test("a smooth stroke banks continuously and an inside regrip tightens the descending spiral", () => {
  for (const sign of [-1, 1]) {
    const side = sign > 0 ? "right" : "left";
    const fast = sign > 0 ? "fastRight" : "fastLeft";
    for (const fps of [24, 120]) {
      for (const weight of [0, sign]) {
        const flight = createFlight(levelField);
        const s = flight.reset("free");
        s.y = s.agl = 1000;
        let bank = 0;
        for (let i = 0; i < 15 * fps; i++) {
          flight.step(1 / fps, { [side]: 1 });
          assert.ok(sign * s.canopyBank >= bank - 0.0001);
          assert.ok(sign * s.headingRate >= -0.0001);
          bank = sign * s.canopyBank;
        }
        const radius = horizontalRadius(s);
        assert.ok(radius > 16 && radius < 26);
        for (let i = 0; i < 3 * fps; i++) {
          flight.step(1 / fps, { [side]: 1, [fast]: true, weight });
          assert.ok(sign * s.headingRate > 0 && s.pitch < -0.4);
          assert.ok(Math.cos(s.canopyBank) > 0);
        }
        assert.ok(horizontalRadius(s) < radius * 0.94);
        assert.equal(s.rolls, 0);
      }
    }
  }
});

test("switching to a smooth stroke above the canopy carries the roll through as airspeed falls", () => {
  for (const sign of [-1, 1]) {
    const side = sign > 0 ? "right" : "left";
    const fast = sign > 0 ? "fastRight" : "fastLeft";
    for (const fps of [24, 120]) {
      const flight = createFlight(levelField);
      const s = flight.reset("free");
      for (let i = 0; i < 2 * fps && sign * s.bank < Math.PI * 0.9; i++) {
        flight.step(1 / fps, { [side]: 1, [fast]: true, weight: sign });
      }
      assert.ok(Math.cos(s.canopyBank) < -0.75);
      const bank = s.bank,
        speed = s.speed,
        pitch = s.pitch;
      for (let i = 0; i < fps / 2; i++) {
        flight.step(1 / fps, { [side]: 1 });
        assert.ok(sign * s.bankRate > 0);
      }
      assert.ok(sign * (s.bank - bank) > 1);
      assert.ok(s.speed < speed && s.pitch < pitch);
      for (let i = 0; i < fps; i++) flight.step(1 / fps, { [side]: 1 });
      assert.equal(s.rolls, 1);
    }
  }
});

test("holding a fast stroke from straight flight cannot retrigger the initial roll", () => {
  for (const sign of [-1, 1]) {
    const flight = createFlight(levelField);
    const s = flight.reset("free");
    s.y = s.agl = 1000;
    const input =
      sign > 0 ? { right: 1, fastRight: true } : { left: 1, fastLeft: true };
    flyFor(flight, 11, () => ({ ...input, weight: sign }));
    assert.equal(s.rolls, 1);
    assert.equal(s.status, "flying");
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
    pulse = 0,
    previousBank = 0;
  for (let frame = 0; frame < 18000 && s.status === "flying"; frame++) {
    if (frame % 12 === 0) {
      const look = 42;
      const x = world.center(s.z - look);
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
    }
    flight.step(dt, { left, right, trim: 1 });
    heights.push(s.agl);
  }
  return heights.sort((a, b) => a - b);
}

test("proximity courses reach the finish at full open trim using only keyboard steering", () => {
  for (const seed of [1847, 6, 42, 4, 8, 935, 8175, 1221]) {
    const world = createWorld(new Scene(), seed);
    try {
      const flight = createFlight(world, seed);
      assert.equal(flight.reset("free").agl, 350);
      const s = flight.reset();
      assert.equal(s.trim, 1);
      assert.equal(flight.gates.length, 0);
      const heights = followLine(flight, world);
      assert.equal(s.status, "finished", String(seed));
      assert.ok(s.z <= world.finishZ);
      assert.equal(s.trim, 1);
      assert.ok(heights[0] > 1 && heights[Math.floor(heights.length / 2)] < 23);
      assert.ok(s.proximityDistance > 0 && s.proximityDistance <= s.distance);
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

test("glide forecast preserves live dynamics and follows held brakes and trim", () => {
  const ground = { center: () => 0, height: () => 0 };
  const wing = createFlight(ground, 8),
    twin = createFlight(ground, 8);
  wing.reset("free");
  twin.reset("free");
  const command = { left: 0.38, weight: -0.16, trim: 0.61 };
  for (let i = 0; i < 45; i++) {
    wing.step(1 / 60, command);
    twin.step(1 / 60, command);
  }
  const before = { ...wing.state },
    points = [];
  wing.predictGlide((s) => points.push({ x: s.x, y: s.y, z: s.z }));
  assert.deepEqual(wing.state, before);
  for (let i = 0; i < 120; i++) {
    wing.step(1 / 60, command);
    twin.step(1 / 60, command);
  }
  assert.deepEqual(wing.state, twin.state);
  const p = points[10];
  assert.ok(
    Math.hypot(p.x - wing.state.x, p.y - wing.state.y, p.z - wing.state.z) < 1,
  );
  const low = createFlight(
    { center: () => 0, height: (_x, z) => (z < -26 ? 50 : 0) },
    2,
  );
  let end;
  low.predictGlide((s) => {
    end = { status: s.status, z: s.z };
  });
  assert.equal(end.status, "crashed");
  assert.ok(end.z > -30);
});
