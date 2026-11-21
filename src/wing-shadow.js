import * as THREE from "three";

// Project the canopy along the sunlight onto the same triangle surface used
// for collisions. Each span station can fall on a different level of a ledge.
export function createWingShadow(scene, sunPosition) {
  const local = [],
    faces = [];
  const stations = 19;
  for (let i = 0; i < stations; i++) {
    const u = (i / (stations - 1)) * 2 - 1,
      tip = Math.abs(u);
    const x = 4.45 * u,
      y = 5.24 - 1.88 * u * u;
    const nose = -1.27 + 1.44 * u * u;
    const chord = 2.25 - 0.46 * u * u - 1.34 * tip ** 5;
    local.push(
      new THREE.Vector3(x, y, nose),
      new THREE.Vector3(x, y, nose + chord),
    );
    const a = 2 * i;
    if (i < stations - 1) faces.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const pos = new THREE.Float32BufferAttribute(
    new Float32Array(local.length * 3),
    3,
  );
  pos.setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", pos);
  geometry.setIndex(faces);
  const material = new THREE.MeshBasicMaterial({
    color: 0x1b2430,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);
  const dirX = -sunPosition.x / sunPosition.y,
    dirZ = -sunPosition.z / sunPosition.y;
  const p = new THREE.Vector3();
  return (world, state, wing) => {
    mesh.visible = state.agl < 87;
    if (!mesh.visible) return;
    wing.updateWorldMatrix(true, false);
    material.opacity =
      0.36 * (1 - THREE.MathUtils.smoothstep(state.agl, 15, 87));
    for (let i = 0; i < local.length; i++) {
      p.copy(local[i]).applyMatrix4(wing.matrixWorld);
      let low = 0,
        high = state.agl * 2 + 27;
      const clearance = (distance) =>
        p.y -
        distance -
        world.height(p.x + dirX * distance, p.z + dirZ * distance);
      while (clearance(high) > 0 && high < 320) high *= 1.5;
      for (let k = 0; k < 8; k++) {
        const mid = (low + high) * 0.5;
        if (clearance(mid) > 0) low = mid;
        else high = mid;
      }
      const x = p.x + dirX * high,
        z = p.z + dirZ * high;
      pos.setXYZ(i, x, world.height(x, z) + 0.055, z);
    }
    pos.needsUpdate = true;
  };
}
