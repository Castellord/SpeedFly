import * as THREE from "three";

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const color = (hex) => new THREE.Color(hex);
const sizeOfCell = 128;
const species = [
  {
    crown: 0.244,
    base: 0.14,
    tiers: 4,
    palette: [0x33715c, 0x43865e, 0x529965, 0x7ab776],
  },
  {
    crown: 0.225,
    base: 0.22,
    tiers: 3,
    palette: [0x61883c, 0x81a344, 0x9eb84e],
  },
  {
    crown: 0.31,
    base: 0.27,
    tiers: 3,
    palette: [0x396e62, 0x4f9378, 0x79ad84],
  },
];

function random(seed) {
  let n = 2166136261;
  for (const ch of String(seed)) n = Math.imul(n ^ ch.charCodeAt(0), 16777619);
  return () => {
    n = (n + 0x6d2b79f5) | 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MeshData {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
  }
  point(p, normal, c) {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(normal.x, normal.y, normal.z);
    this.colors.push(c.r, c.g, c.b);
    return this.positions.length / 3 - 1;
  }
  face(a, b, c) {
    this.indices.push(a, b, c);
  }
  finish() {
    const g = new THREE.BufferGeometry();
    for (const [name, arr, count] of [
      ["position", this.positions, 3],
      ["normal", this.normals, 3],
      ["color", this.colors, 3],
    ]) {
      g.setAttribute(name, new THREE.Float32BufferAttribute(arr, count));
    }
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

// Each crown is made of overlapping folded skirts. The low, dark underside
// separates the tiers when a pilot looks up from below the treetops.
function conifer(type, variant, lod) {
  const tree = species[type];
  const sides = [8, 6, 5][lod];
  const rng = random(type * 17 + variant);
  const positions = [],
    colors = [];
  function triangle(a, b, c, tint) {
    positions.push(...a, ...b, ...c);
    for (let j = 0; j < 3; j++) colors.push(tint.r, tint.g, tint.b);
  }
  const bark = color(0x885c43);
  for (let j = 0; j < 5; j++) {
    const a = (TAU * j) / 5,
      b = (TAU * (j + 1)) / 5;
    triangle(
      [0.032 * Math.cos(a), 0, 0.032 * Math.sin(a)],
      [0, 0.68, 0],
      [0.032 * Math.cos(b), 0, 0.032 * Math.sin(b)],
      bark,
    );
  }
  const rise = 1 - tree.base;
  const bend = variant ? -0.038 : 0.025;
  for (let tier = 0; tier < tree.tiers; tier++) {
    const frac = tier / tree.tiers;
    const y = tree.base + frac * rise * 0.89;
    const tipY =
      tier === tree.tiers - 1
        ? 1
        : Math.min(0.99, y + rise * (0.53 - 0.09 * frac));
    const radius = tree.crown * (1 - frac * 0.87);
    const spin = rng() * 0.65;
    const tint = color(tree.palette[tier]);
    const rim = Array.from({ length: sides }, (_, i) => {
      const a = spin + (TAU * i) / sides,
        r = radius * (0.91 + 0.13 * rng());
      return [
        bend * y + r * Math.cos(a),
        y + (0.04 * rng() - 0.017) * rise,
        r * Math.sin(a),
      ];
    });
    const apex = [bend * tipY, tipY, 0],
      underside = [bend * y, y - 0.045 * (1 - frac), 0];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      triangle(rim[i], apex, rim[j], tint);
      triangle(rim[j], underside, rim[i], tint.clone().multiplyScalar(0.63));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function stones(variant) {
  const rng = random(128 + variant * 215);
  const g = new THREE.IcosahedronGeometry(1, 1),
    points = g.attributes.position,
    colors = [];
  const tint = color([0x8b897f, 0x9d9b89, 0x7b827e][variant]);
  const vein = rng() * Math.PI,
    phase = rng() * TAU;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i),
      y = points.getY(i),
      z = points.getZ(i);
    const split =
      0.86 + 0.14 * Math.sin(x * 4.1 + phase + y * 1.4) * Math.cos(z * 4.6 + y);
    const py = y > 0.48 ? 0.48 + (y - 0.48) * 0.56 : y;
    points.setXYZ(
      i,
      x * split + y * 0.14,
      py * split,
      z * (0.8 + 0.23 * Math.cos(x * 4.1 + phase)) - 0.12 * y,
    );
    const stratum =
      0.89 +
      0.16 *
        Math.sin(x * 4.9 * Math.cos(vein) + z * 4.9 * Math.sin(vein) + y * 9.2);
    const shade = stratum * (0.79 + 0.19 * y + 0.13 * rng());
    colors.push(tint.r * shade, tint.g * shade, tint.b * shade);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function juniper(variant) {
  const r = random(1135 + variant * 91),
    data = new MeshData(),
    n = 8;
  const palette = [0x485336, 0x64734a, 0x869054].map(color);
  const stems = variant === 0 ? 10 : 7;
  for (let j = 0; j < stems; j++) {
    const a = r() * TAU,
      dx = (j === 0 ? 0 : 0.2 + r() * 0.43) * Math.cos(a),
      dz = (j === 0 ? 0 : 0.2 + r() * 0.43) * Math.sin(a);
    const radius = 0.3 + r() * 0.17,
      top = 0.51 + r() * 0.38,
      rings = [];
    for (let k = 0; k < 3; k++) {
      const ring = [],
        radiusK = radius * [0.69, 1, 0.37][k];
      for (let i = 0; i < n; i++) {
        const ang = (i * TAU) / n;
        const rad = radiusK * (0.76 + 0.39 * r());
        const x = dx + rad * Math.cos(ang),
          z = dz + rad * Math.sin(ang);
        const y = top * [0.12, 0.58, 0.95][k] + 0.15 * r();
        ring.push(
          data.point(
            v(x, y, z),
            v(Math.cos(ang), k * 0.56, Math.sin(ang)).normalize(),
            palette[clamp(k + (r() > 0.86 ? 1 : 0), 0, 2)],
          ),
        );
      }
      rings.push(ring);
    }
    for (let k = 0; k < 2; k++)
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        data.face(rings[k][next], rings[k][i], rings[k + 1][i]);
        data.face(rings[k][next], rings[k + 1][i], rings[k + 1][next]);
      }
    const id = data.point(v(dx, top, dz), v(0, 1, 0), palette[2]);
    for (let i = 0; i < n; i++)
      data.face(rings[2][(i + 1) % n], rings[2][i], id);
  }
  return data.finish();
}

function shadowDisc() {
  const g = new THREE.BufferGeometry(),
    positions = [0, 0, 0],
    colors = [1, 1, 1, 0.3],
    indices = [];
  const n = 10;
  for (let ring = 0; ring < 2; ring++)
    for (let i = 0; i < n; i++) {
      const a = (i * TAU) / n,
        r = ring ? 1 : 0.48;
      positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      colors.push(1, 1, 1, ring ? 0 : 0.22);
    }
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    indices.push(
      0,
      next + 1,
      i + 1,
      next + 1,
      next + n + 1,
      i + 1,
      i + 1,
      next + n + 1,
      i + n + 1,
    );
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  g.setIndex(indices);
  return g;
}

export function createVegetation({
  scene,
  seed = 1847,
  addPass,
  height,
  center,
  forest,
  river,
}) {
  const rng = random(seed + "/treeline"),
    root = new THREE.Group();
  root.name = "Альпийское редколесье";
  scene.add(root);
  const solid = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
  });
  const shadeMaterial = new THREE.MeshBasicMaterial({
    color: 0x2e382d,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    side: THREE.DoubleSide,
  });
  const cells = new Map(),
    obstacles = new Map(),
    counts = new Uint32Array(11);
  const assets = [];
  for (let type = 0; type < 3; type++)
    for (let variant = 0; variant < 2; variant++) {
      assets.push(
        [0, 1, 2].map((lod) => ({
          geo: conifer(type, variant, lod),
          mat: solid,
        })),
      );
    }
  for (let i = 0; i < 3; i++) assets.push([{ geo: stones(i), mat: solid }]);
  for (let i = 0; i < 2; i++) assets.push([{ geo: juniper(i), mat: solid }]);
  const cellKey = (x, z) => x + "," + z;
  const transform = new THREE.Object3D();
  const sunXZ = [0.927, 0.375];
  function place(id, x, y, z, h, wide, dx, dz, shade) {
    const tree = id < 6,
      stone = id >= 6 && id < 9;
    const radius = tree ? h * wide * species[id >> 1].crown : h * wide * 0.98;
    const obj = {
      id,
      x,
      y,
      z,
      h,
      wide,
      radius,
      shade,
      jitter: 0.81 + 0.37 * rng(),
    };
    transform.position.set(x, y, z);
    const yaw = rng() * TAU;
    transform.rotation.set(
      stone ? (rng() - 0.5) * 0.3 : 0,
      yaw,
      stone ? (rng() - 0.5) * 0.25 : 0,
    );
    transform.scale.set(
      h * wide,
      h,
      h * wide * (stone ? 0.69 + rng() * 0.29 : 1),
    );
    transform.updateMatrix();
    obj.matrix = transform.matrix.clone();
    if (tree || h > 1.2) {
      const length = tree ? h * 0.65 : radius * 1.3,
        width = tree ? radius * 0.92 : radius * 0.95;
      const ex = sunXZ[0],
        ez = sunXZ[1],
        ox = ex * length * 0.76,
        oz = ez * length * 0.76;
      obj.shadow = new THREE.Matrix4().set(
        ex * length,
        0,
        -ez * width,
        x + ox,
        (ex * dx + ez * dz) * length,
        1,
        (-ez * dx + ex * dz) * width,
        y + (ox * dx + oz * dz) + 0.22 + (tree ? 0.07 : h * 0.24),
        ez * length,
        0,
        ex * width,
        z + oz,
        0,
        0,
        0,
        1,
      );
    }
    if (tree && h > 3) addPass?.(x, y, z, radius * 0.75, h * 0.9);
    counts[id]++;
    const key = cellKey(Math.floor(x / sizeOfCell), Math.floor(z / sizeOfCell));
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(obj);
    if (h < 0.55) return;
    const b = 40;
    for (
      let i = Math.floor((x - radius) / b);
      i <= Math.floor((x + radius) / b);
      i++
    )
      for (
        let j = Math.floor((z - radius) / b);
        j <= Math.floor((z + radius) / b);
        j++
      ) {
        const key = cellKey(i, j);
        if (!obstacles.has(key)) obstacles.set(key, []);
        obstacles.get(key).push(obj);
      }
  }
  const stream = (z) => (river ? river(z) : center(z) + 55);
  function slope(x, z) {
    const dx = (height(x + 4, z) - height(x - 4, z)) / 8,
      dz = (height(x, z + 4) - height(x, z - 4)) / 8;
    return [dx, dz, 1 / Math.hypot(1, dx, dz)];
  }
  for (let i = 0; i < 36000; i++) {
    const z = 900 - rng() * 6250,
      corridor = center(z),
      x = corridor + (rng() - 0.5) * (i < 21000 ? 3200 : 1180);
    const gap = Math.abs(x - corridor);
    if (gap < 21 || Math.abs(x - stream(z)) < 12) continue;
    const y = height(x, z);
    if (y > 2430) continue;
    const [dx, dz, ny] = slope(x, z);
    if (ny < 0.65) continue;
    const habitat = forest ? forest(x, z, y, ny) : 0.64;
    const edge = clamp((gap - 20) / 32, 0, 1);
    if (rng() > (0.011 + habitat * 0.88) * edge) continue;
    // Coherent species stands, with scattered larches on brighter high slopes.
    const stand =
      0.28 * Math.sin(x / 174 + z / 415) +
      0.25 * Math.sin(z / 131 - x / 290) +
      0.14 * Math.cos(x / 99 + z / 163);
    const mixSpecies = rng() + stand + (y - 900) * 0.00017;
    const type = mixSpecies > 1.0 ? 1 : mixSpecies < 0.12 ? 2 : 0;
    const age = rng();
    const h =
      (age < 0.16
        ? 3.1 + rng() * 4
        : age < 0.43
          ? 7 + rng() * 5
          : 11 + rng() * 7.3) *
      (1 + 0.09 * Math.sin(z / 141)) *
      (type === 2 ? 0.86 : 1);
    if (gap < 21 + h * species[type].crown * 1.13) continue;
    place(
      type * 2 + (rng() > 0.5 ? 1 : 0),
      x,
      y - 0.07,
      z,
      h,
      0.85 + 0.28 * rng(),
      dx,
      dz,
      0.8 + rng() * 0.26,
    );
  }
  for (let i = 0; i < 10500; i++) {
    const z = 510 - rng() * 5100,
      c = center(z),
      x = c + (rng() - 0.5) * (i < 4200 ? 265 : 1550);
    const gap = Math.abs(x - c),
      streamGap = Math.abs(x - stream(z)),
      y = height(x, z);
    const [dx, dz, ny] = slope(x, z);
    if (ny < 0.58) continue;
    const rock = streamGap < 32 || ny < 0.81 || rng() < 0.54;
    if (!rock && (streamGap < 10 || ny < 0.67 || y > 1700)) continue;
    let h = rock
      ? 0.24 + rng() ** 3.4 * (streamGap < 28 || ny < 0.79 ? 3.7 : 1.75)
      : 0.42 + rng() ** 1.65 * 1.55;
    if (gap < 21 + h * 1.8) h = Math.min(h, 0.32);
    place(
      rock ? 6 + Math.floor(rng() * 3) : 9 + (rng() > 0.5 ? 1 : 0),
      x,
      y - (rock ? h * (0.23 + 0.29 * (1 - ny)) : 0.08),
      z,
      h,
      rock ? 0.83 + rng() * 0.68 : 1.12 + rng() * 0.65,
      dx,
      dz,
      0.8 + rng() * 0.31,
    );
  }
  // Isolated stands lean into the shoulders with open glades between them.
  // Leave clearance around the middle of the descent.
  for (let z = -26; z > -3260; z -= 63 + rng() * 92) {
    const side = rng() < 0.5 ? -1 : 1;
    const count = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const pz = z - i * (4 + rng() * 6),
        h = 4.5 + rng() * 8;
      const type = rng() < 0.68 ? 0 : 1;
      const x =
        center(pz) +
        side * (10.5 + h * species[type].crown + rng() * 5 + i * 1.4);
      const y = height(x, pz),
        [dx, dz, ny] = slope(x, pz);
      if (ny < 0.73 || y > 2480 || Math.abs(x - stream(pz)) < 6) continue;
      place(
        type * 2 + (rng() < 0.5 ? 0 : 1),
        x,
        y - 0.07,
        pz,
        h,
        0.92,
        dx,
        dz,
        0.87 + rng() * 0.18,
      );
    }
  }
  const batch = (geo, mat, capacity, colored = true) => {
    const instance = new THREE.InstancedMesh(geo, mat, Math.max(1, capacity));
    if (colored) {
      instance.setColorAt(0, new THREE.Color(0xffffff));
      instance.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    instance.count = 0;
    instance.frustumCulled = false;
    instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(instance);
    return instance;
  };
  const batches = assets.map((levels, id) =>
    levels.map((model) => batch(model.geo, model.mat, counts[id])),
  );
  const shadowGeometry = shadowDisc();
  const shadows = batch(
    shadowGeometry,
    shadeMaterial,
    counts.reduce((a, b) => a + b, 0),
    false,
  );
  const tint = new THREE.Color();
  function append(b, obj) {
    const index = b.count++;
    b.setMatrixAt(index, obj.matrix);
    // An instance multiplier in linear space gives neighbouring trees individual exposure.
    tint.setRGB(
      obj.shade,
      obj.shade * (0.98 + 0.023 * obj.jitter),
      obj.shade * 0.98,
    );
    b.setColorAt(index, tint);
  }
  let lastX = Infinity,
    lastZ = Infinity,
    lastHeading = Infinity;
  function update(x, z, heading = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const deltaHeading = Math.abs(heading - lastHeading);
    if ((x - lastX) ** 2 + (z - lastZ) ** 2 < 24 ** 2 && deltaHeading < 0.2)
      return;
    lastX = x;
    lastZ = z;
    lastHeading = heading;
    const forwardX = Math.sin(heading),
      forwardZ = -Math.cos(heading);
    for (const levels of batches) for (const b of levels) b.count = 0;
    shadows.count = 0;
    const far = 2180;
    for (
      let iz = Math.floor((z - far) / sizeOfCell);
      iz <= Math.floor((z + far) / sizeOfCell);
      iz++
    ) {
      for (
        let ix = Math.floor((x - far) / sizeOfCell);
        ix <= Math.floor((x + far) / sizeOfCell);
        ix++
      ) {
        const cluster = cells.get(cellKey(ix, iz));
        if (!cluster) continue;
        for (const obj of cluster) {
          const d2 = (obj.x - x) ** 2 + (obj.z - z) ** 2,
            distance = Math.sqrt(d2) * obj.jitter;
          if (distance > far) continue;
          const along = (obj.x - x) * forwardX + (obj.z - z) * forwardZ;
          if (d2 > 2304 && along < Math.sqrt(d2) * 0.27 - 28) continue;
          const levels = batches[obj.id];
          if (obj.id < 6) {
            if (obj.h < 5 && distance > 1340) continue;
            const lod = distance < 93 ? 0 : distance < 316 ? 1 : 2;
            append(levels[lod], obj);
          } else {
            if (distance > Math.min(455, 85 + obj.h * 113)) continue;
            append(levels[0], obj);
          }
          if (obj.shadow && distance < 485)
            shadows.setMatrixAt(shadows.count++, obj.shadow);
        }
      }
    }
    for (const levels of batches)
      for (const b of levels) {
        b.visible = b.count > 0;
        if (!b.visible) continue;
        b.instanceMatrix.clearUpdateRanges();
        b.instanceMatrix.addUpdateRange(0, b.count * 16);
        b.instanceMatrix.needsUpdate = true;
        if (b.instanceColor) {
          b.instanceColor.clearUpdateRanges();
          b.instanceColor.addUpdateRange(0, b.count * 3);
          b.instanceColor.needsUpdate = true;
        }
      }
    shadows.visible = shadows.count > 0;
    shadows.instanceMatrix.clearUpdateRanges();
    if (shadows.count)
      shadows.instanceMatrix.addUpdateRange(0, shadows.count * 16);
    shadows.instanceMatrix.needsUpdate = true;
  }
  function hitsObstacle(x, y, z) {
    const objects = obstacles.get(
      cellKey(Math.floor(x / 40), Math.floor(z / 40)),
    );
    if (!objects) return false;
    for (const obj of objects) {
      const t = (y - obj.y) / obj.h;
      if (t < -0.02 || t > 1.02) continue;
      let envelope;
      if (obj.id < 6) {
        const s = species[obj.id >> 1];
        envelope =
          t < s.base - 0.055
            ? 0.06
            : 0.86 *
              Math.pow(
                clamp((1 - t) / (1 - s.base), 0, 1),
                obj.id >= 4 ? 0.53 : 0.71,
              );
      } else
        envelope =
          obj.id < 9
            ? 0.88 * Math.sqrt(Math.max(0, 1 - (t / 0.85) ** 2))
            : 0.79 * Math.sqrt(Math.max(0, 1 - t * t));
      const r = obj.radius * envelope;
      if ((x - obj.x) ** 2 + (z - obj.z) ** 2 < r * r) return true;
    }
    return false;
  }
  update(center(0), 0);
  return {
    update,
    hitsObstacle,
    dispose() {
      root.removeFromParent();
      root.traverse((obj) => {
        if (obj.isInstancedMesh) obj.dispose();
      });
      for (const levels of assets)
        for (const model of levels) model.geo.dispose();
      solid.dispose();
      shadeMaterial.dispose();
      shadowGeometry.dispose();
    },
  };
}
