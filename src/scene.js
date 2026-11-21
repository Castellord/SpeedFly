import { createAirEffects } from "./air-effects.js";
import { flightTexture, texturesReady } from "./textures.js";
import * as THREE from "three";
import { createWorld } from "./world.js";
import { createWing, createCockpit } from "./wing.js";
import { createScannedRocks } from "./scanned-rocks.js";
import { createCourseMarkers } from "./course-markers.js";
import { createWingShadow } from "./wing-shadow.js";
import { createFlight } from "./flight.js";

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(55, 1, 0.15, 15500);
  scene.background = new THREE.Color(0xb9d0db);
  scene.fog = new THREE.Fog(0xb8cbd0, 1450, 10500);
  scene.backgroundRotation.y = 1.5;
  scene.add(new THREE.HemisphereLight(0xe0f0ff, 0xa49a7b, 1.65));
  const sun = new THREE.DirectionalLight(0xffe9c8, 2.1);
  sun.position.set(-0.64, 0.72, -0.26);
  scene.add(sun);
  const wing = createWing();
  scene.add(wing.group);
  const cockpit = createCockpit();
  camera.add(cockpit.group);
  scene.add(camera);
  const courseMarkers = createCourseMarkers(scene);
  const updateAir = createAirEffects(scene);
  const updateShadow = createWingShadow(scene, sun.position);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let scannedRocks,
    world,
    flight,
    ratio = 1,
    framerate = 0,
    lastW = 0,
    lastH = 0;
  const target = new THREE.Vector3(),
    eye = new THREE.Vector3(),
    up = new THREE.Vector3(),
    horizontal = new THREE.Vector3();
  const forward = new THREE.Vector3(),
    right = new THREE.Vector3(),
    origin = new THREE.Vector3();
  function generate(seed) {
    const sky = flightTexture("sky.jpg");
    sky.colorSpace = THREE.SRGBColorSpace;
    sky.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = sky;
    scannedRocks?.dispose();
    if (world) world.dispose();
    world = createWorld(scene, seed);
    const rocks = createScannedRocks(scene, world, seed);
    scannedRocks = rocks;
    const terrainObstacles = world.hitsObstacle;
    world.hitsObstacle = (x, y, z) =>
      terrainObstacles(x, y, z) || rocks.hits(x, y, z);
    flight = createFlight(world, seed);
    courseMarkers.generate(world, flight.gates);
    return {
      world,
      flight,
      ready: Promise.all([rocks.ready, texturesReady()]),
    };
  }
  function draw({ mode, cameraMode, t, dt, snap }) {
    const s = flight.state,
      preview = mode === "preview";
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (dt > 0 && mode === "flying") {
      framerate += (dt - framerate) * 0.022;
    }
    if (w !== lastW || h !== lastH) {
      lastW = w;
      lastH = h;
      ratio = Math.min(window.devicePixelRatio || 1, 1.65);
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (framerate > 0.037 && ratio > 0.8) {
      ratio = Math.max(0.8, ratio - 0.15);
      renderer.setPixelRatio(ratio);
      framerate = 0.023;
    }
    const dir = preview ? s.heading : (s.canopyHeading ?? s.heading),
      bank = preview ? -0.16 + 0.018 * Math.sin(t * 0.28) : s.bank;
    origin.set(s.x, s.y + (preview ? 0.16 * Math.sin(t * 0.65) : 0), s.z);
    forward.set(Math.sin(dir), 0, -Math.cos(dir));
    right.set(Math.cos(dir), 0, Math.sin(dir));
    wing.group.position.copy(origin);
    wing.group.rotation.order = "YXZ";
    wing.group.rotation.y = -dir;
    wing.group.rotation.x = preview
      ? -0.015
      : (s.canopyPitch ?? s.pitch * 0.56);
    wing.group.rotation.z = -bank;
    wing.update(
      s.left,
      s.right,
      s.trim,
      t,
      bank,
      preview ? 0 : (s.canopyBank ?? bank) - bank,
      preview ? 0 : s.weight,
    );
    wing.group.visible = cameraMode !== 1 || preview;
    cockpit.group.visible = !wing.group.visible;
    const speedFraction = THREE.MathUtils.smoothstep(s.speed, 14, 36);
    const targetFov = preview ? 55 : cameraMode === 1 ? 77 : 65;
    const widen =
      preview || reducedMotion.matches ? 0 : 8 * (speedFraction - 0.4);
    const fov = snap
      ? targetFov + widen
      : THREE.MathUtils.damp(camera.fov, targetFov + widen, 3.5, dt);
    if (Math.abs(fov - camera.fov) > 0.015) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (cockpit.group.visible)
      cockpit.update(s.left, s.right, s.trim, t, camera.aspect, camera.fov);
    courseMarkers.update(s, preview);
    updateShadow(world, s, wing.canopy);
    if (preview) {
      const portrait = w / h < 1.1;
      const sway = Math.sin(t * 0.095) * 0.6;
      eye
        .copy(origin)
        .addScaledVector(right, -0.9 + sway)
        .addScaledVector(forward, portrait ? -17 : -12);
      eye.y += portrait ? 4.1 : 3.45;
      target
        .copy(origin)
        .addScaledVector(right, portrait ? -0.55 : -3.8)
        .addScaledVector(forward, 1.4);
      target.y += portrait ? 0.3 : 1.65;
    } else if (cameraMode === 1) {
      eye.copy(origin).addScaledVector(forward, 0.28);
      // The helmet follows the harness, including when it is inverted.
      const gazePitch = THREE.MathUtils.clamp(
        s.pitch * 0.87 + s.pitchSwing * 0.55 - 0.055,
        -1.02,
        0.38,
      );
      up.copy(forward).multiplyScalar(-Math.sin(gazePitch));
      up.y = Math.cos(gazePitch);
      up.multiplyScalar(Math.cos(bank)).addScaledVector(right, Math.sin(bank));
      eye.addScaledVector(up, 0.67);
      // Eyes look forward through the turn. Flight-path angle determines how
      // much of the approaching surface is visible on a diving entry.
      target.copy(eye).addScaledVector(forward, 25);
      target.y += 25 * Math.tan(gazePitch);
      target.addScaledVector(
        right,
        reducedMotion.matches
          ? 0
          : THREE.MathUtils.clamp((s.bankRate ?? 0) * 0.38, -0.9, 0.9),
      );
    } else {
      eye.copy(origin).addScaledVector(forward, -10.5);
      eye.y += 3.8;
      eye.y = Math.max(eye.y, world.height(eye.x, eye.z) + 1.8);
      target.copy(origin).addScaledVector(forward, 11);
      target.y += 1.6 + s.climb * 0.22;
    }
    const f = preview || cameraMode === 1 || snap ? 1 : 1 - Math.exp(-10 * dt);
    camera.position.lerp(eye, f);
    if (!preview && cameraMode === 0)
      camera.position.y = Math.max(
        camera.position.y,
        world.height(camera.position.x, camera.position.z) + 0.85,
      );
    horizontal.copy(right);
    const tilt = preview ? 0 : cameraMode === 1 ? bank : Math.sin(bank) * 0.14;
    if (preview || cameraMode !== 1)
      up.set(0, Math.cos(tilt), 0).addScaledVector(horizontal, Math.sin(tilt));
    camera.up.copy(up);
    camera.lookAt(target);
    camera.getWorldDirection(horizontal);
    world.update?.(
      camera.position.x,
      camera.position.z,
      Math.atan2(horizontal.x, -horizontal.z),
      t,
    );
    scannedRocks.update(camera.position.x, camera.position.z);
    updateAir(
      t,
      s.agl,
      renderer.domElement.height,
      !reducedMotion.matches && !preview,
    );
    renderer.render(scene, camera);
  }
  async function warmup() {
    await renderer.compileAsync(scene, camera);
    // Make the renderer initialise buffers, instance attributes and material
    // textures for the entire line, including objects outside both start views.
    // Empty draw ranges perform the uploads without rasterising distant meshes.
    const objects = [],
      ranges = new Map();
    scene.traverse((node) => {
      objects.push([node, node.visible, node.frustumCulled]);
      node.visible = true;
      node.frustumCulled = false;
      const g = node.geometry;
      if (g && !ranges.has(g)) {
        ranges.set(g, { ...g.drawRange });
        g.setDrawRange(0, 0);
      }
    });
    try {
      renderer.render(scene, camera);
    } finally {
      for (const [node, visible, culled] of objects) {
        node.visible = visible;
        node.frustumCulled = culled;
      }
      for (const [g, range] of ranges) g.setDrawRange(range.start, range.count);
    }
    for (const [mode, cameraMode] of [
      ["flying", 1],
      ["preview", 0],
    ])
      draw({ mode, cameraMode, t: 0, dt: 0, snap: true });
  }
  return { generate, draw, warmup };
}
