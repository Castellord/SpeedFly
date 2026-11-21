import * as THREE from "three";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fade = (t) => t * t * (3 - 2 * t);
const smooth = (lo, hi, x) => fade(clamp((x - lo) / (hi - lo), 0, 1));
const mix = (a, b, t) => a + (b - a) * t;
const sunlight = new THREE.Vector3(-0.64, 0.72, -0.26).normalize();

function randomSource(seed) {
  let state = 2166136261;
  for (const c of String(seed))
    state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let a = Math.imul(state ^ (state >>> 15), 1 | state);
    a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseSource(rng) {
  const table = Float32Array.from({ length: 65536 }, rng);
  return (x, z) => {
    const ix = Math.floor(x),
      iz = Math.floor(z);
    const a = fade(x - ix),
      b = fade(z - iz);
    const a0 = ix & 255,
      a1 = (ix + 1) & 255;
    const b0 = (iz & 255) << 8,
      b1 = ((iz + 1) & 255) << 8;
    return mix(
      mix(table[b0 + a0], table[b0 + a1], a),
      mix(table[b1 + a0], table[b1 + a1], a),
      b,
    );
  };
}

// A small seamless, mipmapped material atlas. It provides metre-scale granite,
// scree and grass detail without network assets or per-fragment noise loops.
function groundAtlas(rng) {
  const size = 256;
  const scales = [4, 8, 16, 32, 64, 128, 256].map((n) => {
    const samples = Float32Array.from({ length: n * n }, rng);
    return (u, v) => {
      const x = u * n,
        y = v * n,
        ix = Math.floor(x),
        iy = Math.floor(y);
      const a = fade(x - ix),
        b = fade(y - iy),
        mask = n - 1;
      const i = ix & mask,
        j = (ix + 1) & mask;
      return mix(
        mix(samples[(iy & mask) * n + i], samples[(iy & mask) * n + j], a),
        mix(
          samples[((iy + 1) & mask) * n + i],
          samples[((iy + 1) & mask) * n + j],
          a,
        ),
        b,
      );
    };
  });
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const n = scales.map((sample) => sample(u, v));
      const i = (y * size + x) * 4;
      bytes[i] =
        255 *
        (n[0] * 0.3 + n[1] * 0.27 + n[2] * 0.21 + n[3] * 0.13 + n[4] * 0.09);
      bytes[i + 1] =
        255 *
        (n[2] * 0.35 + n[3] * 0.26 + n[4] * 0.19 + n[5] * 0.12 + n[6] * 0.08);
      bytes[i + 2] = 255 * (1 - Math.abs(n[1] * 0.63 + n[2] * 0.37 - 0.5) * 2);
      bytes[i + 3] = 255;
    }
  const map = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

let photos;
function loadPhotos() {
  if (typeof document === "undefined") return [];
  if (!photos) {
    const base = import.meta.env?.BASE_URL || "./";
    const loader = new THREE.TextureLoader();
    photos = ["meadow", "cliff"].map((name) =>
      loader
        .loadAsync(base + "assets/" + name + ".jpg")
        .then((texture) => {
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.anisotropy = 8;
          // The terrain shader grades these source sRGB values before lighting.
          texture.colorSpace = THREE.NoColorSpace;
          return texture;
        })
        .catch(() => null),
    );
  }
  return photos;
}

function landMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        atlas: { value: null },
        sun: { value: sunlight },
        time: { value: 0 },
        meadowPhoto: { value: null },
        cliffPhoto: { value: null },
        haveMeadow: { value: 0 },
        haveCliff: { value: 0 },
      },
    ]),
    vertexShader: `
      #include <fog_pars_vertex>
      attribute vec4 habitat;
      varying vec3 pos;
      varying vec3 slope;
      varying vec4 env;
      void main() {
        env = habitat;
        pos = position;
        slope = normal;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform sampler2D atlas;
      uniform sampler2D meadowPhoto;
      uniform sampler2D cliffPhoto;
      uniform float haveMeadow;
      uniform float haveCliff;
      uniform vec3 sun;
      uniform float time;
      varying vec3 pos;
      varying vec3 slope;
      varying vec4 env;
      const vec3 luma = vec3(.27,.55,.18);
      vec3 granite(vec3 p, vec3 w) {
        return texture2D(cliffPhoto,p.zy).rgb*w.x + texture2D(cliffPhoto,p.xz).rgb*w.y
             + texture2D(cliffPhoto,p.xy).rgb*w.z;
      }
      void main() {
        vec3 n = normalize(slope);
        vec3 face = normalize(cross(dFdx(pos), dFdy(pos)));
        n = normalize(mix(n, face, .25));
        // Slanted projections keep cliff faces textured even on vertical rock.
        vec2 uv = pos.xz + pos.y * vec2(.52, -.83);
        vec3 broad = texture2D(atlas, uv / 750.).rgb;
        vec3 rock = texture2D(atlas, vec2(pos.x * .81 - pos.z * .55, pos.y * 2.6 + pos.z * .3) / 120.).rgb;
        vec3 flake = texture2D(atlas, uv / 27.).rgb;
        float mottling = broad.r - .5;
        float fine = flake.g - .5;
        float relief = env.x;
        float steep = 1. - max(n.y, 0.);
        float mineral = smoothstep(.12, .36, steep + mottling * .19 + relief * .00009);
        float trees = env.y * smoothstep(-.12, .08, mottling + env.y * .13);
        vec3 meadow = mix(vec3(.49,.52,.30), vec3(.65,.62,.42), broad.g);
        meadow = mix(meadow, vec3(.255,.335,.245), trees * .77);
        meadow += mottling * vec3(.32,.27,.20) + fine * .09;
        vec3 stone = mix(vec3(.355,.385,.404), vec3(.61,.575,.518), broad.r + mottling * .70);
        float fissure = smoothstep(.63, .94, rock.b) * smoothstep(.46, .78, rock.r);
        float seam = texture2D(atlas, vec2(pos.x * .33 + pos.z*.63, pos.y*2.1+pos.x*.27+pos.z*.43) / 47.).r;
        stone += (rock.g-.5) * .34 + fine*.19 - fissure*.155 + (seam-.5)*.13;
        float reliefDetail = 0.;
        if(haveMeadow > .5 && mineral < .99) {
          mat2 twist = mat2(.83,.557,-.557,.83);
          vec3 small = texture2D(meadowPhoto,pos.xz/14.8 + broad.rg*.19).rgb;
          vec3 pasture = texture2D(meadowPhoto,twist*pos.xz/107. + broad.gb*.37).rgb;
          vec3 photo = mix(small,pasture,.47);
          float tone = dot(photo,luma);
          vec3 pigment = mix(vec3(.36,.39,.24),vec3(.68,.67,.46),clamp(tone*1.65,0.,1.));
          meadow = mix(meadow,pigment,.57) * (.40 + tone*1.45);
          meadow += (photo-vec3(tone))*.36 + mottling*.12;
          meadow *= 1.-trees*.22;
          reliefDetail += (dot(small,luma)*.8 + dot(pasture,luma)*2.) * (1.-mineral);
        }
        vec3 cliffGrain = rock;
        if(haveCliff > .5 && mineral > .01) {
          vec3 weights=pow(abs(n),vec3(4.));
          weights/=max(.001,weights.x+weights.y+weights.z);
          vec3 block = granite(pos*vec3(.89,1.16,.96)/143. + vec3(broad.rg,broad.b)*.31,weights);
          vec3 chip = granite(pos*vec3(1.,1.28,.82)/26. + vec3(broad.b,broad.r,broad.g)*.19,weights);
          cliffGrain = mix(block,chip,.37);
          float tone=dot(cliffGrain,luma);
          stone = stone*(.42+tone*1.47) + (cliffGrain-vec3(tone))*.52;
          reliefDetail += (dot(block,luma)*12. + dot(chip,luma)*1.7)*mineral;
        }
        vec3 surface = mix(meadow, stone, mineral);
        // Snow follows local shelter and the rock's fissures, leaving bands
        // of exposed strata even on the alpine faces beyond the course.
        float exposure = pos.y - 1540. + relief*.30 - n.x * 181. - n.z * 94.;
        float snow = smoothstep(-24., 45., exposure - steep*1080. + mottling*620.
                        + (rock.r-.5)*165. + (dot(cliffGrain,luma)-.46)*210.);
        vec3 ice = mix(vec3(.74,.80,.82), vec3(.985,.98,.95), broad.g + fine*.21 + rock.g*.11);
        surface = mix(surface, ice, snow);
        reliefDetail *= 1.-snow*.94;
        float width = 4.8 + 1.8*sin(pos.z*.0084) + 1.2*sin(pos.z*.019);
        float channel = abs(env.z + (flake.r-.5)*1.5) / width;
        float river = 1.-smoothstep(.78,1.06,channel);
        float riparian = 1.-smoothstep(.85,3.5,channel);
        surface = mix(surface, mix(vec3(.43,.44,.39),vec3(.66,.64,.54),flake.g), riparian*.84);
        float ripple = texture2D(atlas, vec2(pos.x*.075, pos.z*.028+time*.038)).g;
        vec3 water = mix(vec3(.28,.44,.46),vec3(.71,.78,.77),smoothstep(.43,.72,ripple));
        surface = mix(surface,water,river);
        // Surface-gradient bump from the same stone and turf albedos.
        vec3 dpdx=dFdx(pos), dpdy=dFdy(pos);
        vec3 tangentX=cross(dpdy,n), tangentY=cross(n,dpdx);
        float det=dot(dpdx,tangentX);
        vec3 grad=(dFdx(reliefDetail)*tangentX+dFdy(reliefDetail)*tangentY) * sign(det);
        n=normalize(n - clamp(grad/max(abs(det),.0001),vec3(-.55),vec3(.55))*(1.-river));
        float diffuse = max(dot(n,sun),0.);
        float light = .70 + diffuse*.39;
        vec3 lit = surface * light * mix(vec3(.84,.90,.99),vec3(1.055,1.02,.965),diffuse);
        lit *= mix(vec3(.70,.76,.86),vec3(1.),env.w);
        gl_FragColor = vec4(pow(max(lit,vec3(.001)),vec3(2.2)),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// Two original spruce silhouettes are projected from branching whorls. Three
// intersecting cutout planes keep the crown airy at a distance as well as at
// flight altitude. Mipmapping integrates the finer sprays into dense foliage.
function spruceAtlas() {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d");
  for (let variant = 0; variant < 2; variant++) {
    const rng = randomSource(9437 + variant * 247);
    const px = (x) => variant * 256 + 128 + x * 484,
      py = (y) => 503 - y * 491;
    const lean = (y) => 0.011 * Math.sin(y * 4.3 + variant) * y;
    ctx.save();
    ctx.beginPath();
    ctx.rect(variant * 256, 0, 256, 512);
    ctx.clip();
    ctx.fillStyle = "#5a5243";
    ctx.beginPath();
    ctx.moveTo(px(-0.009), py(0));
    ctx.lineTo(px(0.009), py(0));
    ctx.lineTo(px(lean(1)), py(1));
    ctx.fill();
    const boughs = [];
    for (let tier = 0; tier < 21; tier++) {
      const y = 0.18 + tier * 0.0404;
      const count = 4 + (tier % 3);
      for (let j = 0; j < count; j++) {
        const az = (j * 2 * Math.PI) / count + tier * 2.27 + rng() * 0.31;
        const length = 0.229 * Math.pow(1 - y, 0.67) * (0.64 + rng() * 0.49);
        boughs.push({ y, az, length, z: Math.sin(az) * length });
      }
    }
    boughs.sort((a, b) => a.z - b.z);
    for (const { y, az, length } of boughs) {
      const dx = Math.cos(az),
        dz = Math.sin(az),
        root = lean(y);
      const day = 0.4 + 0.35 * Math.max(0, -dx) + 0.21 * Math.max(0, dz);
      const ink = (bright, warm) =>
        "rgb(" +
        Math.round(34 + bright * 42 + warm * 5) +
        "," +
        Math.round(50 + bright * 43 + warm * 3) +
        "," +
        Math.round(42 + bright * 33) +
        ")";
      function xy(t) {
        return [
          root + dx * length * t,
          y - length * (0.38 * Math.sin(t * 2.4) + t * 0.018),
        ];
      }
      const tip = xy(1);
      ctx.strokeStyle = ink(0.18 + day * 0.47, 0);
      ctx.lineWidth = 1.1 + length * 8;
      ctx.beginPath();
      ctx.moveTo(px(root), py(y));
      ctx.quadraticCurveTo(
        px(root + dx * length * 0.52),
        py(y - length * 0.32),
        px(tip[0]),
        py(tip[1]),
      );
      ctx.stroke();
      for (let j = 1; j <= 18; j++) {
        const u = j / 19,
          [x, h] = xy(u);
        for (const side of [-1, 1]) {
          const spread = length * (0.42 - 0.28 * u) * (0.68 + rng() * 0.47);
          const lateral = -dz * side * spread,
            forward = dx * spread * 0.85;
          const ex = x + lateral + forward,
            eh = h - spread * (0.5 + rng() * 0.63);
          ctx.fillStyle = ink(
            day * (0.57 + 0.3 * u) + rng() * 0.16,
            dx < 0 ? 1 : 0,
          );
          ctx.beginPath();
          ctx.moveTo(px(x), py(h + 0.003));
          ctx.lineTo(
            px(x + lateral * 0.74 + forward * 0.34),
            py(h - spread * 0.18),
          );
          ctx.lineTo(px(ex), py(eh));
          ctx.lineTo(px(x + forward * 0.54), py(h - spread * 0.29));
          ctx.closePath();
          ctx.fill();
          ctx.lineWidth = 0.72;
          for (let k = 1; k < 5; k++) {
            const f = k * 0.18,
              nx = x + (ex - x) * f,
              nh = mix(h, eh, f);
            ctx.strokeStyle = ink(
              day * (0.71 + 0.31 * u) + rng() * 0.27,
              dx < 0 ? 1 : 0,
            );
            ctx.beginPath();
            ctx.moveTo(px(nx), py(nh));
            ctx.lineTo(
              px(nx + (dx * 0.13 - side * dz * 0.16) * spread),
              py(nh - spread * (0.21 + rng() * 0.21)),
            );
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

function makeSpruce() {
  const positions = [],
    uvs = [],
    indices = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI) / 3;
    const dx = Math.cos(angle) * 0.267,
      dz = Math.sin(angle) * 0.267;
    const first = i * 4,
      left = (i % 2) * 0.5;
    positions.push(-dx, 0, -dz, dx, 0, dz, dx, 1.045, dz, -dx, 1.045, -dz);
    uvs.push(left, 0, left + 0.5, 0, left + 0.5, 1, left, 1);
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

function gridAxis(lo, hi, closeLo, closeHi) {
  const axis = [];
  for (
    let v = lo;
    v < hi;
    v += 13 + Math.min(125, Math.max(closeLo - v, v - closeHi, 0) * 0.02)
  )
    axis.push(v);
  axis.push(hi);
  return axis;
}

function cell(axis, v) {
  let lo = 0,
    hi = axis.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (v < axis[mid]) hi = mid;
    else lo = mid;
  }
  return lo;
}

export function createWorld(scene, seed) {
  const rng = randomSource(seed),
    noise = noiseSource(rng);
  const phase = rng() * Math.PI * 2,
    phase2 = rng() * Math.PI * 2;
  const center = (z) =>
    122 * (Math.sin(z / 875 + phase) - Math.sin(phase)) +
    47 * (Math.sin(z / 410 + phase2) - Math.sin(phase2));
  const river = (z) =>
    center(z) -
    107 +
    40 * Math.sin(z / 170 + phase) +
    15 * Math.sin(z / 68 + phase2);
  const floor = (z) =>
    1300 + 0.32 * clamp(z, -3400, 500) + clamp(z + 3400, -2300, 0) * 0.055;
  const peaks = [];
  function peak(x, z, h, rx, rz) {
    const angle = (rng() - 0.5) * 1.65;
    peaks.push({ x, z, h, rx, rz, cos: Math.cos(angle), sin: Math.sin(angle) });
  }
  for (const side of [-1, 1]) {
    for (let band = 0; band < 3; band++) {
      for (let z = -11200; z < 6700; z += 650 + rng() * 700) {
        const dist =
          band === 0
            ? 1280 + rng() * 850
            : 2850 + (band - 1) * 2300 + rng() * 1100;
        const h = (band === 0 ? 980 : 1670) + rng() * (band === 0 ? 930 : 1050);
        peak(
          center(z) + side * dist,
          z,
          h,
          h * (0.95 + rng() * 0.45),
          h * (0.84 + rng() * 0.47),
        );
      }
    }
  }
  for (let z = -11400; z < -4950; z += 1650) {
    for (let x = -3200; x <= 3200; x += 860 + rng() * 440) {
      const h = 1650 + rng() * 1300;
      peak(
        x + (rng() - 0.5) * 450,
        z + (rng() - 0.5) * 700,
        h,
        h * (0.75 + rng() * 0.37),
        h * (0.78 + rng() * 0.44),
      );
    }
  }
  // Populate z buckets once, keeping generation fast when changing lines.
  const buckets = new Map();
  for (const p of peaks) {
    const span = Math.max(p.rx, p.rz) * 1.35 + 350;
    for (
      let k = Math.floor((p.z - span) / 500);
      k <= Math.floor((p.z + span) / 500);
      k++
    ) {
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    }
  }
  function rawHeight(x, z) {
    const valley = Math.abs(x - center(z));
    const close = smooth(68, 1110, valley);
    const closure = smooth(4110, 5990, -z);
    const mass = Math.max(close, closure);
    const warpX =
      (noise(x / 675, z / 675) - 0.5) * 260 +
      (noise(x / 201 + 32, z / 201) - 0.5) * 57;
    const warpZ =
      (noise(x / 743 + 17, z / 743) - 0.5) * 240 +
      (noise(x / 211, z / 211 + 7) - 0.5) * 67;
    let mountain = 0;
    for (const p of buckets.get(Math.floor(z / 500)) || []) {
      const dx = x + warpX - p.x,
        dz = z + warpZ - p.z;
      const a = Math.abs(dx * p.cos + dz * p.sin) / p.rx;
      const b = Math.abs(dz * p.cos - dx * p.sin) / p.rz;
      const d = Math.max(a + b * 0.37, b + a * 0.34);
      mountain = Math.max(mountain, p.h * (1 - d));
    }
    const basin = noise(x / 620, z / 620);
    const hills = 32 + basin * 220;
    let land = Math.max(mountain, hills);
    const ridge =
      1 -
      Math.abs(2 * noise(x / 316 + warpX * 0.003, z / 342 + warpZ * 0.003) - 1);
    land +=
      (ridge - 0.63) * 180 +
      (noise(x / 113, z / 113) - 0.5) * 89 +
      (noise(x / 48, z / 48) - 0.5) * 29;
    const fold = noise(x / 590 + warpZ * 0.003, z / 153 + warpX * 0.004);
    const cleft = 1 - Math.abs(fold * 2 - 1);
    land -= Math.pow(cleft, 4) * 105 * smooth(195, 880, mountain);
    const lowland =
      (noise(x / 171, z / 171) - 0.5) * 24 + (noise(x / 65, z / 65) - 0.5) * 5;
    const bed = river(z) - x;
    return (
      floor(z) +
      land * mass +
      lowland * (1 - 0.55 * mass) -
      5 * Math.exp((-bed * bed) / 710) * (1 - closure)
    );
  }
  const world = new THREE.Group();
  scene.add(world);
  const xs = gridAxis(-9100, 9100, -1540, 1540),
    zs = gridAxis(-12000, 5600, -4110, 490);
  const w = xs.length,
    h = zs.length,
    count = w * h;
  const pos = new Float32Array(count * 3),
    env = new Float32Array(count * 4),
    heights = new Float32Array(count);
  const index = new Uint32Array((w - 1) * (h - 1) * 6);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const id = j * w + i,
        x = xs[i],
        z = zs[j],
        y = rawHeight(x, z);
      pos[id * 3] = x;
      pos[id * 3 + 1] = heights[id] = y;
      pos[id * 3 + 2] = z;
      env[id * 4] = y - floor(z);
      env[id * 4 + 2] = z < -4730 ? 1000 : x - river(z);
      if (i === w - 1 || j === h - 1) continue;
      const at = (j * (w - 1) + i) * 6;
      index.set([id, id + w, id + 1, id + 1, id + w, id + w + 1], at);
    }
  function height(x, z) {
    if (x < xs[0] || x > xs[w - 1] || z < zs[0] || z > zs[h - 1])
      return rawHeight(x, z);
    const i = cell(xs, x),
      j = cell(zs, z),
      a = (x - xs[i]) / (xs[i + 1] - xs[i]),
      b = (z - zs[j]) / (zs[j + 1] - zs[j]);
    const id = j * w + i;
    if (a + b < 1)
      return (
        heights[id] +
        a * (heights[id + 1] - heights[id]) +
        b * (heights[id + w] - heights[id])
      );
    const t = heights[id + w + 1];
    return (
      t + (1 - a) * (heights[id + w] - t) + (1 - b) * (heights[id + 1] - t)
    );
  }
  const land = new THREE.BufferGeometry();
  land.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  land.setIndex(new THREE.BufferAttribute(index, 1));
  land.computeVertexNormals();
  const normals = land.getAttribute("normal").array;
  const forest = (x, z, y, ny) => {
    const grove =
      noise(x / 205 + 21, z / 205) * 0.8 + noise(x / 64, z / 64) * 0.2;
    const riverGrove = 0.22 * (1 - smooth(28, 155, Math.abs(x - river(z))));
    return (
      smooth(0.34, 0.68, grove + riverGrove) *
      (1 - smooth(1390, 1860, y)) *
      smooth(0.63, 0.88, ny) *
      smooth(9, 22, Math.abs(x - river(z)))
    );
  };
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const id = j * w + i,
        x = xs[i],
        z = zs[j],
        y = heights[id];
      env[id * 4 + 1] = forest(x, z, y, normals[id * 3 + 1]);
      let obstruction = -1;
      for (const dist of [55, 135, 300, 650, 1220, 2170]) {
        const sx = x + sunlight.x * dist,
          sz = z + sunlight.z * dist;
        if (sx <= xs[0] || sz <= zs[0]) break;
        obstruction = Math.max(obstruction, (height(sx, sz) - y) / dist);
      }
      env[id * 4 + 3] =
        1 - smooth(sunlight.y - 0.11, sunlight.y + 0.1, obstruction);
    }
  land.setAttribute("habitat", new THREE.BufferAttribute(env, 4));
  const atlas = groundAtlas(rng),
    material = landMaterial();
  material.uniforms.atlas.value = atlas;
  let disposed = false;
  loadPhotos().forEach((task, i) =>
    task.then((texture) => {
      if (disposed || !texture) return;
      material.uniforms[i === 0 ? "meadowPhoto" : "cliffPhoto"].value = texture;
      material.uniforms[i === 0 ? "haveMeadow" : "haveCliff"].value = 1;
    }),
  );
  // Neighbouring tiles share the vertex buffers. Frustum culling discards
  // mountains behind the pilot before their triangles reach the GPU.
  const tiles = [];
  const tileSize = 68;
  const reordered = new Uint32Array(index.length);
  let offset = 0;
  for (let row = 0; row < h - 1; row += tileSize)
    for (let col = 0; col < w - 1; col += tileSize) {
      const first = offset,
        xEnd = Math.min(col + tileSize, w - 1),
        zEnd = Math.min(row + tileSize, h - 1);
      let low = Infinity,
        high = -Infinity;
      for (let j = row; j <= zEnd; j++) {
        for (let i = col; i <= xEnd; i++) {
          const y = heights[j * w + i];
          low = Math.min(low, y);
          high = Math.max(high, y);
        }
        if (j === zEnd) break;
        const start = (j * (w - 1) + col) * 6;
        const length = (xEnd - col) * 6;
        reordered.set(index.subarray(start, start + length), offset);
        offset += length;
      }
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(land.attributes))
        geometry.setAttribute(name, attribute);
      geometry.setDrawRange(first, offset - first);
      geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(xs[col], low, zs[row]),
        new THREE.Vector3(xs[xEnd], high, zs[zEnd]),
      );
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(
        new THREE.Sphere(),
      );
      tiles.push(geometry);
    }
  const indices = new THREE.BufferAttribute(reordered, 1);
  const clock = () => {
    material.uniforms.time.value = (performance.now() % 1000000) / 1000;
  };
  for (const geometry of tiles) {
    geometry.setIndex(indices);
    const tile = new THREE.Mesh(geometry, material);
    tile.onBeforeRender = clock;
    world.add(tile);
  }

  const spruce = makeSpruce(),
    needleMap = spruceAtlas();
  const leaves = new THREE.MeshBasicMaterial({
    map: needleMap,
    side: THREE.DoubleSide,
    alphaTest: 0.38,
  });
  leaves.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <fog_fragment>",
      `
      #ifdef USE_FOG
        float treeHaze=smoothstep(420.,3100.,vFogDepth)*.62;
        gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.36,.405,.332),treeHaze);
      #endif
      #include <fog_fragment>
    `,
    );
  };
  const stoneGeometry = new THREE.IcosahedronGeometry(1, 1);
  const rockVertices = stoneGeometry.getAttribute("position");
  const rockColors = [];
  const rockTint = new THREE.Color(0x9b978a);
  for (let i = 0; i < rockVertices.count; i++) {
    const x = rockVertices.getX(i),
      y = rockVertices.getY(i),
      z = rockVertices.getZ(i);
    const k = 0.81 + 0.28 * noise(x * 2.6 + 32, z * 2.6 + y * 1.5);
    rockVertices.setXYZ(i, x * k, y * k, z * k);
    const shade = 0.82 + 0.22 * noise(x * 5 + y * 2, z * 5);
    rockColors.push(rockTint.r * shade, rockTint.g * shade, rockTint.b * shade);
  }
  stoneGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(rockColors, 3),
  );
  stoneGeometry.computeVertexNormals();
  const stoneMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const matrix = new THREE.Object3D(),
    tint = new THREE.Color();
  const groups = new Map(),
    obstacles = new Map();
  const bucketSize = 32;
  function addObstacle(kind, x, y, z, size, width) {
    const radius = kind === "tree" ? size * width * 0.235 : size * width * 1.12;
    const shape = { kind, x, y, z, size, radius };
    for (
      let i = Math.floor((x - radius) / bucketSize);
      i <= Math.floor((x + radius) / bucketSize);
      i++
    ) {
      for (
        let j = Math.floor((z - radius) / bucketSize);
        j <= Math.floor((z + radius) / bucketSize);
        j++
      ) {
        const key = i + "," + j;
        if (!obstacles.has(key)) obstacles.set(key, []);
        obstacles.get(key).push(shape);
      }
    }
  }
  function hitsObstacle(x, y, z) {
    const objects = obstacles.get(
      Math.floor(x / bucketSize) + "," + Math.floor(z / bucketSize),
    );
    if (!objects) return false;
    for (const object of objects) {
      const t = (y - object.y) / object.size;
      let radius = object.radius;
      if (object.kind === "tree") {
        if (t < 0 || t > 1.02) continue;
        const crown =
          t < 0.12
            ? 0.046
            : Math.pow(Math.max(0, (1.02 - t) / 0.88), 0.72) * 0.9;
        radius = radius * crown + 0.1;
      } else {
        if (Math.abs(t) >= 1) continue;
        radius *= Math.sqrt(1 - t * t) * 0.9;
      }
      if ((x - object.x) ** 2 + (z - object.z) ** 2 <= radius * radius)
        return true;
    }
    return false;
  }
  function addInstance(kind, x, z, size, wide, shade) {
    const key = `${kind},${Math.floor(x / 800)},${Math.floor(z / 800)}`;
    if (!groups.has(key)) groups.set(key, { kind, items: [] });
    matrix.position.set(
      x,
      height(x, z) - (kind === "tree" ? 0.22 : size * 0.17),
      z,
    );
    addObstacle(kind, x, matrix.position.y, z, size, wide);
    matrix.rotation.set(
      kind === "rock" ? rng() * 0.75 : 0,
      rng() * Math.PI * 2,
      kind === "rock" ? rng() * 0.5 : 0,
    );
    matrix.scale.set(size * wide, size, size * (kind === "tree" ? wide : 1.17));
    matrix.updateMatrix();
    groups.get(key).items.push({ matrix: matrix.matrix.clone(), shade });
  }
  const shadows = [];
  for (let n = 0; n < 59000; n++) {
    const z = 1050 - rng() * 6900;
    const x = center(z) + (rng() - 0.5) * (n < 38000 ? 3270 : 1150);
    const y = height(x, z),
      dx = (height(x + 5, z) - height(x - 5, z)) / 10,
      dz = (height(x, z + 5) - height(x, z - 5)) / 10;
    const ny = 1 / Math.hypot(dx, 1, dz);
    if (
      rng() > 0.021 + forest(x, z, y, ny) * 0.83 ||
      ny < 0.6 ||
      y > 1850 ||
      Math.abs(x - river(z)) < 11
    )
      continue;
    const size = 5.2 + rng() * 12.0 + (1 - smooth(700, 1500, y)) * 3.6;
    const lightOnSlope = Math.max(
      0,
      (-dx * sunlight.x + sunlight.y - dz * sunlight.z) * ny,
    );
    const terrainLight = env[(cell(zs, z) * w + cell(xs, x)) * 4 + 3];
    const treeLight = 0.52 + 0.48 * lightOnSlope * terrainLight;
    addInstance(
      "tree",
      x,
      z,
      size,
      0.83 + rng() * 0.39,
      (0.8 + rng() * 0.38) * treeLight,
    );
    const width = size * 0.24,
      length = size * 0.84;
    // Short, terrain-following contact shadows anchor each tree to the meadow.
    for (const [du, dv] of [
      [-0.67, 0],
      [0, 1.05],
      [1.0, 0.37],
      [-0.67, 0],
      [1, 0.37],
      [0, -0.06],
    ]) {
      const sx = x + du * width * 0.36 + dv * length,
        sz = z - du * width + dv * length * 0.39;
      shadows.push(sx, height(sx, sz) + 0.15, sz);
    }
  }
  for (let n = 0; n < 3400; n++) {
    const z = 780 - rng() * 5500,
      x = center(z) + (rng() - 0.5) * 1760;
    const inScree =
      Math.abs(x - river(z)) < 28 || Math.abs(x - center(z)) > 450;
    const size = 0.28 + Math.pow(rng(), 3.1) * (inScree ? 4.3 : 2.1);
    addInstance("rock", x, z, size, 1 + rng() * 0.65, 0.75 + rng() * 0.46);
  }
  for (const { kind, items } of groups.values()) {
    const batch = new THREE.InstancedMesh(
      kind === "tree" ? spruce : stoneGeometry,
      kind === "tree" ? leaves : stoneMaterial,
      items.length,
    );
    items.forEach((item, id) => {
      batch.setMatrixAt(id, item.matrix);
      tint.setRGB(item.shade, item.shade, item.shade);
      batch.setColorAt(id, tint);
    });
    batch.computeBoundingSphere();
    world.add(batch);
  }
  const shadowGeometry = new THREE.BufferGeometry();
  shadowGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(shadows, 3),
  );
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x35443e,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  world.add(new THREE.Mesh(shadowGeometry, shadowMaterial));
  return {
    height,
    center,
    hitsObstacle,
    dispose() {
      disposed = true;
      needleMap?.dispose();
      scene.remove(world);
      world.traverse((obj) => {
        if (obj.isInstancedMesh) obj.dispose();
      });
      for (const asset of [
        ...tiles,
        land,
        material,
        atlas,
        spruce,
        leaves,
        stoneGeometry,
        stoneMaterial,
        shadowGeometry,
        shadowMaterial,
      ])
        asset.dispose();
    },
  };
}
