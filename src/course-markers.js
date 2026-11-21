import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// The ring shares its centre and clear radius with the swept gate test. Two
// legs attach it to this particular slope, including on a cross-sloping shelf.
export function createCourseMarkers(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const hoopGeometry = new THREE.TorusGeometry(1, 0.028, 8, 80);
  const bandGeometry = new THREE.TorusGeometry(1, 0.031, 8, 4, 0.13);
  const arcs = [-1, 1].flatMap((side) =>
    [0.08, 0.34, 2.8, 3.06].map((angle) =>
      bandGeometry.clone().rotateZ(side * angle),
    ),
  );
  const stripesGeometry = mergeGeometries(arcs);
  const tube = new THREE.CylinderGeometry(1, 1, 1, 7);
  const flag = new THREE.BufferGeometry();
  flag.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0, 1.2, -0.12, -0.13, 0.83, -0.49, 0.06, 0, 0, 0, 0.83, -0.49,
        0.06, 0, -0.44, 0,
      ],
      3,
    ),
  );
  const orange = new THREE.MeshBasicMaterial({ color: 0xff642c });
  const ahead = new THREE.MeshBasicMaterial({ color: 0xf8b38a });
  const white = new THREE.MeshBasicMaterial({ color: 0xfff2cd });
  const pole = new THREE.MeshStandardMaterial({
    color: 0x48504d,
    roughness: 0.88,
  });
  const flagMaterial = new THREE.MeshBasicMaterial({
    color: 0xf57436,
    side: THREE.DoubleSide,
  });
  const transform = new THREE.Object3D();
  let gates = [],
    wands = [];
  function placePole(parent, x, z, base, top, radius) {
    const mesh = new THREE.Mesh(tube, pole);
    mesh.scale.set(radius, Math.max(0.1, top - base), radius);
    mesh.position.set(x, (base + top) * 0.5, z);
    parent.add(mesh);
  }
  function generate(world, course) {
    for (const batch of wands) batch.dispose();
    group.clear();
    gates = [];
    wands = [];
    for (const gate of course) {
      const station = new THREE.Group();
      const hoop = new THREE.Mesh(hoopGeometry, orange);
      hoop.scale.setScalar(gate.radius);
      hoop.position.set(gate.x, gate.y, gate.z);
      station.add(hoop);
      for (const direction of [-1, 1]) {
        const x = gate.x + direction * gate.radius;
        placePole(
          station,
          x,
          gate.z,
          world.height(x, gate.z) - 0.2,
          gate.y,
          0.1,
        );
      }
      const stripes = new THREE.Mesh(stripesGeometry, white);
      stripes.scale.copy(hoop.scale);
      stripes.position.copy(hoop.position);
      station.add(stripes);
      group.add(station);
      gates.push({ station, hoop });
    }
    // Short flexible trail flags give a readable line between the low gates.
    const count = Math.floor(-course.at(-1).z / 44);
    const stems = new THREE.InstancedMesh(tube, white, count * 2);
    const tips = new THREE.InstancedMesh(flag, flagMaterial, count * 2);
    for (let i = 0; i < count; i++) {
      const z = -32 - i * 44,
        center = world.center(z);
      for (let side = 0; side < 2; side++) {
        const x =
          center + (side === 0 ? -1 : 1) * (13 + 0.9 * Math.sin(i * 0.8));
        const y = world.height(x, z),
          id = i * 2 + side;
        transform.rotation.set(0, 0, 0);
        transform.position.set(x, y + 0.71, z);
        transform.scale.set(0.035, 1.5, 0.035);
        transform.updateMatrix();
        stems.setMatrixAt(id, transform.matrix);
        transform.position.y = y + 1.46;
        transform.rotation.y = 0.85 + 0.28 * Math.cos(i);
        transform.scale.setScalar(0.87);
        transform.updateMatrix();
        tips.setMatrixAt(id, transform.matrix);
      }
    }
    wands = [stems, tips];
    group.add(...wands);
  }
  function update(state, preview) {
    group.visible = state.style === "line";
    if (!group.visible) return;
    for (let i = 0; i < gates.length; i++) {
      gates[i].station.visible =
        i >= state.nextGate && i <= state.nextGate + (preview ? 1 : 3);
      gates[i].hoop.material = i === state.nextGate ? orange : ahead;
    }
  }
  return { generate, update };
}
