// Point-mass flight under a banked lifting wing. Distances are metres, angles radians.
const G = 9.81;
const TAU = 2 * Math.PI;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const unit = (value) => clamp(Number.isFinite(value) ? value : 0, 0, 1);
const approach = (current, target, rate, dt) =>
  current + (target - current) * -Math.expm1(-rate * dt);
const principalAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

function randomSource(seed) {
  let value = 2166136261;
  for (const character of String(seed))
    value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeCourse(world, seed) {
  const random = randomSource(seed);
  const phase = random() * TAU;
  const gates = [];
  const finish = 3200;
  const count = 12;
  const startGround = world.height(world.center(0), 0);
  const endGround = world.height(world.center(-finish), -finish);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const distance =
      200 +
      t * (finish - 200) +
      (i === 0 || i === count - 1 ? 0 : (random() - 0.5) * 48);
    const z = -distance;
    const x =
      world.center(z) + Math.sin(phase + t * 8.5) * 22 + (random() - 0.5) * 12;
    const ground = world.height(x, z);
    const grade = startGround + ((endGround - startGround) * distance) / finish;
    const y = Math.max(ground + 43, grade * 0.66 + ground * 0.34 + 65);
    gates.push({ x, y, z, radius: i === count - 1 ? 42 : 33 });
  }
  return gates;
}

const neutralSpeed = (trim) => 18 + 9 * trim;
const neutralAngle = (trim) => -Math.atan(0.2 + 0.24 * trim);

export function createFlight(world, seed = 1) {
  const gates = makeCourse(world, seed);
  const state = {};
  let bankVelocity, rollTarget, rollDirection, rollCooldown;

  function reset(style = "line") {
    const trim = 0.5;
    const first = gates[0];
    const x = world.center(0);
    const ground = world.height(x, 0);
    const heading = Math.atan2(first.x - x, -first.z);
    const y =
      style === "free"
        ? ground + 350
        : Math.max(
            ground + 52,
            first.y +
              Math.hypot(first.x - x, first.z) * -Math.tan(neutralAngle(trim)),
          );
    const pitch = neutralAngle(trim);
    const speed = neutralSpeed(trim);
    Object.assign(state, {
      x,
      y,
      z: 0,
      heading,
      bank: 0,
      pitch,
      speed,
      climb: speed * Math.sin(pitch),
      agl: y - ground,
      style,
      impact: null,
      distance: 0,
      time: 0,
      nextGate: 0,
      passed: 0,
      missed: 0,
      status: "flying",
      left: 0,
      right: 0,
      trim,
      rolls: 0,
    });
    bankVelocity = 0;
    rollTarget = 0;
    rollDirection = 0;
    rollCooldown = 0;
    return state;
  }

  function updateBank(dt, demand) {
    const bank = principalAngle(state.bank);
    rollCooldown = Math.max(0, rollCooldown - dt);
    if (
      !rollDirection &&
      rollCooldown === 0 &&
      demand * bank < -0.52 &&
      Math.abs(demand) > 0.84 &&
      state.speed > 18.5
    ) {
      // A strong reversal unloads the first turn and supplies angular momentum through the opposite side.
      rollDirection = Math.sign(demand);
      rollTarget = Math.round(state.bank / TAU) * TAU + rollDirection * TAU;
    }
    if (rollDirection) {
      const remaining = (rollTarget - state.bank) * rollDirection;
      const targetRate = clamp(
        remaining * 2.8 + 0.65,
        0.65,
        3.0 + 0.025 * (state.speed - 18),
      );
      bankVelocity = approach(
        bankVelocity,
        rollDirection * targetRate,
        4.8,
        dt,
      );
      state.bank += bankVelocity * dt;
      if ((rollTarget - state.bank) * rollDirection <= 0) {
        rollDirection = 0;
        rollCooldown = 0.65;
        state.rolls++;
      }
      return;
    }
    const target =
      demand * clamp(1.08 + (state.speed - 15) * 0.013, 0.92, 1.36);
    bankVelocity += ((target - bank) * 8.8 - 4.4 * bankVelocity) * dt;
    state.bank += bankVelocity * dt;
  }

  function integrate(dt, input) {
    const x0 = state.x,
      y0 = state.y,
      z0 = state.z;
    const right = unit(input.right),
      left = unit(input.left);
    state.left = approach(state.left, left, 6.5, dt);
    state.right = approach(state.right, right, 6.5, dt);
    state.trim = approach(state.trim, unit(input.trim ?? state.trim), 2.6, dt);
    // Detect the brisk reversal at the handles; use loaded lines for the normal bank response.
    const reversal =
      Math.abs(right - left) > 0.84 &&
      (right - left) * principalAngle(state.bank) < -0.52;
    updateBank(dt, reversal ? right - left : state.right - state.left);

    const symmetric = Math.min(state.left, state.right);
    const differential = Math.abs(state.left - state.right);
    const brake = symmetric + 0.23 * differential;
    const referenceAngle = neutralAngle(state.trim);
    const dynamicPressure = (state.speed / neutralSpeed(state.trim)) ** 2;
    const stall =
      clamp((symmetric - 0.73) / 0.27, 0, 1) *
      clamp((18 - state.speed) / 6, 0, 1);
    const wingLift =
      G *
      Math.cos(referenceAngle) *
      dynamicPressure *
      (1 + 0.66 * brake - 0.93 * stall);
    const drag =
      G *
      -Math.sin(referenceAngle) *
      dynamicPressure *
      (1 + 1.25 * brake + 0.53 * symmetric ** 4 + 0.2 * differential);
    const bankCos = Math.cos(state.bank);
    const speedRate = -G * Math.sin(state.pitch) - drag;
    const verticalLift = wingLift * bankCos;
    // Damping models the underslung pilot settling after a surge or a flare.
    const pitchRate =
      (verticalLift - G * Math.cos(state.pitch)) / state.speed -
      0.6 * (state.pitch - referenceAngle);
    state.pitch = clamp(state.pitch + pitchRate * dt, -1.3, 0.56);
    state.speed = clamp(state.speed + speedRate * dt, 6.5, 53);
    const horizontalSpeed = state.speed * Math.cos(state.pitch);
    state.heading +=
      ((wingLift * Math.sin(state.bank)) / Math.max(7, horizontalSpeed)) * dt;
    state.climb = state.speed * Math.sin(state.pitch);
    state.x += Math.sin(state.heading) * horizontalSpeed * dt;
    state.z -= Math.cos(state.heading) * horizontalSpeed * dt;
    state.y += state.climb * dt;
    state.distance += horizontalSpeed * dt;
    state.time += dt;
    const ground = world.height(state.x, state.z);
    state.agl = state.y - ground;

    const gate = state.style === "line" && gates[state.nextGate];
    if (gate && z0 >= gate.z && state.z <= gate.z && state.z < z0) {
      const t = (gate.z - z0) / (state.z - z0);
      const dx = x0 + (state.x - x0) * t - gate.x;
      const dy = y0 + (state.y - y0) * t - gate.y;
      if (dx * dx + dy * dy <= gate.radius ** 2) state.passed++;
      else state.missed++;
      state.nextGate++;
    }
    if (world.hitsObstacle?.(state.x, state.y, state.z)) {
      state.status = "crashed";
      state.impact = "obstacle";
    } else if (state.agl <= 0.65) {
      const approachRate =
        (ground - world.height(x0, z0) - (state.y - y0)) / dt;
      const gentle =
        approachRate < 2.5 &&
        state.speed < 14 &&
        Math.abs(principalAngle(state.bank)) < 0.22 &&
        symmetric > 0.55 &&
        state.climb > -4;
      state.y = ground + 0.65;
      state.agl = 0.65;
      state.status = gentle ? "landed" : "crashed";
      state.impact = "terrain";
    } else if (
      state.nextGate === gates.length ||
      (state.style === "free" && state.z <= gates.at(-1).z)
    ) {
      state.status = "finished";
    }
  }

  function step(dt, input = {}) {
    if (!(dt > 0) || !Number.isFinite(dt)) return state;
    const elapsed = Math.min(dt, 0.25);
    const steps = Math.ceil(elapsed * 90);
    for (let i = 0; i < steps && state.status === "flying"; i++)
      integrate(elapsed / steps, input);
    return state;
  }

  reset();
  return { state, gates, step, reset };
}
