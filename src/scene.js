import * as THREE from "three";
import { createWorld } from "./world.js";
import { createWing, createCockpit } from "./wing.js";
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
  new THREE.TextureLoader().load(
    import.meta.env.BASE_URL + "assets/sky.jpg",
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = tex;
      scene.backgroundRotation.y = 1.5;
    },
  );
  scene.add(new THREE.HemisphereLight(0xe0f0ff, 0xa49a7b, 1.65));
  const sun = new THREE.DirectionalLight(0xffe9c8, 2.1);
  sun.position.set(-0.64, 0.72, -0.26);
  scene.add(sun);
  const wing = createWing();
  scene.add(wing.group);
  const cockpit = createCockpit();
  camera.add(cockpit.group);
  scene.add(camera);
  const rings = new THREE.Group();
  scene.add(rings);
  const circle = new THREE.TorusGeometry(1, 0.017, 6, 80);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff7736 }),
    aheadMat = new THREE.MeshBasicMaterial({
      color: 0xffa56f,
      transparent: true,
      opacity: 0.63,
    });
  let world,
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
    if (world) world.dispose();
    rings.clear();
    world = createWorld(scene, seed);
    flight = createFlight(world, seed);
    flight.gates.forEach((g) => {
      const ring = new THREE.Mesh(circle, ringMat);
      ring.position.set(g.x, g.y, g.z);
      ring.scale.setScalar(g.radius);
      rings.add(ring);
    });
    return { world, flight };
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
    const dir = s.heading,
      bank = preview ? -0.16 + 0.018 * Math.sin(t * 0.28) : s.bank;
    origin.set(s.x, s.y + (preview ? 0.16 * Math.sin(t * 0.65) : 0), s.z);
    forward.set(Math.sin(dir), 0, -Math.cos(dir));
    right.set(Math.cos(dir), 0, Math.sin(dir));
    wing.group.position.copy(origin);
    wing.group.rotation.order = "YXZ";
    wing.group.rotation.y = -dir;
    wing.group.rotation.x = preview ? -0.015 : s.pitch * 0.56;
    wing.group.rotation.z = -bank;
    wing.update(s.left, s.right, s.trim, t, bank);
    wing.group.visible = cameraMode !== 1 || preview;
    cockpit.group.visible = !wing.group.visible;
    if (cockpit.group.visible)
      cockpit.update(s.left, s.right, s.trim, t, camera.aspect);
    for (let i = 0; i < rings.children.length; i++) {
      const obj = rings.children[i];
      obj.visible =
        s.style === "line" &&
        !preview &&
        i >= s.nextGate &&
        i <= s.nextGate + 2;
      obj.material = i === s.nextGate ? ringMat : aheadMat;
    }
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
      eye.y += 0.67;
      target.copy(eye).addScaledVector(forward, 25);
      target.y += Math.sin(s.pitch) * 12;
    } else {
      eye.copy(origin).addScaledVector(forward, -14.0);
      eye.y += 7.1;
      eye.y = Math.max(eye.y, world.height(eye.x, eye.z) + 1.8);
      target.copy(origin).addScaledVector(forward, 11);
      target.y += 2.3 + s.climb * 0.12;
    }
    const f = preview || cameraMode === 1 || snap ? 1 : 1 - Math.exp(-6 * dt);
    camera.position.lerp(eye, f);
    horizontal.copy(right);
    const tilt = preview ? 0 : cameraMode === 1 ? bank : Math.sin(bank) * 0.14;
    up.set(0, Math.cos(tilt), 0).addScaledVector(horizontal, Math.sin(tilt));
    camera.up.copy(up);
    camera.lookAt(target);
    renderer.render(scene, camera);
  }
  return { generate, draw };
}
