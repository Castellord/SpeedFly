// Point-mass flight under a banked lifting wing. Distances are metres, angles radians.
const G = 9.81;
const TAU = 2 * Math.PI;
const canopySection = [
  [-4.2, 3.3],
  [0, 5.2],
  [4.2, 3.3],
];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const unit = (value) => clamp(Number.isFinite(value) ? value : 0, 0, 1);
const approach = (current, target, rate, dt) =>
  current + (target - current) * -Math.expm1(-rate * dt);
const principalAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

const proximityHeight = 15;
function fractionNearGround(start, end) {
  if (start <= proximityHeight && end <= proximityHeight) return 1;
  if (start >= proximityHeight && end >= proximityHeight) return 0;
  return (proximityHeight - Math.min(start, end)) / Math.abs(end - start);
}

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
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const scatter = i === 0 || i === count - 1 ? 0 : (random() - 0.5) * 52;
    const distance = 125 + t * (finish - 125) + scatter;
    const z = -distance;
    const x = world.center(z) + 3.5 * Math.sin(phase + 9 * t);
    const clearance = 9.5 + 1.3 * Math.sin(phase + t * 11);
    const radius = i === 0 || i === count - 1 ? 8 : 6.8 + random() * 0.9;
    gates.push({ x, y: world.height(x, z) + clearance, z, radius });
  }
  return gates;
}

// Tuned generic wing polar. The equilibrium is set by L = W cos γ and D = -W sin γ.
const neutralSpeed = (trim) => 17.5 + 10.5 * trim;
const glideSlope = (trim) => 0.19 + 0.42 * trim ** 1.16;
const neutralAngle = (trim) => -Math.atan(glideSlope(trim));

export function createFlight(world, seed = 1) {
  const gates = makeCourse(world, seed);
  const state = {};
  let bankVelocity, lastUpright, canopyDeflection, deflectionRate;
  let spiralArc, spiralDirection, invertedSide;

  function reset(style = "line") {
    const first = gates[0];
    const x = world.center(0);
    const ground = world.height(x, 0);
    const heading = Math.atan2(first.x - x, -first.z);
    const y = ground + (style === "free" ? 350 : 11);
    // An airborne start is already established on the first leg's glide angle.
    // From here on the pilot alone determines height, speed and direction.
    const initialSlope = (y - first.y) / Math.hypot(first.x - x, first.z);
    const trim =
      style === "free"
        ? 0.5
        : unit((Math.max(0, initialSlope - 0.19) / 0.42) ** (1 / 1.16));
    const pitch = neutralAngle(trim);
    const speed = neutralSpeed(trim);
    Object.assign(state, {
      x,
      y,
      z: 0,
      heading,
      bank: 0,
      bankRate: 0,
      weight: 0,
      loadFactor: Math.cos(pitch),
      recoveryLoad: 0,
      spirals: 0,
      inSpiral: false,
      canopyBank: 0,
      pitch,
      pitchRate: 0,
      canopyPitch: pitch + 0.15 - 0.08 * trim,
      speed,
      climb: speed * Math.sin(pitch),
      agl: y - ground,
      style,
      impact: null,
      distance: 0,
      proximityDistance: 0,
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
    lastUpright = 0;
    invertedSide = 0;
    canopyDeflection = 0;
    deflectionRate = 0;
    spiralArc = 0;
    spiralDirection = 0;
    return state;
  }

  function updateBank(dt, differential, brake, pressure) {
    // The canopy responds first. The suspended mass follows as the lines
    // transmit the lateral component of the aerodynamic force.
    const steering = differential * (0.19 + 0.14 * Math.min(pressure, 2));
    deflectionRate +=
      (38 * (steering - canopyDeflection) - 8 * deflectionRate) * dt;
    canopyDeflection += deflectionRate * dt;
    const bank = state.bank;
    const drive = canopyDeflection / 0.33;
    const support = state.recoveryLoad / (0.54 + state.recoveryLoad);
    // Steady asymmetric drag produces a banked turn. In a loaded pull-out,
    // shifting the suspended mass and deflecting a half-wing gives more moment.
    const carve = drive * (0.56 + 0.36 * Math.cos(bank));
    const shift = state.weight * (0.12 * Math.cos(bank) + 1.45 * support);
    const moment = carve + shift + 1.55 * support * drive;
    const damping =
      1.3 +
      0.18 * Math.abs(bankVelocity) +
      0.58 * brake +
      0.62 * (1 - Math.min(1, Math.abs(drive) + Math.abs(state.weight))) ** 2;
    bankVelocity +=
      (5.8 * (moment - Math.sin(bank)) - damping * bankVelocity) * dt;
    state.bank += bankVelocity * dt;
    state.bankRate = bankVelocity;
    state.canopyBank =
      state.bank + 0.25 * canopyDeflection + 0.19 * deflectionRate;
  }

  function trackManeuvers(headingChange) {
    // An orbit in heading and a complete roll about the flight path are
    // different windings. Returning through the same side cancels a wingover.
    const rotation = state.bank - lastUpright;
    const canopyAbovePilot =
      Math.cos(state.canopyBank) * Math.cos(state.canopyPitch);
    if (canopyAbovePilot < -0.2) invertedSide = Math.sign(rotation);
    if (Math.abs(rotation) < 0.25) invertedSide = 0;
    if (
      Math.abs(rotation) >= TAU - 0.12 &&
      Math.sign(rotation) === invertedSide &&
      canopyAbovePilot > 0
    ) {
      invertedSide = 0;
      lastUpright += Math.sign(rotation) * TAU;
      state.rolls++;
    }
    const angle = Math.abs(principalAngle(state.bank));
    const direction = Math.sign(headingChange);
    const turning = angle > 0.56 && angle < Math.PI / 2 && state.climb < -3;
    if (!turning || direction !== spiralDirection) {
      spiralArc = 0;
      state.inSpiral = false;
      spiralDirection = direction;
    }
    if (turning) spiralArc += Math.abs(headingChange);
    if (spiralArc >= Math.PI / 2) state.inSpiral = true;
    if (spiralArc >= TAU) {
      state.spirals++;
      spiralArc -= TAU;
    }
  }

  function canopyImpact() {
    const rollSin = Math.sin(state.canopyBank),
      rollCos = Math.cos(state.canopyBank);
    const pitchSin = Math.sin(state.canopyPitch),
      pitchCos = Math.cos(state.canopyPitch);
    const headingSin = Math.sin(state.heading),
      headingCos = Math.cos(state.heading);
    for (const [span, height] of canopySection) {
      const lateral = span * rollCos + height * rollSin;
      const vertical = height * rollCos - span * rollSin;
      const aft = vertical * pitchSin;
      const x = state.x + lateral * headingCos - aft * headingSin;
      const y = state.y + vertical * pitchCos;
      const z = state.z + lateral * headingSin + aft * headingCos;
      if (y <= world.height(x, z)) return "terrain";
      if (world.hitsObstacle?.(x, y, z)) return "obstacle";
    }
    return null;
  }

  // The aerodynamic reference travels on the integrated flight path. The
  // harness describes a smaller arc around it. Resolve that radius in the
  // plane perpendicular to velocity, so an inverted pilot actually moves
  // over the reference and a banked pilot swings outside the turn.
  const swingRadius = 1.75;
  const harnessBefore = [0, 0, 0],
    harnessAfter = [0, 0, 0];
  function harnessOffset(out) {
    const side = -swingRadius * Math.sin(state.bank);
    const down = -swingRadius * Math.cos(state.bank);
    const along = -down * Math.sin(state.pitch);
    out[0] = side * Math.cos(state.heading) + along * Math.sin(state.heading);
    out[1] = down * Math.cos(state.pitch);
    out[2] = side * Math.sin(state.heading) - along * Math.cos(state.heading);
  }

  function integrate(dt, input) {
    const x0 = state.x,
      y0 = state.y,
      z0 = state.z;
    harnessOffset(harnessBefore);
    const previousBankRate = bankVelocity;
    const right = unit(input.right),
      left = unit(input.left);
    state.left = approach(state.left, left, 6.5, dt);
    state.right = approach(state.right, right, 6.5, dt);
    state.trim = approach(state.trim, unit(input.trim ?? state.trim), 2.6, dt);
    const symmetric = Math.min(state.left, state.right);
    const differential = state.right - state.left;
    state.weight = approach(
      state.weight,
      clamp(input.weight || 0, -1, 1),
      4,
      dt,
    );

    const referenceAngle = neutralAngle(state.trim);
    const speedRatio = state.speed / neutralSpeed(state.trim);
    const pressure = speedRatio ** 2;
    const brake = symmetric + 0.18 * Math.abs(differential);
    // Deep, sustained brake loses lift only once the wing has shed airspeed.
    const separation =
      unit((symmetric - 0.68) / 0.32) * unit((0.87 - speedRatio) / 0.21);
    const liftCoefficient = 1 + 1.04 * brake - 1.08 * separation;
    const wingLift = G * Math.cos(referenceAngle) * pressure * liftCoefficient;
    const drag =
      G *
      pressure *
      (-Math.sin(referenceAngle) * (1 + 0.8 * brake) +
        0.094 * symmetric ** 2 +
        0.038 * Math.abs(differential) +
        0.14 * separation);
    const speedRate = -G * Math.sin(state.pitch) - drag;
    state.loadFactor = wingLift / G;
    // Excess normal acceleration during a pull-out, in units of g. Weighting
    // by kinetic headroom keeps a trim-speed brake pulse from supplying energy.
    const normalSurplus = Math.max(
      0,
      state.loadFactor * Math.cos(state.canopyBank) - Math.cos(state.pitch),
    );
    const reserve = unit((speedRatio - 0.97) / 0.2);
    state.recoveryLoad = approach(
      state.recoveryLoad,
      Math.min(1.6, normalSurplus) * reserve,
      normalSurplus * reserve > state.recoveryLoad ? 4.5 : 1.1,
      dt,
    );
    updateBank(dt, differential, symmetric, pressure);
    const verticalLift = wingLift * Math.cos(state.canopyBank);
    // Pitch damping represents the canopy–pilot recovery arc. Lift redirects
    // velocity and drag dissipates it; a flare never adds kinetic energy.
    const pitchRate =
      (verticalLift - G * Math.cos(state.pitch)) / state.speed -
      (0.27 - 0.09 * state.trim) * (state.pitch - referenceAngle);
    state.pitch = clamp(state.pitch + pitchRate * dt, -1.39, 0.76);
    // Work used to build rotation also comes out of the translational
    // energy budget. Aerodynamic damping dissipates it during rollout.
    const angularWork =
      1.35 * Math.max(0, bankVelocity ** 2 - previousBankRate ** 2);
    const availableSpeed = Math.max(6.5, state.speed + speedRate * dt);
    state.speed = Math.sqrt(
      Math.max(6.5 ** 2, Math.min(55 ** 2, availableSpeed ** 2 - angularWork)),
    );
    state.pitchRate = pitchRate;
    // Chord attitude includes incidence. Pitch above is the velocity angle.
    state.canopyPitch = state.pitch + 0.15 - 0.08 * state.trim + 0.14 * brake;
    const horizontalSpeed = state.speed * Math.cos(state.pitch);
    const headingChange =
      ((wingLift * Math.sin(state.canopyBank)) / Math.max(7, horizontalSpeed)) *
      dt;
    state.heading += headingChange;
    harnessOffset(harnessAfter);
    state.x +=
      Math.sin(state.heading) * horizontalSpeed * dt +
      harnessAfter[0] -
      harnessBefore[0];
    state.z +=
      -Math.cos(state.heading) * horizontalSpeed * dt +
      harnessAfter[2] -
      harnessBefore[2];
    state.y +=
      state.speed * Math.sin(state.pitch) * dt +
      harnessAfter[1] -
      harnessBefore[1];
    state.climb = (state.y - y0) / dt;
    trackManeuvers(headingChange);
    const horizontalDistance = Math.hypot(state.x - x0, state.z - z0);
    state.distance += horizontalDistance;
    state.time += dt;
    const ground = world.height(state.x, state.z);
    const previousAgl = state.agl;
    state.agl = state.y - ground;
    state.proximityDistance +=
      horizontalDistance * fractionNearGround(previousAgl, state.agl);

    const gate = state.style === "line" && gates[state.nextGate];
    if (gate && z0 >= gate.z && state.z <= gate.z && state.z < z0) {
      const t = (gate.z - z0) / (state.z - z0);
      const dx = x0 + (state.x - x0) * t - gate.x;
      const dy = y0 + (state.y - y0) * t - gate.y;
      if (dx * dx + dy * dy <= gate.radius ** 2) state.passed++;
      else state.missed++;
      state.nextGate++;
    }
    // The fabric, particularly a low wingtip in a carving turn, may strike
    // before the pilot's harness. Sample the short span on each physics step.
    const impact = world.hitsObstacle?.(state.x, state.y, state.z)
      ? "obstacle"
      : canopyImpact();
    if (impact) {
      state.status = "crashed";
      state.impact = impact;
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
