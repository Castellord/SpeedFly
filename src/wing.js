import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const cells = 27;
const clamp = THREE.MathUtils.clamp;
const vec = (x, y, z) => new THREE.Vector3(x, y, z);
const up = vec(0, 1, 0);

// Span follows the fabric arc, so the last inflated chambers fold down around the tips.
function section(s, t, upper) {
  const a = Math.abs(s);
  const angle = s * 1.39;
  const x = (4.5 * Math.sin(angle)) / Math.sin(1.39);
  const centerY = 5.22 - (1.94 * (1 - Math.cos(angle))) / (1 - Math.cos(1.39));
  const chord = 2.34 - 0.54 * a * a - 0.88 * a ** 5;
  const cellAt = (s + 1) * cells * 0.5;
  const balloon = Math.sin(Math.PI * (cellAt - Math.floor(cellAt))) ** 0.85;
  const foil = Math.sin(Math.PI * t) ** 0.83;
  const thickness = (0.095 + 0.25 * Math.sin(Math.PI * Math.sqrt(t))) * (1 - t);
  const camber = 0.068 * foil;
  const inflation = 0.055 * balloon * (0.45 + 0.55 * foil) * (1 - t);
  const h =
    chord *
    (camber +
      (upper
        ? thickness * 0.49 + inflation
        : -thickness * 0.36 - inflation * 0.49));
  return vec(
    x + Math.sin(angle) * h,
    centerY + Math.cos(angle) * h + 0.14 * (1 - t) - 0.075 * t,
    -1.3 + 1.49 * a ** 2.15 + chord * t - 0.09 * balloon * Math.exp(-9 * t),
  );
}

function brakeDelta(s, t, side) {
  const lateral = Math.max(0, s * side);
  const envelope = Math.min(1, 3.6 * lateral) * (0.43 + 0.57 * lateral);
  const flex = t ** 2.8 * envelope;
  return vec(-side * 0.13 * flex, -0.53 * flex, 0.19 * flex);
}

function trimDelta(t) {
  return vec(0, (t - 0.47) * 0.19, -0.11);
}

// UV-space artwork stays sharp across the bulging cells and follows the seams.
function clothTexture(upper) {
  const width = 2048,
    height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d");
  c.scale(width, height);
  c.fillStyle = upper ? "#fa4b22" : "#f25a29";
  c.fillRect(0, 0, 1, 1);
  function polygon(color, points) {
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fillStyle = color;
    c.fill();
  }
  for (const side of [0, 1]) {
    c.save();
    if (side) {
      c.translate(1, 0);
      c.scale(-1, 1);
    }
    // Asymmetric chordwise racing flashes on each wingtip.
    polygon("#202a30", [
      [0, 0],
      [0.084, 0],
      [0.245, 1],
      [0, 1],
    ]);
    polygon("#ffebce", [
      [0.083, 0],
      [0.128, 0],
      [0.276, 1],
      [0.237, 1],
    ]);
    polygon(upper ? "#d83b1d" : "#dd4722", [
      [0.185, 0],
      [0.214, 0],
      [0.337, 1],
      [0.29, 1],
    ]);
    polygon("#ff8d53", [
      [0.21, 0],
      [0.223, 0],
      [0.352, 1],
      [0.335, 1],
    ]);
    polygon("#ef5127", [
      [0, 0],
      [0.018, 0],
      [0.05, 1],
      [0, 1],
    ]);
    c.restore();
  }
  c.fillStyle = "rgba(255,202,145,.19)";
  c.fillRect(0, 0, 1, 0.025);
  c.fillStyle = "rgba(56,34,34,.16)";
  c.fillRect(0, 0.979, 1, 0.021);
  for (let i = 0; i <= cells; i++) {
    const x = i / cells;
    c.fillStyle = "rgba(42,27,31,.23)";
    c.fillRect(x - 0.0007, 0, 0.0012, 1);
    c.fillStyle = "rgba(255,240,212,.36)";
    c.fillRect(x + 0.00055, 0, 0.00048, 1);
  }
  for (const y of [0.095, 0.57, 0.935]) {
    c.fillStyle = "rgba(83,47,35,.16)";
    c.fillRect(0, y, 1, 0.0018);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createWing() {
  const group = new THREE.Group();
  group.name = "Speedwing";
  const sail = new THREE.Group();
  group.add(sail);
  const geometries = new Set(),
    materials = new Set(),
    textures = [];
  function mat(color, extra = {}) {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.82,
      ...extra,
    });
    materials.add(material);
    return material;
  }
  function mesh(parent, geometry, material) {
    geometries.add(geometry);
    const object = new THREE.Mesh(geometry, material);
    parent.add(object);
    return object;
  }
  const skins = [];
  const topTexture = clothTexture(true),
    bottomTexture = clothTexture(false);
  textures.push(topTexture, bottomTexture);
  const top = mat(0xffffff, { map: topTexture, side: THREE.DoubleSide });
  const bottom = mat(0xffffff, { map: bottomTexture, side: THREE.DoubleSide });
  const rib = mat(0xa53e24, { side: THREE.DoubleSide });
  const chamber = mat(0x472b2c, { side: THREE.DoubleSide });

  function surface(cols, rows, material, mapper, flip) {
    const positions = [],
      uv = [],
      indices = [];
    const morphs = [[], [], []];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const { p, s, t } = mapper(i / cols, j / rows);
        positions.push(p.x, p.y, p.z);
        uv.push((s + 1) * 0.5, 1 - t);
        const deltas = [
          brakeDelta(s, t, -1),
          brakeDelta(s, t, 1),
          trimDelta(t),
        ];
        deltas.forEach((d, k) => morphs[k].push(d.x, d.y, d.z));
        if (i < cols && j < rows) {
          const a = j * (cols + 1) + i,
            b = a + 1,
            d = a + cols + 1,
            e = d + 1;
          indices.push(...(flip ? [a, d, b, b, d, e] : [a, b, d, b, e, d]));
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(indices);
    geo.morphTargetsRelative = true;
    geo.morphAttributes.position = morphs.map(
      (m) => new THREE.Float32BufferAttribute(m, 3),
    );
    geo.computeVertexNormals();
    const skin = mesh(sail, geo, material);
    skins.push(skin);
  }
  for (const upper of [true, false]) {
    surface(
      cells * 6,
      26,
      upper ? top : bottom,
      (u, t) => {
        const s = u * 2 - 1;
        return { p: section(s, t, upper), s, t };
      },
      upper,
    );
  }
  // Chamber interiors are recessed behind the open intakes. Their lips and dividers
  // remain visible in an orbit even with a bright sky behind the translucent sail.
  surface(
    cells * 6,
    1,
    chamber,
    (u, v) => {
      const s = u * 2 - 1,
        t = 0.16;
      return { p: section(s, t, false).lerp(section(s, t, true), v), s, t };
    },
    false,
  );
  for (let i = 0; i <= cells; i++) {
    const s = (i * 2) / cells - 1,
      depth = i === 0 || i === cells ? 1 : 0.17;
    surface(
      9,
      1,
      rib,
      (u, v) => {
        const t = u * depth;
        return { p: section(s, t, false).lerp(section(s, t, true), v), s, t };
      },
      false,
    );
  }

  const ribs = skins.splice(3);
  const joinedRibs = mergeGeometries(ribs.map((part) => part.geometry));
  for (const part of ribs) {
    geometries.delete(part.geometry);
    part.geometry.dispose();
    part.removeFromParent();
  }
  skins.push(mesh(sail, joinedRibs, rib));

  const pilot = new THREE.Group();
  group.add(pilot);
  const suit = mat(0x303f46),
    seam = mat(0x526266),
    harness = mat(0x19252b);
  const jacket = mat(0xcc4a25),
    orange = mat(0xf87439),
    gloves = mat(0x263136);
  const shell = mat(0xeae6d3, { roughness: 0.42 }),
    visor = mat(0x253d49, { roughness: 0.24, metalness: 0.42 });
  const strap = mat(0x25292a);
  const sphere = new THREE.SphereGeometry(1, 18, 14);
  function ellipsoid(parent, material, x, y, z, sx, sy, sz) {
    const part = mesh(parent, sphere, material);
    part.position.set(x, y, z);
    part.scale.set(sx, sy, sz);
    return part;
  }
  const rodShape = new THREE.CylinderGeometry(1, 1, 1, 10);
  const direction = new THREE.Vector3();
  function connect(part, a, b, radius) {
    const d = direction.subVectors(b, a);
    part.position.copy(a).add(b).multiplyScalar(0.5);
    part.scale.set(radius, d.length(), radius);
    if (d.lengthSq() > 0.000001)
      part.quaternion.setFromUnitVectors(up, d.normalize());
  }
  function rod(parent, material, a, b, r) {
    const part = mesh(parent, rodShape, material);
    connect(part, a, b, r);
    return part;
  }
  const pack = ellipsoid(pilot, harness, 0, 0.22, 0.17, 0.23, 0.42, 0.16);
  pack.rotation.x = 0.18;
  ellipsoid(pilot, seam, 0, 0.24, 0.295, 0.133, 0.255, 0.052);
  const torso = ellipsoid(pilot, jacket, 0, 0.31, 0.028, 0.225, 0.31, 0.15);
  torso.rotation.x = 0.16;
  ellipsoid(pilot, harness, 0, 0.001, 0.048, 0.229, 0.18, 0.23);
  ellipsoid(pilot, suit, 0, 0.59, 0.048, 0.115, 0.105, 0.103);
  ellipsoid(pilot, shell, 0, 0.756, 0.05, 0.149, 0.17, 0.155);
  ellipsoid(pilot, visor, 0, 0.746, -0.041, 0.146, 0.09, 0.088);
  ellipsoid(pilot, harness, 0, 0.655, -0.02, 0.135, 0.047, 0.115);
  ellipsoid(pilot, orange, 0, 0.814, 0.175, 0.042, 0.068, 0.021);

  const hands = [];
  const bodyStrap = (a, b, r = 0.018) => rod(pilot, strap, a, b, r);
  for (const side of [-1, 1]) {
    const hip = vec(side * 0.112, -0.044, 0.025),
      knee = vec(side * 0.156, -0.28, -0.275),
      ankle = vec(side * 0.16, -0.585, -0.165);
    rod(pilot, suit, hip, knee, 0.094);
    ellipsoid(pilot, suit, knee.x, knee.y, knee.z, 0.096, 0.104, 0.105);
    rod(pilot, suit, knee, ankle, 0.073);
    ellipsoid(
      pilot,
      harness,
      ankle.x,
      ankle.y - 0.032,
      ankle.z - 0.052,
      0.082,
      0.076,
      0.135,
    );
    bodyStrap(
      vec(side * 0.157, 0.53, -0.02),
      vec(side * 0.071, 0.1, -0.127),
      0.026,
    );
    bodyStrap(vec(side * 0.083, 0.092, -0.128), vec(side * 0.21, 0.27, 0.024));
    bodyStrap(
      vec(side * 0.147, 0.53, 0.079),
      vec(side * 0.123, 0.27, 0.263),
      0.025,
    );
    bodyStrap(
      vec(side * 0.19, 0.22, 0.031),
      vec(side * 0.291, 0.72, -0.06),
      0.012,
    );
    const shoulder = vec(side * 0.177, 0.479, 0.02);
    const elbow = vec(side * 0.326, 0.375, -0.033);
    const hand = vec(side * 0.327, 0.665, -0.128);
    const arm = rod(pilot, jacket, shoulder, elbow, 0.068);
    const forearm = rod(pilot, suit, elbow, hand, 0.05);
    const joint = ellipsoid(
      pilot,
      jacket,
      elbow.x,
      elbow.y,
      elbow.z,
      0.068,
      0.067,
      0.066,
    );
    const glove = ellipsoid(
      pilot,
      gloves,
      hand.x,
      hand.y,
      hand.z,
      0.049,
      0.062,
      0.043,
    );
    const toggle = ellipsoid(
      pilot,
      orange,
      hand.x,
      hand.y + 0.03,
      hand.z,
      0.049,
      0.012,
      0.023,
    );
    hands.push({
      side,
      shoulder,
      elbow,
      hand,
      arm,
      forearm,
      joint,
      glove,
      toggle,
    });
  }

  // Bake the rigid pilot parts by material to keep the draw budget available for terrain.
  const moving = new Set(
    hands.flatMap((h) => [h.arm, h.forearm, h.joint, h.glove, h.toggle]),
  );
  const clusters = new Map();
  for (const part of [...pilot.children]) {
    if (moving.has(part)) continue;
    if (!clusters.has(part.material)) clusters.set(part.material, []);
    part.updateMatrix();
    clusters
      .get(part.material)
      .push(part.geometry.clone().applyMatrix4(part.matrix));
    part.removeFromParent();
  }
  for (const [material, parts] of clusters) {
    mesh(pilot, mergeGeometries(parts), material);
    for (const part of parts) part.dispose();
  }

  // Two- and three-level cascades radiate from compact risers instead of running
  // a separate full-length line from every cell directly to the pilot.
  const suspension = [],
    brakes = [];
  function anchor(s, t) {
    return {
      base: section(s, t, false),
      l: brakeDelta(s, t, -1),
      r: brakeDelta(s, t, 1),
      trim: trimDelta(t),
    };
  }
  for (const handRig of hands) {
    const side = handRig.side;
    for (const [row, t] of [0.17, 0.55].entries()) {
      const lower = vec(side * (0.29 + row * 0.014), 0.72, -0.072 + row * 0.04);
      for (let bundle = 0; bundle < 2; bundle++) {
        const upper = vec(
          side * (0.72 + bundle * 0.82),
          2.1 + bundle * 0.08,
          -0.17 + row * 0.23,
        );
        suspension.push([lower, upper]);
        for (let k = 0; k < 3; k++) {
          const span = ((1 + bundle * 6 + k * 2) / cells) * 2;
          suspension.push([upper, anchor(side * span, t)]);
        }
      }
    }
    const fork = vec(side * 1.22, 2.43, 0.43);
    brakes.push([handRig.hand, fork]);
    for (const s of [0.33, 0.54, 0.76, 0.935])
      brakes.push([fork, anchor(side * s, 0.97)]);
  }
  function lineSet(pairs, color, opacity) {
    const geo = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(
      new Float32Array(pairs.length * 6),
      3,
    );
    attribute.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", attribute);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    geometries.add(geo);
    materials.add(material);
    const lines = new THREE.LineSegments(geo, material);
    lines.frustumCulled = false;
    group.add(lines);
    return { attribute, pairs };
  }
  const lineSets = [
    lineSet(suspension, 0x362e2e, 0.61),
    lineSet(brakes, 0xa84a2c, 0.76),
  ];
  const scratch = new THREE.Vector3();
  function update(
    left = 0,
    right = 0,
    trim = 0,
    time = 0,
    bank = 0,
    canopyLead = 0,
    weight = 0,
  ) {
    const l = clamp(left, 0, 1),
      r = clamp(right, 0, 1),
      tr = clamp(trim, 0, 1);
    sail.position.set(
      0.023 * Math.sin(time * 1.13),
      0.025 * Math.sin(time * 1.9),
      0.018 * Math.cos(time * 1.7),
    );
    sail.rotation.z = -canopyLead;
    for (const skin of skins) {
      skin.morphTargetInfluences[0] = l;
      skin.morphTargetInfluences[1] = r;
      skin.morphTargetInfluences[2] = tr;
    }
    for (const h of hands) {
      const pull = h.side < 0 ? l : r;
      h.elbow.set(h.side * (0.333 + 0.041 * pull), 0.4 - 0.12 * pull, -0.035);
      h.hand.set(
        h.side * (0.327 - 0.056 * pull),
        0.694 - 0.42 * pull,
        -0.116 - 0.022 * pull,
      );
      connect(h.arm, h.shoulder, h.elbow, 0.068);
      connect(h.forearm, h.elbow, h.hand, 0.05);
      h.joint.position.copy(h.elbow);
      h.glove.position.copy(h.hand);
      h.toggle.position.copy(h.hand);
      h.toggle.position.y += 0.03;
    }
    pilot.rotation.z = 0.032 * Math.sin(bank) - 0.22 * weight;
    for (const set of lineSets) {
      let index = 0;
      for (const pair of set.pairs)
        for (const end of pair) {
          if (end.base)
            scratch
              .copy(end.base)
              .addScaledVector(end.l, l)
              .addScaledVector(end.r, r)
              .addScaledVector(end.trim, tr)
              .applyQuaternion(sail.quaternion)
              .add(sail.position);
          else scratch.copy(end);
          set.attribute.setXYZ(index++, scratch.x, scratch.y, scratch.z);
        }
      set.attribute.needsUpdate = true;
    }
  }
  update();
  function dispose() {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    group.removeFromParent();
  }
  return { group, canopy: sail, update, dispose };
}

// Local first-person rig. Its origin is the camera eye, looking down -Z.
export function createCockpit() {
  const group = new THREE.Group();
  group.name = "Pilot hands and risers";
  const materials = [],
    geometries = [];
  const material = (color, extra = {}) => {
    const result = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.87,
      ...extra,
    });
    materials.push(result);
    return result;
  };
  const glove = material(0x262c31),
    leather = material(0x41474a);
  const seam = material(0x565b59),
    orange = material(0xdf5126),
    cuff = material(0x303539);
  const toggle = material(0xf77e35),
    brass = material(0x96948a, { metalness: 0.65, roughness: 0.37 });
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#51504a";
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 4) {
    ctx.fillStyle = y % 8 ? "#5b5a53" : "#64625a";
    ctx.fillRect(3, y, 58, 1);
  }
  for (let x = 3; x < 64; x += 4) {
    ctx.fillStyle = "rgba(19,23,25,.26)";
    ctx.fillRect(x, 0, 1, 128);
  }
  ctx.fillStyle = "#998c73";
  for (let y = 0; y < 128; y += 13)
    for (const x of [6, 56]) ctx.fillRect(x, y, 2, 7);
  const weave = new THREE.CanvasTexture(canvas);
  weave.colorSpace = THREE.SRGBColorSpace;
  weave.wrapT = THREE.RepeatWrapping;
  weave.anisotropy = 4;
  const webbing = material(0xffffff, { map: weave, side: THREE.DoubleSide });
  const plainWebbing = material(0x333632, { side: THREE.DoubleSide });
  const mainLine = new THREE.LineBasicMaterial({
    color: 0x534c42,
    transparent: true,
    opacity: 0.85,
  });
  const controlLine = new THREE.LineBasicMaterial({ color: 0xd26f37 });
  materials.push(mainLine, controlLine);
  function addMesh(parent, geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    geometries.push(geo);
    return m;
  }
  function oval(parent, mat, p, scale, tilt = 0) {
    const o = addMesh(parent, new THREE.SphereGeometry(1, 16, 12), mat);
    o.position.copy(p);
    o.scale.copy(scale);
    o.rotation.z = tilt;
    return o;
  }
  function tube(parent, mat, points, radius) {
    const path = new THREE.CatmullRomCurve3(points);
    return addMesh(
      parent,
      new THREE.TubeGeometry(
        path,
        Math.max(10, points.length * 4),
        radius,
        7,
        false,
      ),
      mat,
    );
  }
  function ribbon(parent, mat, points, width) {
    const curve = new THREE.CatmullRomCurve3(points);
    const positions = [],
      uv = [],
      index = [];
    for (let i = 0; i <= 18; i++) {
      const p = curve.getPoint(i / 18);
      positions.push(
        p.x - width / 2,
        p.y,
        p.z,
        p.x + width / 2,
        p.y,
        p.z + width * 0.14,
      );
      uv.push(0, i / 4, 1, i / 4);
      if (i < 18) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    return addMesh(parent, g, mat);
  }
  function metalRing(parent, center, width, height, angle = 0) {
    const ring = addMesh(
      parent,
      new THREE.TorusGeometry(1, 0.16, 6, 18),
      brass,
    );
    ring.position.copy(center);
    ring.scale.set(width, height, width);
    ring.rotation.z = angle;
  }
  function consolidate(parent) {
    const byMaterial = new Map();
    for (const object of [...parent.children]) {
      if (!object.isMesh) continue;
      object.updateMatrix();
      const geo = object.geometry.clone().applyMatrix4(object.matrix);
      if (!byMaterial.has(object.material)) byMaterial.set(object.material, []);
      byMaterial.get(object.material).push(geo);
      object.removeFromParent();
    }
    for (const [mat, parts] of byMaterial) {
      addMesh(parent, mergeGeometries(parts), mat);
      for (const g of parts) g.dispose();
    }
  }
  const sides = [];
  for (const side of [-1, 1]) {
    const base = new THREE.Group(),
      grip = new THREE.Group(),
      riser = new THREE.Group();
    group.add(base);
    base.add(grip, riser);
    // Sleeve tapers from the forearm coming into frame up to a separate elastic wrist.
    tube(
      grip,
      orange,
      [
        vec(0.118, -0.29, 0.19),
        vec(0.094, -0.213, 0.145),
        vec(0.048, -0.134, 0.082),
        vec(0.012, -0.069, 0.027),
      ],
      0.051,
    );
    oval(grip, cuff, vec(0.017, -0.071, 0.031), vec(0.046, 0.031, 0.045), 0.4);
    oval(
      grip,
      glove,
      vec(0.001, -0.011, 0.001),
      vec(0.045, 0.063, 0.029),
      -0.13,
    );
    oval(
      grip,
      leather,
      vec(0.009, -0.009, 0.022),
      vec(0.032, 0.041, 0.012),
      -0.13,
    );
    // The exposed tops of the folded fingers wrap the orange brake toggle.
    for (let i = 0; i < 4; i++) {
      const x = -0.031 + i * 0.017;
      const y = 0.038 - Math.abs(i - 1) * 0.005;
      tube(
        grip,
        glove,
        [
          vec(x, y - 0.021, 0.017),
          vec(x + 0.002, y + 0.01, 0.009),
          vec(x, y + 0.005, -0.011),
          vec(x - 0.001, y - 0.012, -0.02),
        ],
        0.0092,
      );
      oval(grip, leather, vec(x, y + 0.002, 0.016), vec(0.0073, 0.012, 0.0054));
    }
    tube(
      grip,
      glove,
      [
        vec(-0.019, -0.029, 0.008),
        vec(-0.042, -0.009, 0.009),
        vec(-0.047, 0.015, -0.007),
        vec(-0.034, 0.022, -0.018),
      ],
      0.013,
    );
    tube(
      grip,
      seam,
      [
        vec(0.01, -0.039, 0.029),
        vec(0.023, -0.018, 0.032),
        vec(0.024, 0.012, 0.023),
      ],
      0.00115,
    );
    tube(
      grip,
      toggle,
      [
        vec(-0.036, 0.022, -0.011),
        vec(-0.044, 0.056, -0.016),
        vec(-0.019, 0.098, -0.018),
        vec(0.004, 0.095, -0.02),
        vec(0.033, 0.058, -0.018),
        vec(0.028, 0.018, -0.013),
        vec(-0.032, 0.021, -0.013),
      ],
      0.0057,
    );
    consolidate(grip);
    // Distinct riser groups and soft links converge to a common hang point below frame.
    ribbon(
      riser,
      webbing,
      [
        vec(0.05, -0.46, 0.09),
        vec(0.045, -0.18, -0.015),
        vec(0.073, 0.066, -0.059),
        vec(0.106, 0.244, -0.085),
      ],
      0.019,
    );
    ribbon(
      riser,
      plainWebbing,
      [
        vec(0.05, -0.445, 0.071),
        vec(0.069, -0.133, -0.027),
        vec(0.105, 0.103, -0.088),
        vec(0.127, 0.224, -0.114),
      ],
      0.014,
    );
    metalRing(riser, vec(0.108, 0.252, -0.086), 0.0095, 0.017, -0.22);
    metalRing(riser, vec(0.129, 0.233, -0.115), 0.008, 0.015, -0.24);
    metalRing(riser, vec(0.073, 0.085, -0.055), 0.009, 0.012, -0.12);
    const links = [];
    for (let i = 0; i < 8; i++) {
      const origin =
        i % 2 ? vec(0.108, 0.266, -0.087) : vec(0.129, 0.247, -0.115);
      const split = vec(
        origin.x + (i - 3) * 0.021,
        0.47 + i * 0.008,
        origin.z - 0.025 * i,
      );
      links.push(
        origin,
        split,
        split,
        vec(split.x + (i - 3) * 0.071, 1.18, split.z - 0.13),
      );
    }
    const fixedGeo = new THREE.BufferGeometry().setFromPoints(links);
    geometries.push(fixedGeo);
    riser.add(new THREE.LineSegments(fixedGeo, mainLine));
    consolidate(riser);
    const brakeGeo = new THREE.BufferGeometry();
    const linePoints = new THREE.BufferAttribute(
      new Float32Array(12),
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    brakeGeo.setAttribute("position", linePoints);
    geometries.push(brakeGeo);
    const line = new THREE.Line(brakeGeo, controlLine);
    line.frustumCulled = false;
    base.add(line);
    sides.push({ side, base, riser, grip, linePoints, pull: 0 });
  }
  let previousTime;
  function update(
    left = 0,
    right = 0,
    trim = 0,
    time = 0,
    aspect = 1.75,
    fov = 55,
  ) {
    const dt =
      previousTime === undefined ? 1 / 60 : clamp(time - previousTime, 0, 0.05);
    previousTime = time;
    const smooth = 1 - Math.exp(-dt * 18);
    const rigScale = clamp(aspect / 1.12, 0.53, 1);
    const offset = Math.max(
      0.08,
      0.74 * Math.tan(THREE.MathUtils.degToRad(fov * 0.5)) * aspect * 0.72,
    );
    for (const state of sides) {
      const { side, base, grip, riser, linePoints } = state;
      state.pull +=
        (clamp(side < 0 ? left : right, 0, 1) - state.pull) * smooth;
      const pull = state.pull;
      base.position.set(side * offset, -0.015 - (fov - 55) * 0.0034, -0.74);
      base.scale.set(side * rigScale, rigScale, rigScale);
      const airborne = Math.sin(time * 1.87 + side * 0.35);
      grip.position.set(
        -0.008 - 0.03 * pull + 0.004 * Math.sin(time * 1.33 + side),
        (-0.115 - 0.138 * pull) / rigScale + 0.0035 * airborne,
        0.024 * pull,
      );
      grip.rotation.z = 0.09 + 0.13 * pull + 0.012 * airborne;
      grip.rotation.x = -0.13 * pull;
      riser.rotation.z = 0.01 * airborne;
      riser.position.y = -0.025 * clamp(trim, 0, 1);
      const knot = vec(-0.009, 0.1, -0.018)
        .applyQuaternion(grip.quaternion)
        .add(grip.position);
      const pulley = vec(0.073, 0.085, -0.055)
        .applyQuaternion(riser.quaternion)
        .add(riser.position);
      linePoints.setXYZ(0, knot.x, knot.y, knot.z);
      linePoints.setXYZ(
        1,
        (knot.x + pulley.x) * 0.5 - 0.009 * (1 - pull),
        (knot.y + pulley.y) * 0.5,
        (knot.z + pulley.z) * 0.5,
      );
      linePoints.setXYZ(2, pulley.x, pulley.y, pulley.z);
      linePoints.setXYZ(3, 0.205, 1.22, -0.17);
      linePoints.needsUpdate = true;
    }
  }
  update();
  function dispose() {
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
    weave.dispose();
    group.removeFromParent();
  }
  return { group, update, dispose };
}
