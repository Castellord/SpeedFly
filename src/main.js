import "./style.css";
import { createScene } from "./scene.js";
import { icons, createMap, drawCompass } from "./instruments.js";
import { createSound } from "./audio.js";

const $ = (id) => document.getElementById(id);
icons();
const segments = Array.from({ length: 12 }, () =>
  $("segments").appendChild(document.createElement("b")),
);
const panel = $("panel"),
  sound = createSound(),
  formatter = new Intl.NumberFormat("ru-RU");
const keys = new Set(),
  touches = new Set(),
  clock = (n) =>
    String(Math.floor(n / 60)).padStart(2, "0") +
    ":" +
    String(Math.floor(n % 60)).padStart(2, "0");
const lineNames = [
  "Северный кулуар",
  "Гребень ветра",
  "Тихая седловина",
  "Каменный цирк",
  "Хребет туманов",
  "Долина елей",
  "Западный отрог",
  "Ледовый перевал",
  "Скальный коридор",
];
const firstSeed = 1847;
let style = "line";
let showGlide = true;
try {
  showGlide = localStorage.getItem("ridgeline.glide") !== "off";
} catch {}
function glideButton() {
  $("glide").setAttribute("aria-pressed", String(showGlide));
}
function toggleGlide() {
  showGlide = !showGlide;
  glideButton();
  try {
    localStorage.setItem("ridgeline.glide", showGlide ? "on" : "off");
  } catch {}
}
glideButton();
$("glide").onclick = toggleGlide;
let seed = firstSeed,
  number = 1,
  title = lineNames[0],
  mode = "loading",
  cam = 1,
  targetTrim = 0.5;
let scene,
  flight,
  world,
  drawMap,
  rafTime = 0,
  simTime = 0,
  hudTime = -1,
  toastTimer,
  resumeOnClose = false,
  saved = false,
  snap = true,
  regenerating = false;
function readRecords() {
  try {
    const v = JSON.parse(localStorage.getItem("ridgeline.flights.v1") || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveRun(status) {
  if (saved || flight.state.time < 0.3) return;
  saved = true;
  const s = flight.state,
    record = {
      seed,
      number,
      title,
      style,
      time: s.time,
      passed: s.passed,
      proximityDistance: Math.round(s.proximityDistance),
      total: flight.gates.length,
      rolls: s.rolls,
      spirals: s.spirals,
      status,
      date: Date.now(),
    };
  try {
    localStorage.setItem(
      "ridgeline.flights.v1",
      JSON.stringify([record, ...readRecords()].slice(0, 40)),
    );
  } catch {
    notify("Журнал недоступен в этом браузере");
  }
}
function notify(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1800);
}
function clearInputs() {
  keys.clear();
  touches.clear();
  document
    .querySelectorAll(".pressed")
    .forEach((el) => el.classList.remove("pressed"));
}
function setMode(next) {
  mode = next;
  document.body.dataset.mode = next;
  const airborne = next === "flying" || next === "paused";
  $("brief").hidden = next !== "preview";
  $("flyingStatus").hidden = !airborne;
  document.querySelector(".flight-buttons").hidden = !airborne;
  document.querySelector(".touch").hidden = next !== "flying";
  $("ready").textContent = {
    preview: "Готов к полёту",
    flying: "В полёте",
    paused: "Пауза",
    result: "Полёт завершён",
    loading: "Генерация линии",
  }[next];
  $("camLabel").textContent =
    next === "preview"
      ? "Обзор линии"
      : cam === 1
        ? "От первого лица"
        : "За пилотом";
  if (next !== "flying") clearInputs();
}
const nextPaint = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );

function loadingStage(label, step) {
  $("loadStage").textContent = label;
  $("loadProgress").value = step;
  $("loadStep").textContent = step + " / 4";
}

async function generated(newSeed, newNumber) {
  setMode("loading");
  $("loading").hidden = false;
  $("retryLoad").hidden = true;
  loadingStage("Построение рельефа", 1);
  await nextPaint();
  seed = newSeed;
  number = newNumber;
  title =
    seed === firstSeed
      ? lineNames[0]
      : lineNames[1 + (seed % (lineNames.length - 1))];
  const line = scene.generate(seed);
  ({ world, flight } = line);
  loadingStage("Загрузка моделей и текстур", 2);
  await Promise.all([
    line.ready,
    document.fonts.load("600 16px Oswald"),
    document.fonts.load("500 16px Manrope"),
    document.fonts.load("italic 800 16px Barlow"),
  ]);
  loadingStage("Подготовка графики", 3);
  await nextPaint();
  await scene.warmup();
  loadingStage("Подготовка приборов", 4);
  await nextPaint();
  drawMap = createMap($("map"), world, flight.gates);
  const g = flight.gates;
  let dist = 0,
    x = flight.state.x,
    z = 0;
  for (const p of g) {
    dist += Math.hypot(p.x - x, p.z - z);
    x = p.x;
    z = p.z;
  }
  const km = (dist / 1000).toFixed(1).replace(".", ",");
  $("length").textContent = km;
  $("maplength").textContent = km + " км";
  $("drop").textContent = formatter.format(
    Math.round(world.height(world.center(0), 0) - world.height(x, z)),
  );
  $("gatesCount").textContent = g.length;
  $("routeName").textContent = title;
  $("lineNo").textContent = "ЛИНИЯ " + String(number).padStart(3, "0");
  configureStart();
  saved = false;
  snap = true;
  simTime = 0;
  setMode("preview");
  updateHUD();
  $("loading").hidden = true;
}
function configureStart() {
  flight.reset(style);
  targetTrim = flight.state.trim;
  const free = style === "free";
  $("turnReadout").hidden = !free;
  $("gatesCount").textContent = free
    ? Math.round(flight.state.agl)
    : flight.gates.length;
  $("courseUnit").textContent = free ? "м над склоном" : "ворот";
  $("courseIcon").dataset.i = free ? "descent" : "gate";
  icons($("courseIcon").parentElement);
  $("goalLabel").textContent = free ? "Свободный полёт" : "Следующие ворота";
}
$("flightStyle").onchange = (e) => {
  if (mode === "preview") {
    style = e.target.value;
    configureStart();
    snap = true;
    updateHUD();
  }
};
function launch() {
  if (!flight || regenerating || mode === "loading") return;
  if (panel.open) closePanel(false);
  configureStart();
  saved = false;
  simTime = 0;
  snap = true;
  sound.resume().catch(() => {});
  clearInputs();
  setMode("flying");
  updateHUD();
  if (document.activeElement instanceof HTMLElement)
    document.activeElement.blur();
}
async function newLine() {
  if (regenerating) return;
  regenerating = true;
  try {
    if (panel.open) closePanel(false);
    let next = crypto.getRandomValues(new Uint32Array(1))[0];
    if (next % (lineNames.length - 1) === seed % (lineNames.length - 1))
      next = (next + 1) >>> 0;
    await generated(next, number + 1);
  } catch (error) {
    showError(error);
  } finally {
    regenerating = false;
  }
}
function returnPreview() {
  closePanel(false);
  saveRun("interrupted");
  configureStart();
  snap = true;
  setMode("preview");
  updateHUD();
}
function updateHUD() {
  const s = flight.state;
  $("speed").textContent = Math.round(s.speed * 3.6);
  $("alt").textContent = Math.round(s.agl);
  $("vario").textContent =
    (s.climb > 0 ? "+" : "") +
    s.climb.toFixed(1).replace("-", "−").replace(".", ",");
  $("trimVal").textContent = Math.round(s.trim * 100) + "%";
  segments.forEach((el, i) =>
    el.classList.toggle("on", i < Math.round(s.trim * segments.length)),
  );
  $("leftMeter").value = s.left;
  $("rightMeter").value = s.right;
  drawMap(s);
  drawCompass($("compass"), s.heading);
  const gate = flight.gates[s.nextGate];
  $("goal").textContent = gate
    ? String(s.nextGate + 1).padStart(2, "0") +
      " / " +
      flight.gates.length +
      " · " +
      Math.round(Math.hypot(gate.x - s.x, gate.y - s.y, gate.z - s.z)) +
      " м"
    : "Финиш";
  if (style === "free") {
    const bank = Math.atan2(Math.sin(s.bank), Math.cos(s.bank));
    $("bankAngle").textContent = Math.round((bank * 180) / Math.PI) + "°";
    $("turnRate").textContent =
      Math.round(((s.headingRate ?? 0) * 180) / Math.PI) + "°/с";
    $("goal").textContent =
      s.flowSeparation > 0.55
        ? "Глубокое торможение"
        : s.inSpiral
          ? "Нисходящая спираль"
          : Math.cos(s.canopyBank) < -0.2
            ? "Купол ниже пилота"
            : s.recoveryLoad > 0.32
              ? "Выход из снижения"
              : (s.distance / 1000).toFixed(2).replace(".", ",") + " км";
  }
  $("passed").textContent =
    style === "free"
      ? "Витки · " + s.spirals + "　Бочки · " + s.rolls
      : s.passed + " / " + flight.gates.length + " пройдено";
  $("clock").textContent = clock(s.time);
  $("lowDistance").textContent =
    formatter.format(Math.round(s.proximityDistance ?? 0)) + " м";
}
function showPanel(content, kind) {
  if (!panel.open) {
    resumeOnClose = mode === "flying";
    if (resumeOnClose) setMode("paused");
  }
  $("panelBody").innerHTML = content;
  panel.dataset.kind = kind;
  panel.setAttribute(
    "aria-label",
    $("panelBody").querySelector("h2")?.textContent || "Меню",
  );
  if (!panel.open) panel.showModal();
  $("logTab").classList.toggle("active", kind === "log");
  $("flightTab").classList.toggle("active", kind !== "log");
}
function closePanel(resume = true) {
  panel.close();
  $("logTab").classList.remove("active");
  $("flightTab").classList.add("active");
  if (resume && resumeOnClose && mode === "paused") {
    setMode("flying");
    snap = true;
  }
  resumeOnClose = false;
}
function guide() {
  showPanel(
    "<h2>Управление крылом</h2><p>На проксимити-линии центры ворот находятся в 8–11 м над склоном. Оранжевые флажки показывают коридор между воротами. Счётчик «Ниже 15 м» измеряет пройденное у склона расстояние. В режиме «Свободный полёт» старт выше, на 350 м над склоном — есть запас высоты для бочек и спиралей. Следи за высотой над склоном и скоростью снижения.</p>" +
      [
        ["<kbd>A</kbd> / <kbd>S</kbd>", "Левая клеванта: резко / плавно"],
        ["<kbd>F</kbd> / <kbd>G</kbd>", "Правая клеванта: плавно / резко"],
        ["<kbd>Пробел</kbd>", "Обе клеванты одновременно"],
        ["<kbd>Q</kbd> / <kbd>E</kbd>", "Перенос веса влево / вправо"],
        ["<kbd>↑</kbd> / <kbd>↓</kbd>", "Открыть / закрыть триммеры"],
        [
          "<kbd>H</kbd>",
          "Прогноз глайда на 8 с. Зелёный — свободный путь, янтарный — низко или мимо ворот, красный — касание",
        ],
        ["<kbd>C</kbd> / <kbd>Esc</kbd>", "Смена камеры / пауза"],
      ]
        .map(
          ([k, v]) =>
            '<div class="entry"><span>' + k + "</span><b>" + v + "</b></div>",
        )
        .join("") +
      "<h3>Крен и энергия</h3><p>В свободном полёте удерживай F для плавного входа в правую спираль. Чтобы перейти в бочку в ту же сторону, добавь G и E. Для левой спирали используй S, для перехода — A и Q. Резкая затяжка с весом работает и из прямого полёта. Такой вход расходует больше высоты и воздушной скорости, чем вход после выравнивания разогнанного крыла.</p><p>Чтобы сравнить перекладки, подержи F пять секунд. Затем отпусти F и в одном полёте зажми A, в другом — S. Приборы «Крен» и «Разворот» показывают наклон подвески и скорость изменения курса. При отпускании крыло ещё доворачивает.</p><p>Обе клеванты вместе на скорости сначала уменьшают снижение. Если долго держать их внизу, скорость падает и снижение усиливается. После отпускания крыло клюёт и разгоняется.</p>",
    "help",
  );
}
function journal() {
  const records = readRecords().filter(
    (r) => r && lineNames.includes(r.title) && Number.isFinite(r.time),
  );
  let html = "<h2>Журнал полётов</h2>";
  if (!records.length)
    html +=
      "<p>Здесь появятся пройденные линии, время полёта и результат по воротам. Первый полёт уже готов к старту.</p>";
  for (const r of records) {
    const label =
      {
        finished: "Финиш",
        landed: "Посадка",
        crashed: "Столкновение",
        interrupted: "Прерван",
      }[r.status] || "Завершён";
    html +=
      '<div class="entry"><span class="record"><b>' +
      r.title +
      "</b><small>" +
      label +
      " · " +
      clock(r.time) +
      (Number.isFinite(r.proximityDistance)
        ? " · у склона " + formatter.format(r.proximityDistance) + " м"
        : "") +
      "</small></span><span>" +
      (r.style === "free"
        ? (Number.isFinite(r.spirals) ? "Витки · " + r.spirals + "　" : "") +
          "Бочки · " +
          Number(r.rolls)
        : Number(r.passed) + " / " + Number(r.total) + " ворот") +
      "</span></div>";
  }
  showPanel(html, "log");
}
function pause() {
  if (mode !== "flying") return;
  showPanel(
    "<h2>Полёт на паузе</h2><p>" +
      title +
      " · " +
      clock(flight.state.time) +
      '</p><div class="dialog-actions"><button class="primary" data-act="resume">Продолжить</button><button class="secondary" data-act="retry">Со старта</button><button class="secondary" data-act="exit">К линии</button></div>',
    "pause",
  );
}
function finish() {
  const s = flight.state;
  saveRun(s.status);
  setMode("result");
  showPanel(
    "<h2>" +
      (s.status === "finished"
        ? "Линия пройдена"
        : s.status === "landed"
          ? "Мягкая посадка"
          : s.impact === "obstacle"
            ? "Столкновение с препятствием"
            : "Касание рельефа") +
      "</h2><p>" +
      title +
      "</p>" +
      [
        ["Время", clock(s.time)],
        style === "free"
          ? ["Режим", "Свободный полёт"]
          : ["Пройдено ворот", s.passed + " / " + flight.gates.length],
        ["Дистанция", (s.distance / 1000).toFixed(2).replace(".", ",") + " км"],
        [
          "Ниже 15 м над склоном",
          formatter.format(Math.round(s.proximityDistance)) + " м",
        ],
        ["Витки спирали", s.spirals],
        ["Бочки", s.rolls],
      ]
        .map(
          ([k, v]) =>
            '<div class="entry"><span>' + k + "</span><b>" + v + "</b></div>",
        )
        .join("") +
      '<div class="dialog-actions"><button class="primary" data-act="retry">Повторить полёт</button><button class="secondary" data-act="new">Новая линия</button></div>',
    "result",
  );
}
function dismiss() {
  if (mode === "result") {
    returnPreview();
    return;
  }
  closePanel();
}
panel.addEventListener("cancel", (event) => {
  event.preventDefault();
  dismiss();
});
panel.addEventListener("click", (e) => {
  if (e.target === panel) {
    const r = panel.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dismiss();
    return;
  }
  const action = e.target.closest("[data-act]")?.dataset.act;
  if (action === "resume") closePanel();
  if (action === "retry") {
    saveRun("interrupted");
    launch();
  }
  if (action === "new") newLine();
  if (action === "exit") returnPreview();
});
$("closePanel").onclick = dismiss;
$("launch").onclick = launch;
$("newLine").onclick = newLine;
$("help").onclick = guide;
$("logTab").onclick = journal;
$("flightTab").onclick = () => {
  if (panel.open) dismiss();
};
$("pause").onclick = pause;
function camera() {
  if (mode === "flying") {
    cam = 1 - cam;
    snap = true;
    setMode("flying");
  }
}
$("changeCam").onclick = camera;
function syncSoundButton() {
  const on = sound.enabled;
  const button = $("sound");
  button.firstElementChild.dataset.i = on ? "sound" : "mute";
  icons(button);
  const label = on ? "Выключить звук" : "Включить звук";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(on));
}
syncSoundButton();
$("sound").onclick = async () => {
  try {
    const on = await sound.toggle();
    syncSoundButton();
    notify(on ? "Звук включён" : "Звук выключен");
  } catch {
    notify("Звук недоступен");
  }
};
$("full").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    notify("Полный экран недоступен");
  }
};
document.addEventListener("fullscreenchange", () => {
  const name = document.fullscreenElement
    ? "Выйти из полного экрана"
    : "На весь экран";
  $("full").title = name;
  $("full").setAttribute("aria-label", name);
});
const held = (codes) => codes.some((k) => keys.has(k));
function trimBy(amount) {
  targetTrim = Math.max(0, Math.min(1, targetTrim + amount));
}
window.addEventListener("keydown", (e) => {
  if (e.altKey || e.metaKey || e.ctrlKey) return;
  if (panel.open) return;
  if (e.code === "Slash" && !e.repeat) {
    guide();
    return;
  }
  if (
    mode === "preview" &&
    e.code === "Enter" &&
    !(document.activeElement instanceof HTMLButtonElement)
  ) {
    launch();
    return;
  }
  if (mode !== "flying") return;
  if (
    [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Space",
      "Escape",
    ].includes(e.code)
  )
    e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === "Escape" || e.code === "KeyP") pause();
  if (e.code === "KeyC") camera();
  if (e.code === "KeyH") toggleGlide();
  if (e.code === "KeyW" || e.code === "ArrowUp") trimBy(0.05);
  if (e.code === "ArrowDown") trimBy(-0.05);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  clearInputs();
  if (mode === "flying") pause();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInputs();
    if (mode === "flying") pause();
  }
  rafTime = 0;
});
document.querySelectorAll("[data-control]").forEach((el) => {
  const release = () => {
    touches.delete(el.dataset.control);
    el.classList.remove("pressed");
  };
  el.onpointerdown = (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    touches.add(el.dataset.control);
    el.classList.add("pressed");
  };
  el.onpointerup = el.onpointercancel = el.onlostpointercapture = release;
});
$("touchTrimDown").onclick = () => trimBy(-0.1);
$("touchTrimUp").onclick = () => trimBy(0.1);
function showError(err) {
  console.error(err);
  $("loading").hidden = false;
  $("loadStage").textContent = scene
    ? "Не удалось подготовить линию. Проверь соединение и попробуй ещё раз."
    : "Для полёта требуется WebGL 2. Проверь аппаратное ускорение браузера.";
  $("loadStep").textContent = "";
  $("loadProgress").hidden = true;
  $("retryLoad").hidden = false;
  $("brief").hidden = true;
}
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
function frame(now) {
  const idle = mode !== "flying";
  const interval = idle
    ? mode === "preview" && !reducedMotion.matches
      ? 1000 / 30
      : 1000 / 12
    : 0;
  if (rafTime && now - rafTime < interval) {
    requestAnimationFrame(frame);
    return;
  }
  const dt = rafTime ? Math.max(0, (now - rafTime) / 1000) : 0;
  rafTime = now;
  if (flight && mode !== "loading" && !document.hidden) {
    if (mode === "flying") {
      const s = flight.state,
        old = s.nextGate,
        pass = s.passed,
        roll = s.rolls;
      const up = held(["KeyW", "ArrowUp"]),
        down = keys.has("ArrowDown");
      trimBy((Number(up) - Number(down)) * 0.4 * Math.min(dt, 0.2));
      const fastLeft = held(["KeyA", "Space"]) || touches.has("fastLeft");
      const fastRight = held(["KeyG", "Space"]) || touches.has("fastRight");
      flight.step(dt, {
        left: Number(
          fastLeft || held(["KeyS", "ArrowLeft"]) || touches.has("left"),
        ),
        right: Number(
          fastRight ||
            held(["KeyF", "KeyD", "ArrowRight"]) ||
            touches.has("right"),
        ),
        fastLeft,
        fastRight,
        weight:
          Number(touches.has("leanRight") || keys.has("KeyE")) -
          Number(touches.has("leanLeft") || keys.has("KeyQ")),
        trim: targetTrim,
      });
      if (s.status !== "flying") finish();
      else if (old !== s.nextGate) {
        if (s.passed > pass) sound.gate();
        notify(s.passed > pass ? "Ворота пройдены" : "Пропуск ворот");
      } else if (s.rolls > roll) notify("Бочка · 360°");
      simTime = s.time;
    } else if (mode === "preview" && !reducedMotion.matches)
      simTime += Math.min(dt, 0.1);
    scene.draw({
      mode,
      cameraMode: cam,
      showGlide,
      t: simTime,
      dt: Math.min(dt, 0.2),
      snap,
    });
    snap = false;
    if (now - hudTime > 95) {
      updateHUD();
      hudTime = now;
    }
    sound.update(
      flight.state,
      mode === "flying",
      mode === "flying" && sound.enabled ? world.passSound(flight.state) : null,
    );
  }
  requestAnimationFrame(frame);
}
$("retryLoad").onclick = () => location.reload();
requestAnimationFrame(async () => {
  try {
    scene = createScene($("scene"));
    await generated(firstSeed, 1);
    requestAnimationFrame(frame);
  } catch (err) {
    showError(err);
  }
});
