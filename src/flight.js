// Point-mass flight under a banked lifting wing. Distances are metres, angles radians.
const G = 9.81;
const TAU = 2 * Math.PI;
const slowBrakeRate = 1.15;
const fastBrakeRate = 6;
const physicsTick = 1 / 240;
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
  // The separate Mac game still supplies a scored gate course.
  const openLine = Number.isFinite(world.finishZ);
  const gates = openLine ? [] : makeCourse(world, seed);
  const finishZ = world.finishZ ?? gates.at(-1).z;
  let state = {};
  const forecastState = {};
  let remainingTime = 0;
  let lastInput = {};

  function reset(style = "line") {
    remainingTime = 0;
    lastInput = {};
    const first = openLine ? { x: world.center(-35), z: -35 } : gates[0];
    const x = world.center(0);
    const ground = world.height(x, 0);
    const heading = Math.atan2(first.x - x, -first.z);
    const y = ground + (style === "free" ? 350 : 11);
    // An airborne start is already established on the first leg's glide angle.
    // From here on the pilot alone determines height, speed and direction.
    const initialSlope = openLine
      ? glideSlope(1)
      : (y - first.y) / Math.hypot(first.x - x, first.z);
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
      canopyHeading: heading,
      canopyYawRate: 0,
      sideslip: 0,
      headingRate: 0,
      leftSeparation: 0,
      rightSeparation: 0,
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
      pitchSwing: 0,
      pitchSwingRate: 0,
      flowSeparation: 0,
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
    state.bankVelocity = 0;
    state.lastUpright = 0;
    state.invertedSide = 0;
    state.rollImpulse = 0;
    state.carvePressure = 0;
    state.pullEffort = 0;
    state.settledSteering = 0;
    state.canopyDeflection = 0;
    state.deflectionRate = 0;
    state.spiralArc = 0;
    state.spiralDirection = 0;
    return state;
  }

  // The local airspeed at either half-span differs during a turn. An inside
  // brake increases camber and drag locally; a faster outer half can produce
  // more lift. Both effects matter on release and on a reversal.
  function sectionSeparation(travel, speedRatio, previous, dt) {
    const deep = unit((travel - 0.72) / 0.28);
    const onset = 0.82 + 0.1 * previous;
    const target = Math.max(
      state.flowSeparation,
      deep * unit((onset - speedRatio) / 0.15),
    );
    return approach(previous, target, target > previous ? 3.0 : 1.8, dt);
  }
  function updateBank(dt, differential, brake, pressure) {
    const yawAcrossSpan =
      state.canopyYawRate * Math.cos(state.canopyBank) * Math.cos(state.pitch);
    const spanSpeedRatio = clamp(
      (2.1 * yawAcrossSpan) / state.speed,
      -0.45,
      0.45,
    );
    const leftPressure = (1 + spanSpeedRatio) ** 2;
    const rightPressure = (1 - spanSpeedRatio) ** 2;
    state.leftSeparation = sectionSeparation(
      state.left,
      Math.sqrt(leftPressure * pressure),
      state.leftSeparation,
      dt,
    );
    state.rightSeparation = sectionSeparation(
      state.right,
      Math.sqrt(rightPressure * pressure),
      state.rightSeparation,
      dt,
    );
    const leftDrag =
      leftPressure *
      (0.13 +
        0.2 * state.left +
        0.2 * state.left ** 2 +
        0.3 * state.leftSeparation);
    const rightDrag =
      rightPressure *
      (0.13 +
        0.2 * state.right +
        0.2 * state.right ** 2 +
        0.3 * state.rightSeparation);
    const dragImbalance = rightDrag - leftDrag;
    const liftImbalance =
      leftPressure * (1 + 0.13 * state.left - 0.7 * state.leftSeparation) -
      rightPressure * (1 + 0.13 * state.right - 0.7 * state.rightSeparation);
    // The canopy responds first. The suspended mass follows as the lines
    // transmit the lateral component of the aerodynamic force.
    const steering =
      (0.88 * differential + 0.3 * dragImbalance + 0.2 * liftImbalance) *
      (0.19 + 0.14 * Math.min(pressure, 2)) *
      Math.min(1, pressure / 0.75);
    state.deflectionRate +=
      (38 * (steering - state.canopyDeflection) - 12.5 * state.deflectionRate) *
      dt;
    state.canopyDeflection += state.deflectionRate * dt;
    const bank = state.bank;
    const drive = state.canopyDeflection / 0.33;
    const support = state.recoveryLoad / (0.54 + state.recoveryLoad);
    // Steady asymmetric drag produces a banked turn. In a loaded pull-out,
    // shifting the suspended mass and deflecting a half-wing gives more moment.
    const upright = Math.cos(bank);
    // A held inside hand keeps curving the existing turn even as the
    // harness passes over the wing. Gravity still acts in the world frame.
    const carve =
      drive *
      (0.58 * clamp(2.6 * Math.abs(upright), 0, 1) + 0.64 * Math.abs(upright));
    const shift = 0.12 * state.weight * upright;
    // A pull-out amplifies a new differential input. A held toggle does
    // not supply a fresh rolling impulse on every pass through upright.
    const command = differential + state.weight;
    const changing =
      Math.sign(command) *
      clamp(
        Math.sign(command) * (command - state.settledSteering),
        0,
        Math.abs(command),
      );
    state.settledSteering = approach(state.settledSteering, command, 0.85, dt);
    const transient =
      state.rollImpulse *
      Math.abs(differential) *
      Math.min(1, pressure / 0.7) *
      (0.75 + 0.25 * Math.min(pressure, 2));
    const moment = carve + shift + 3.05 * support * changing + transient;
    const settled =
      1 /
      (1 + 5 * Math.abs(state.rollImpulse) + 5 * support * Math.abs(changing));
    const damping =
      1.3 +
      6.5 * settled * Math.max(0, upright) * Math.abs(differential) +
      0.18 * Math.abs(state.bankVelocity) +
      0.58 * brake +
      0.62 * (1 - Math.min(1, Math.abs(drive) + Math.abs(state.weight))) ** 2;
    state.bankVelocity +=
      (5.8 * (moment - Math.sin(bank)) - damping * state.bankVelocity) * dt;
    state.bank += state.bankVelocity * dt;
    state.bankRate = state.bankVelocity;
    state.canopyBank = state.bank + 0.24 * state.canopyDeflection;
    return dragImbalance;
  }

  function trackManeuvers(headingChange) {
    // An orbit in heading and a complete roll about the flight path are
    // different windings. Returning through the same side cancels a wingover.
    const rotation = state.bank - state.lastUpright;
    const canopyAbovePilot =
      Math.cos(state.canopyBank) * Math.cos(state.canopyPitch);
    if (canopyAbovePilot < -0.2) state.invertedSide = Math.sign(rotation);
    if (Math.abs(rotation) < 0.25) state.invertedSide = 0;
    if (
      Math.abs(rotation) >= TAU - 0.12 &&
      Math.sign(rotation) === state.invertedSide &&
      canopyAbovePilot > 0
    ) {
      state.invertedSide = 0;
      state.lastUpright += Math.sign(rotation) * TAU;
      state.rolls++;
    }
    const angle = Math.abs(principalAngle(state.bank));
    const direction = Math.sign(headingChange);
    const turning = angle > 0.56 && angle < Math.PI / 2 && state.climb < -3;
    if (!turning || direction !== state.spiralDirection) {
      state.spiralArc = 0;
      state.inSpiral = false;
      state.spiralDirection = direction;
    }
    if (turning) state.spiralArc += Math.abs(headingChange);
    if (state.spiralArc >= Math.PI / 2) state.inSpiral = true;
    if (state.spiralArc >= TAU) {
      state.spirals++;
      state.spiralArc -= TAU;
    }
  }

  function canopyImpact() {
    const rollSin = Math.sin(state.canopyBank),
      rollCos = Math.cos(state.canopyBank);
    const pitchSin = Math.sin(state.canopyPitch),
      pitchCos = Math.cos(state.canopyPitch);
    const headingSin = Math.sin(state.canopyHeading),
      headingCos = Math.cos(state.canopyHeading);
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
    const side =
      -swingRadius * Math.sin(state.bank) * (1 - Math.cos(state.bank)) * 0.5;
    const down = -swingRadius * Math.cos(state.bank);
    const along = -down * Math.sin(state.pitch);
    out[0] = side * Math.cos(state.heading) + along * Math.sin(state.heading);
    out[1] = down * Math.cos(state.pitch);
    out[2] = side * Math.sin(state.heading) - along * Math.cos(state.heading);
  }

  function moveBrake(position, target, fast, dt) {
    if (target < position) return approach(position, target, 8, dt);
    return Math.min(
      target,
      position + (fast ? fastBrakeRate : slowBrakeRate) * dt,
    );
  }

  function rapidTravel(delta, dt) {
    return delta * (delta / (fastBrakeRate * dt)) ** 2;
  }

  function integrate(dt, input) {
    const x0 = state.x,
      y0 = state.y,
      z0 = state.z;
    harnessOffset(harnessBefore);
    const previousBankRate = state.bankVelocity;
    const right = unit(input.right),
      left = unit(input.left);
    const oldLeft = state.left,
      oldRight = state.right,
      oldWeight = state.weight;
    state.left = moveBrake(oldLeft, left, input.fastLeft, dt);
    state.right = moveBrake(oldRight, right, input.fastRight, dt);
    state.trim = approach(state.trim, unit(input.trim ?? state.trim), 2.6, dt);
    const symmetric = Math.min(state.left, state.right);
    const differential = state.right - state.left;
    state.weight = approach(
      state.weight,
      clamp(input.weight || 0, -1, 1),
      4,
      dt,
    );

    // Hand travel and the initial weight transfer load the inside half-wing.
    const rightTravel = Math.max(0, state.right - oldRight);
    const leftTravel = Math.max(0, state.left - oldLeft);
    // Rate-dependent loading grows continuously with hand velocity. A hand
    // cannot add tension while the released side pays out its brake line.
    const quickStroke =
      0.81 * (rapidTravel(rightTravel, dt) - rapidTravel(leftTravel, dt));
    const weightStep = state.weight - oldWeight;
    const insideTransfer =
      weightStep * Math.max(0, differential * Math.sign(weightStep));
    // With a tensioned line a sharper pull also changes force before there
    // is any further visible trailing-edge travel. Only increasing effort on
    // the loaded side contributes. Holding a key cannot regenerate the pulse.
    const effortTarget =
      (input.fastRight ? right : 0) - (input.fastLeft ? left : 0);
    const oldEffort = state.pullEffort;
    state.pullEffort = approach(
      oldEffort,
      effortTarget,
      effortTarget ? 26 : 2,
      dt,
    );
    const effortRise =
      Math.sign(effortTarget) *
      Math.max(0, Math.sign(effortTarget) * (state.pullEffort - oldEffort));
    const loadedTug =
      effortRise *
      Math.max(0, Math.sign(effortTarget) * (oldRight - oldLeft)) ** 3;
    const asymmetricStroke = quickStroke * Math.abs(right - left);
    // Resolve a new stroke along the angular motion already present. A
    // loaded carve has track curvature and little axial roll. An inverted
    // rolling wing retains axial momentum when the stroke rate changes.
    const turnRate = state.headingRate;
    const planeShare =
      turnRate ** 2 / (0.05 + turnRate ** 2 + state.bankRate ** 2);
    const insideEffort =
      Math.max(0, state.pullEffort * Math.sign(turnRate)) * planeShare;
    state.carvePressure = approach(state.carvePressure, insideEffort, 2.8, dt);
    // The outside hand has more leverage to unwind the existing bank.
    const outsideBrake = Math.max(0, -differential * Math.sign(turnRate));
    const rollShare = 1 - planeShare * (1 - 0.35 * outsideBrake);
    const handMoment = (asymmetricStroke + loadedTug) * rollShare;
    state.rollImpulse = clamp(
      state.rollImpulse * Math.exp(-1.3 * dt) +
        handMoment *
          (4.35 +
            1.8 * state.recoveryLoad +
            0.5 * Math.max(0, state.weight * Math.sign(handMoment))) +
        2.35 * insideTransfer * rollShare,
      -4.4 - state.recoveryLoad,
      4.4 + state.recoveryLoad,
    );

    const referenceAngle = neutralAngle(state.trim);
    const speedRatio = state.speed / neutralSpeed(state.trim);
    const pressure = speedRatio ** 2;
    const brake = symmetric + 0.18 * Math.abs(differential);
    // Extra profile drag slows the canopy ahead of the suspended mass.
    // Project the resulting swing into the chord attitude and lift slope.
    const brakeDrag =
      pressure *
      (-Math.sin(referenceAngle) * 0.8 * brake +
        0.094 * symmetric ** 2 +
        0.038 * Math.abs(differential));
    const swingTarget = 0.28 * Math.atan(brakeDrag);
    state.pitchSwingRate +=
      (8 * (swingTarget - state.pitchSwing) - 2.8 * state.pitchSwingRate) * dt;
    state.pitchSwing += state.pitchSwingRate * dt;

    // Attached flow persists at the start of a flare. At deep brake, loss
    // of airspeed and increased incidence bring on separation. Reattachment
    // takes time after the controls are released.
    const deepBrake = unit((symmetric - 0.66) / 0.34);
    const stallRatio =
      0.85 + 0.12 * state.flowSeparation + 0.28 * state.pitchSwing;
    const separatedTarget = deepBrake * unit((stallRatio - speedRatio) / 0.15);
    state.flowSeparation = approach(
      state.flowSeparation,
      separatedTarget,
      separatedTarget > state.flowSeparation ? 2.8 : 1.7,
      dt,
    );
    const separation = state.flowSeparation;
    // A stalled inside half also changes total force on the system. The
    // symmetric component is already included in the common flow state.
    const asymmetricLoss =
      0.5 * Math.abs(state.leftSeparation - state.rightSeparation);
    const liftCoefficient = Math.max(
      0.18,
      1 +
        1.04 * brake +
        1.35 * state.pitchSwing -
        1.55 * separation -
        0.7 * asymmetricLoss,
    );
    const turnLoading =
      Math.abs(differential) * Math.sin(state.canopyBank) ** 2;
    const wingLift =
      G *
      Math.cos(referenceAngle) *
      pressure *
      liftCoefficient *
      (1 + turnLoading * (0.3 + 0.36 * state.carvePressure));
    const drag =
      G *
      pressure *
      (-Math.sin(referenceAngle) * (1 + 0.8 * brake) +
        0.094 * symmetric ** 2 +
        0.038 * Math.abs(differential) +
        0.07 * turnLoading +
        0.12 * state.carvePressure +
        0.72 * separation +
        0.3 * asymmetricLoss);
    // A rolling half-wing sweeps across the airflow. Its induced drag is
    // greatest at high angular speed and low dynamic pressure.
    const rollDrag =
      (0.019 * (3.3 * state.bankVelocity) ** 2) /
      (Math.max(0.55, pressure) * (1 + 10 * state.recoveryLoad));
    const speedRate = -G * Math.sin(state.pitch) - drag - rollDrag;
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
    const dragImbalance = updateBank(dt, differential, symmetric, pressure);
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
      1.35 * Math.max(0, state.bankVelocity ** 2 - previousBankRate ** 2);
    const availableSpeed = Math.max(6.5, state.speed + speedRate * dt);
    state.speed = Math.sqrt(
      Math.max(6.5 ** 2, Math.min(55 ** 2, availableSpeed ** 2 - angularWork)),
    );
    state.pitchRate = pitchRate;
    // Chord attitude includes incidence. Pitch above is the velocity angle.
    state.canopyPitch =
      state.pitch + 0.15 - 0.08 * state.trim + 0.1 * brake + state.pitchSwing;
    const horizontalSpeed = state.speed * Math.cos(state.pitch);
    // The velocity turns under lateral lift. The nose also yaws under the
    // drag imbalance; relative airflow opposes the resulting sideslip. Bank
    // continues to change the track after a brake is released or reversed.
    const coordinatedRate =
      (wingLift * Math.sin(state.canopyBank)) / Math.max(7, horizontalSpeed);
    const sideforceRate = 0.48 * pressure * Math.sin(state.sideslip);
    state.headingRate = coordinatedRate + sideforceRate;
    const weathercock = 7.8 * pressure * Math.sin(state.sideslip);
    const yawDamping =
      4.2 * Math.sqrt(pressure) * (coordinatedRate - state.canopyYawRate);
    const brakeYaw =
      2.8 * pressure * dragImbalance * Math.cos(state.canopyBank);
    state.canopyYawRate += (brakeYaw + yawDamping - weathercock) * dt;
    state.sideslip += (state.canopyYawRate - state.headingRate) * dt;
    const headingChange = state.headingRate * dt;
    state.heading += headingChange;
    state.canopyHeading = state.heading + state.sideslip;
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
      state.z <= finishZ &&
      (openLine || state.style === "free" || state.nextGate === gates.length)
    ) {
      state.status = "finished";
    }
  }

  function step(dt, input = {}) {
    if (!(dt > 0) || !Number.isFinite(dt)) return state;
    lastInput = input;
    remainingTime += Math.min(dt, 0.25);
    const steps = Math.floor((remainingTime + 1e-12) / physicsTick);
    remainingTime = Math.max(0, remainingTime - steps * physicsTick);
    for (let i = 0; i < steps && state.status === "flying"; i++)
      integrate(physicsTick, input);
    return state;
  }

  // Run the same aerodynamic and collision code on a scratch state. A
  // coarser integration step keeps the optional sight inexpensive.
  function predictGlide(writePoint) {
    const live = state;
    state = Object.assign(forecastState, live);
    try {
      writePoint(state);
      for (let sample = 0; sample < 40 && state.status === "flying"; sample++) {
        for (let tick = 0; tick < 8 && state.status === "flying"; tick++)
          integrate(1 / 40, lastInput);
        writePoint(state);
      }
    } finally {
      state = live;
    }
  }

  reset();
  return { state, gates, step, reset, predictGlide };
}
