// Run with node scripts/maneuvers.mjs. Inputs and state use the production integrator.
import { pathToFileURL } from "node:url";
import { createFlight } from "../src/flight.js";

const deg = (angle) => (angle * 180) / Math.PI;
const right = { right: 1 },
  left = { left: 1 };
const sharpRight = { ...right, fastRight: true };
const sharpLeft = { ...left, fastLeft: true };
const both = { right: 1, left: 1 };
const sharpBoth = { ...both, fastRight: true, fastLeft: true };

const turn = [[5, right]];
const sharpTurn = [[5, sharpRight]];

// Setup runs to completion before measurement. Every pair is [seconds, controls].
// Releasing the original side and selecting the opposite side share one simulation tick.
const scenarios = [
  { label: "Без клевант", phases: [[8, {}]] },
  { label: "Плавно вправо, держать", phases: [[12, right]] },
  { label: "Резко вправо, держать", phases: [[12, sharpRight]] },
  {
    label: "Резко вправо с весом",
    phases: [[12, { ...sharpRight, weight: 1 }]],
  },
  { label: "Плавно вправо → отпустить", setup: turn, phases: [[5, {}]] },
  { label: "Резко вправо → отпустить", setup: sharpTurn, phases: [[5, {}]] },
  {
    label: "Плавно вправо → резко влево",
    setup: turn,
    phases: [[4, sharpLeft]],
  },
  { label: "Плавно вправо → плавно влево", setup: turn, phases: [[4, left]] },
  {
    label: "Резко вправо → резко влево",
    setup: sharpTurn,
    phases: [[4, sharpLeft]],
  },
  {
    label: "Резко вправо → плавно влево",
    setup: sharpTurn,
    phases: [[4, left]],
  },
  { label: "Обе плавно, держать", phases: [[8, both]] },
  { label: "Обе резко, держать", phases: [[8, sharpBoth]] },
  {
    label: "Обе резко 0,5 с → отпустить",
    setup: [[0.5, sharpBoth]],
    phases: [[1, {}]],
  },
  {
    label: "Обе резко 8 с → отпустить",
    setup: [[8, sharpBoth]],
    phases: [[1, {}]],
  },
  {
    label: "Обе резко 8 с → восстановление",
    setup: [[8, sharpBoth]],
    phases: [[6, {}]],
  },
  { label: "Плавно вправо → обе резко", setup: turn, phases: [[3, sharpBoth]] },
];

// Sample at exact phase boundaries even when a phase lasts a fraction of a video frame.
export function measureManeuver({ setup = [], phases }, fps = 120) {
  const flight = createFlight({ center: () => 0, height: () => 0 });
  const state = flight.reset("free");
  state.y = state.agl = 2000;
  function advance(stages, onFrame) {
    for (const [seconds, input] of stages) {
      const frames = Math.ceil(seconds * fps);
      for (let frame = 0; frame < frames; frame++) {
        const dt = Math.min(1 / fps, seconds - frame / fps);
        flight.step(dt, input);
        if (state.status !== "flying")
          throw new Error("Flight ended during measurement");
        onFrame?.();
      }
    }
  }
  advance(setup);
  const start = { ...state };
  let peakRollRate = 0,
    lowestSpeed = state.speed,
    bestClimb = state.climb;
  let inverted = false;
  advance(phases, () => {
    peakRollRate = Math.max(peakRollRate, Math.abs(deg(state.bankRate)));
    lowestSpeed = Math.min(lowestSpeed, state.speed);
    bestClimb = Math.max(bestClimb, state.climb);
    if (Math.cos(state.canopyBank) * Math.cos(state.canopyPitch) < -0.2)
      inverted = true;
  });
  return {
    duration: state.time - start.time,
    heightLoss: start.y - state.y,
    speed: state.speed,
    lowestSpeed,
    bestClimb,
    energyLossPerKg:
      9.81 * (start.y - state.y) + (start.speed ** 2 - state.speed ** 2) / 2,
    climb: state.climb,
    headingChange: deg(state.heading - start.heading),
    noseToCourse: deg(state.canopyHeading - state.heading),
    bank: deg(Math.atan2(Math.sin(state.bank), Math.cos(state.bank))),
    peakRollRate,
    inverted,
    rolls: state.rolls - start.rolls,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(
    "Штиль, трим 50%, высота старта 2000 м. Для перекладок исходную клеванту держим 5 с. Показатели отсчитываются с начала указанного действия после стрелки.",
  );
  console.table(
    scenarios.map((scenario) => {
      const m = measureManeuver(scenario);
      return {
        Управление: scenario.label,
        с: +m.duration.toFixed(1),
        "Потеря, м": +m.heightLoss.toFixed(1),
        "Скорость, км/ч": Math.round(m.speed * 3.6),
        "Vмин, км/ч": Math.round(m.lowestSpeed * 3.6),
        "Vверт, м/с": +m.climb.toFixed(1),
        "Крен, °": Math.round(m.bank),
        "Δкурс, °": Math.round(m.headingChange),
        "Макс. |ω|, °/с": Math.round(m.peakRollRate),
        Бочки: m.rolls,
      };
    }),
  );
}
