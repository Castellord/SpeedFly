import { flightTexture } from "./textures.js";
import * as THREE from "three";

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const color = (hex) => new THREE.Color(hex);
const sizeOfCell = 128;
const species = [
  { name: "Ель", crown: 0.222, base: 0.105, droop: 0.38, tiers: 15, boughs: 7 },
  {
    name: "Лиственница",
    crown: 0.22,
    base: 0.235,
    droop: 0.19,
    tiers: 12,
    boughs: 6,
  },
  { name: "Сосна", crown: 0.308, base: 0.31, droop: 0.1, tiers: 9, boughs: 6 },
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

function forestTexture(name) {
  const map = flightTexture(name + ".webp");
  if (!map) return null;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

class MeshData {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.uv = [];
    this.indices = [];
  }
  point(p, normal, c, uv = [0.905, 0.08]) {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(normal.x, normal.y, normal.z);
    this.colors.push(c.r, c.g, c.b);
    this.uv.push(uv[0], uv[1]);
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
      ["uv", this.uv, 2],
    ]) {
      g.setAttribute(name, new THREE.Float32BufferAttribute(arr, count));
    }
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

function tube(data, start, end, r1, r2, sides, tint, bark = false) {
  const dir = end.clone().sub(start).normalize();
  const cross = dir
    .clone()
    .cross(Math.abs(dir.y) > 0.9 ? v(1, 0, 0) : v(0, 1, 0))
    .normalize();
  const along = cross.clone().cross(dir).normalize();
  const rings = [];
  for (const [j, point, r] of [
    [0, start, r1],
    [1, end, r2],
  ]) {
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const a = (i * TAU) / sides,
        normal = cross
          .clone()
          .multiplyScalar(Math.cos(a))
          .addScaledVector(along, Math.sin(a));
      const uv = bark
        ? [0.752 + (0.105 * i) / sides, 0.17 + ((point.y * 0.67) % 0.76)]
        : undefined;
      ring.push(
        data.point(point.clone().addScaledVector(normal, r), normal, tint, uv),
      );
    }
    rings[j] = ring;
  }
  for (let i = 0; i < sides; i++) {
    const k = (i + 1) % sides;
    data.face(rings[0][i], rings[1][i], rings[0][k]);
    data.face(rings[0][k], rings[1][i], rings[1][k]);
  }
}

function conifer(type, variant, lod) {
  const s = species[type],
    rng = random(9469 + type * 239 + variant * 153);
  const data = new MeshData();
  const bendX = (rng() - 0.5) * (type === 2 ? 0.16 : 0.058),
    bendZ = (rng() - 0.5) * 0.06;
  const trunk = (y) =>
    v(
      bendX * y * y + 0.008 * Math.sin(y * 6 + variant) * y,
      y,
      bendZ * Math.max(0, y) ** 1.7,
    );
  const white = color(0xffffff),
    bark = color(0xc1b09c);
  const base = s.base + (variant - 0.5) * 0.035;
  if (lod === 2) {
    // Baked, view-dependent silhouettes integrate into the same branch geometry
    // in the distance, where a full bough would project to a fraction of a pixel.
    const column = type * 2 + variant;
    for (let k = 0; k < 2; k++)
      for (let n = 0; n < 2; n++) {
        data.point(
          v(n ? 0.39 : -0.39, k ? 1.035 : -0.037, 0),
          v(0, 0, 1),
          white,
          [(column + (n ? 0.999 : 0.001)) / 6, 1 - (k ? 0.001 : 0.999) / 2],
        );
      }
    data.face(0, 1, 2);
    data.face(1, 3, 2);
    return data.finish();
  }
  const stemSections = lod === 0 ? 5 : 2;
  for (let i = 0; i < stemSections; i++) {
    const y = i / stemSections;
    tube(
      data,
      trunk(y - 0.008),
      trunk((i + 1) / stemSections),
      0.015 * (1 - y) + 0.0005,
      0.015 * (1 - (i + 1) / stemSections) + 0.0004,
      lod === 0 ? 7 : 4,
      bark,
      true,
    );
  }
  const tiers = lod === 0 ? s.tiers + variant : Math.ceil(s.tiers * 0.66);
  for (let i = 0; i < tiers; i++) {
    const u = (i + 0.02) / (tiers - 0.63),
      y = mix(base, 0.984, u);
    const fork = trunk(y),
      rotation = rng() * TAU;
    const spokes = Math.max(
      3,
      s.boughs - Math.floor(u * 2) - (lod === 1 ? 1 : 0),
    );
    const baseRadius =
      s.crown *
      Math.pow(1 - u, type === 2 ? 0.52 : 0.74) *
      (0.88 + 0.12 * Math.sin(Math.min(1, u * 6) * Math.PI * 0.53));
    for (let j = 0; j < spokes; j++) {
      const a = rotation + ((j + rng() * 0.43) * TAU) / spokes;
      const radial = v(Math.cos(a), 0, Math.sin(a)),
        side = v(-Math.sin(a), 0, Math.cos(a));
      const length = baseRadius * (0.77 + 0.41 * rng());
      const width =
        length *
        (type === 2 ? 0.25 : type === 1 ? 0.24 : 0.23) *
        (lod === 1 ? 1.58 : 1);
      const sag = length * s.droop;
      const offset = length * (rng() - 0.5) * 0.3;
      const lift =
        length *
        (type === 2 ? 0.09 : type === 1 ? 0.035 : 0.0) *
        (0.5 + rng() * 0.84);
      const rootPos = fork
        .clone()
        .add(v(0, (rng() - 0.5) * (0.039 + 0.042 * (1 - u)), 0));
      const branch = (t) =>
        rootPos
          .clone()
          .addScaledVector(radial, t * length)
          .addScaledVector(side, offset * t * t)
          .add(
            v(
              0,
              -sag * (0.83 * t + 0.33 * Math.sin(t * Math.PI)) + lift * t * t,
              0,
            ),
          );
      if (lod === 0 && (i < tiers * 0.65 || j % 2 === 0)) {
        tube(
          data,
          rootPos,
          branch(0.47),
          0.0045 * (1 - u) + 0.0012,
          0.0016,
          3,
          color(0x746046),
        );
      }
      const row = (j + i + variant) % 2,
        cols = lod === 0 ? 4 : 2;
      const tint = white
        .clone()
        .multiplyScalar(
          (0.65 + 0.29 * (i / (tiers - 1)) + 0.16 * rng()) *
            (type === 1 ? 1.12 : 1),
        );
      const strips = [];
      for (let step = 0; step <= cols; step++) {
        const t = step / cols;
        const center = branch(t),
          ring = [];
        for (const lateral of [-1, 0, 1]) {
          const point = center.clone().addScaledVector(side, lateral * width);
          point.y -=
            Math.abs(lateral) * width * (0.19 + 0.25 * Math.sin(t * Math.PI));
          const n = radial
            .clone()
            .multiplyScalar(0.15)
            .addScaledVector(side, lateral * 0.6)
            .add(v(0, 0.93, 0))
            .normalize();
          const uv = [
            (type + 0.012 + (0.5 + 0.49 * lateral) * 0.977) / 4,
            1 - (row + 0.985 - t * 0.967) / 2,
          ];
          ring.push(data.point(point, n, tint, uv));
        }
        strips.push(ring);
      }
      for (let k = 0; k < cols; k++)
        for (let n = 0; n < 2; n++) {
          data.face(strips[k][n], strips[k][n + 1], strips[k + 1][n]);
          data.face(strips[k][n + 1], strips[k + 1][n + 1], strips[k + 1][n]);
        }
      // Offshoots grow from the main branch into different planes: low spruce
      // shoots hang down, larch fans hang loosely, and pine shoots turn upward.
      const splits = lod === 0 ? 3 : 1;
      for (let k = 0; k < splits; k++)
        for (const flank of [-1, 1]) {
          const at = 0.28 + ((k + 0.22 * rng()) * 0.53) / splits;
          const start = branch(at);
          const branchLength =
            length * (0.49 - 0.23 * at) * (0.82 + 0.31 * rng());
          const shoot = radial
            .clone()
            .multiplyScalar(0.48 + rng() * 0.2)
            .addScaledVector(side, flank * (0.68 + rng() * 0.23))
            .normalize();
          const perpendicular = v(-shoot.z, 0, shoot.x);
          const endY =
            branchLength *
            (type === 0
              ? -0.76 - rng() * 0.35
              : type === 1
                ? -0.31 - rng() * 0.39
                : -0.15 + rng() * 0.33);
          const tip = start
            .clone()
            .addScaledVector(shoot, branchLength)
            .add(v(0, endY, 0));
          const half = branchLength * (type === 1 ? 0.27 : 0.31);
          const n = v(shoot.x, 0.65, shoot.z).normalize(),
            tone = tint.clone().multiplyScalar(0.9 + rng() * 0.17);
          const strips = [],
            segments = lod === 0 ? 2 : 1;
          for (let q = 0; q <= segments; q++) {
            const t = q / segments;
            const axis = start.clone().lerp(tip, t);
            axis.y -= Math.sin(Math.PI * t) * branchLength * 0.1;
            const vertices = [];
            for (const lateral of [-1, 1]) {
              const p = axis
                .clone()
                .addScaledVector(perpendicular, half * lateral);
              p.y += half * 0.17 * lateral * flank;
              vertices.push(
                data.point(p, n, tone, [
                  (type + 0.5 + 0.48 * lateral) / 4,
                  1 - (row + 0.97 - t * 0.94) / 2,
                ]),
              );
            }
            strips.push(vertices);
          }
          for (let j = 0; j < segments; j++) {
            data.face(strips[j][0], strips[j][1], strips[j + 1][0]);
            data.face(strips[j][1], strips[j + 1][1], strips[j + 1][0]);
          }
        }
    }
  }
  return data.finish();
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
  const atlas = forestTexture("conifer-branches");
  const needles = new THREE.MeshLambertMaterial({
    map: atlas,
    vertexColors: true,
    alphaTest: 0.25,
    side: THREE.DoubleSide,
  });
  // Soft transmission is important for boughs seen against the light.
  needles.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      "#include <normal_fragment_begin>\nnormal *= gl_FrontFacing ? 1.0 : -1.0;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      "outgoingLight += diffuseColor.rgb * .16;\n#include <opaque_fragment>",
    );
  };
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
  const distantMap = forestTexture("conifer-crowns");
  const distant = new THREE.MeshBasicMaterial({
    map: distantMap,
    alphaTest: 0.24,
    vertexColors: true,
  });
  distant.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      mat4 treeFrame=modelMatrix;
      #ifdef USE_INSTANCING
        treeFrame*=instanceMatrix;
      #endif
      vec3 eye=cameraPosition-treeFrame[3].xyz;
      vec2 azimuth=vec2(dot(eye,normalize(treeFrame[0].xyz)),dot(eye,normalize(treeFrame[2].xyz)));
      azimuth/=max(length(azimuth),.0001);
      transformed.xz=vec2(position.x*azimuth.y,-position.x*azimuth.x);
      #ifdef USE_MAP
        float sideView=step(abs(azimuth.y),abs(azimuth.x));
        vMapUv.y-=.5*sideView;
        float facing=mix(azimuth.y,azimuth.x,sideView);
        if(facing<0.) vMapUv.x=(2.*floor(vMapUv.x*6.)+1.)/6.-vMapUv.x;
      #endif
    `,
    );
  };
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
          mat: lod === 2 ? distant : needles,
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
  for (let i = 0; i < 57000; i++) {
    const z = 900 - rng() * 6250,
      corridor = center(z),
      x = corridor + (rng() - 0.5) * (i < 32000 ? 3200 : 1180);
    const gap = Math.abs(x - corridor);
    if (gap < 21 || Math.abs(x - stream(z)) < 12) continue;
    const y = height(x, z);
    if (y > 1820) continue;
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
  // Preserve space for the wing even where the gate centre wanders sideways.
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
      if (ny < 0.73 || y > 2010 || Math.abs(x - stream(pz)) < 6) continue;
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
      distant.dispose();
      needles.dispose();
      solid.dispose();
      shadeMaterial.dispose();
      shadowGeometry.dispose();
    },
  };
}
