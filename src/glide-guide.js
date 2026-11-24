import * as THREE from "three";

// A broken ribbon occupies the predicted path of the harness. The depth
// buffer hides it behind terrain, including on blind approaches to a ridge.
export function createGlideGuide(scene) {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.Float32BufferAttribute(
    new Float32Array(40 * 6 * 3),
    3,
  ).setUsage(THREE.DynamicDrawUsage);
  const colors = new THREE.Float32BufferAttribute(
    new Float32Array(40 * 6 * 3),
    3,
  ).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("color", colors);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
    }),
  );
  mesh.material.forceSinglePass = true;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  const clear = new THREE.Color(0x71efbe),
    lowClearance = new THREE.Color(0xffbb57),
    danger = new THREE.Color(0xff5742);
  const previous = new THREE.Vector3(),
    current = new THREE.Vector3();
  let nextUpdate = 0,
    owner = null;
  return (flight, enabled, snap) => {
    mesh.visible = enabled;
    if (!enabled) {
      nextUpdate = 0;
      return;
    }
    const t = flight.state.time;
    if (owner === flight && !snap && t < nextUpdate && nextUpdate - t <= 0.21)
      return;
    owner = flight;
    nextUpdate = t + 0.2;
    let vertex = 0,
      sample = 0,
      warningFrom = Infinity,
      impact = false;
    flight.predictGlide((s) => {
      current.set(s.x, s.y - 0.28, s.z);
      if (s.status === "crashed" || s.status === "landed") impact = true;
      if (sample++ > 1) {
        const dx = current.x - previous.x,
          dz = current.z - previous.z;
        const width = 0.18 + 0.007 * sample,
          factor = width / Math.max(0.001, Math.hypot(dx, dz));
        const sx = -dz * factor,
          sz = dx * factor;
        for (const [u, side] of corners) {
          positions.setXYZ(
            vertex++,
            previous.x + dx * u + sx * side,
            previous.y + (current.y - previous.y) * u,
            previous.z + dz * u + sz * side,
          );
        }
        if (s.agl < 3.5) warningFrom = Math.min(warningFrom, vertex - 6);
      }
      previous.copy(current);
    });
    for (let i = 0; i < vertex; i++) {
      const tint =
        impact && i >= Math.max(0, vertex - 30)
          ? danger
          : i >= warningFrom
            ? lowClearance
            : clear;
      colors.setXYZ(i, tint.r, tint.g, tint.b);
    }
    geometry.setDrawRange(0, vertex);
    positions.needsUpdate = colors.needsUpdate = true;
  };
}
const corners = [
  [0.04, -1],
  [0.04, 1],
  [0.74, -1],
  [0.74, -1],
  [0.04, 1],
  [0.74, 1],
];
