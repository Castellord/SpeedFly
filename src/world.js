import { createValleyMist } from "./air-effects.js";
import { flightTexture } from "./textures.js";
import * as THREE from "three";
import { createVegetation } from "./vegetation.js";

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
        snowline: { value: 1990 },
      },
    ]),
    vertexShader: `
      #include <fog_pars_vertex>
      attribute vec4 habitat;
      attribute float bedrock;
      attribute vec2 torrent;
      varying vec2 creek;
      varying float exposureRock;
      varying vec3 pos;
      varying vec3 slope;
      varying vec4 env;
      void main() {
        env = habitat;
        exposureRock = bedrock;
        creek = torrent;
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
      uniform float snowline;
      varying vec2 creek;
      varying float exposureRock;
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
        mineral=max(mineral,smoothstep(.03,.88,exposureRock+(rock.r-.50)*.36));
        float nearDetail=1.-smoothstep(25.,175.,length(cameraPosition-pos));
        float trees = env.y * smoothstep(-.12, .08, mottling + env.y * .13);
        vec3 meadow = mix(vec3(.49,.52,.30), vec3(.65,.62,.42), broad.g);
        meadow = mix(meadow, vec3(.255,.335,.245), trees * .77);
        meadow += mottling * vec3(.32,.27,.20) + fine * .09;
        vec3 stone = mix(vec3(.355,.385,.404), vec3(.61,.575,.518), broad.r + mottling * .70);
        float fissure = smoothstep(.63, .94, rock.b) * smoothstep(.46, .78, rock.r);
        float seam = texture2D(atlas, vec2(pos.x * .33 + pos.z*.63, pos.y*2.1+pos.x*.27+pos.z*.43) / 47.).r;
        stone += (rock.g-.5) * .34 + fine*.19 - fissure*.155 + (seam-.5)*.13;
        if(haveMeadow > .5 && mineral < .99) {
          mat2 twist = mat2(.83,.557,-.557,.83);
          vec3 small = texture2D(meadowPhoto,pos.xz/14.8 + broad.rg*.19).rgb;
          vec3 pasture = texture2D(meadowPhoto,twist*pos.xz/107. + broad.gb*.37).rgb;
          vec3 photo = mix(small,pasture,.47);
          if(nearDetail>.001){
            vec3 turf=texture2D(meadowPhoto,twist*pos.xz/1.8).rgb;
            photo*=mix(vec3(1.),.60+turf*1.14,nearDetail*.72);
          }
          float tone = dot(photo,luma);
          vec3 pigment = mix(vec3(.36,.39,.24),vec3(.68,.67,.46),clamp(tone*1.65,0.,1.));
          meadow = mix(meadow,pigment,.57) * (.40 + tone*1.45);
          meadow += (photo-vec3(tone))*.36 + mottling*.12;
          meadow *= 1.-trees*.22;
        }
        vec3 cliffGrain = rock;
        if(haveCliff > .5 && mineral > .01) {
          vec3 weights=pow(abs(n),vec3(4.));
          weights/=max(.001,weights.x+weights.y+weights.z);
          vec3 block = granite(pos*vec3(.89,1.16,.96)/143. + vec3(broad.rg,broad.b)*.31,weights);
          vec3 chip = granite(pos*vec3(1.,1.28,.82)/26. + vec3(broad.b,broad.r,broad.g)*.19,weights);
          cliffGrain = mix(block,chip,.45);
          if(nearDetail>.001){
            vec3 spall=granite(pos*vec3(1.,1.28,.82)/3.1,weights);
            cliffGrain*=mix(vec3(1.),.57+spall*1.30,.78*nearDetail);
          }
          float tone=dot(cliffGrain,luma);
          stone = mix(stone,vec3(.47,.485,.48)+mottling*.23,.48)*(.42+tone*1.47) + (cliffGrain-vec3(tone))*.52;
        }
        // Bedding follows a dipping plane, cutting across the face of each cliff.
        float beds=pos.y*.097+pos.x*.025+pos.z*.034+(broad.g-.5)*3.7+(rock.r-.5)*.88;
        float join=1.-smoothstep(.05,.22,abs(fract(beds)-.5));
        stone*=1.-join*.035*smoothstep(.05,.35,steep);
        vec3 surface = mix(meadow, stone, mineral);
        // Snow follows local shelter and the rock's fissures, leaving bands
        // of exposed strata even on the alpine faces beyond the course.
        float exposure = pos.y - snowline + relief*.30 - n.x * 181. - n.z * 94.;
        float snow = smoothstep(-24., 45., exposure - steep*1080. + mottling*620.
                        + (rock.r-.5)*165. + (dot(cliffGrain,luma)-.46)*210.);
        snow *= 1.-smoothstep(.19,.52,steep)*smoothstep(.04,.26,.45-rock.r)*.55;
        vec3 ice = mix(vec3(.74,.80,.82), vec3(.985,.98,.95), broad.g + fine*.21 + rock.g*.11);
        surface = mix(surface, ice, snow);
        float width = 4.8 + 1.8*sin(pos.z*.0084) + 1.2*sin(pos.z*.019);
        float mainChannel=abs(env.z +(flake.r-.5)*2.)/(width*max(.001,smoothstep(-5420.,-4350.,pos.z)));
        float brookWidth=3.0+.83*sin(pos.z*.026)+1.25*(flake.g-.5);
        float creekAxis=creek.x+(flake.g-.5)*2.+(rock.r-.5)*1.8;
        float brook=abs(creekAxis)/(brookWidth*max(.001,creek.y));
        float channel=min(mainChannel,brook);
        float river=1.-smoothstep(.67,1.10,channel);
        float riparian=1.-smoothstep(.80,3.52,channel);
        vec3 bed=mix(vec3(.34,.35,.33),vec3(.60,.60,.54),flake.g);
        if(haveCliff>.5 && riparian>.01) {
          vec3 shingle=texture2D(cliffPhoto,pos.xz/4.55+rock.rg*.07).rgb;
          bed=mix(bed,vec3(.19)+shingle*.71,.69);
        }
        surface=mix(surface,bed,riparian*.91);
        if (river > .001) {
          vec2 flowUV=vec2(pos.x*.15+sin(pos.z*.24)*.15,pos.z*.058+time*.085);
          vec3 eddy=texture2D(atlas,flowUV).rgb;
          float boil=smoothstep(.09,.43,steep)+.23*smoothstep(.51,.78,flake.g);
          float foam=smoothstep(.55,.74,eddy.g+.16*boil+fine*.32);
          vec3 water=mix(bed*.74,vec3(.21,.37,.36),.43+.38*(1.-smoothstep(.14,.78,channel)));
          vec3 eye=normalize(cameraPosition-pos);
          vec3 ripple=normalize(n+vec3((eddy.r-.5)*.46,0.,(eddy.g-.5)*.34));
          float grazing=pow(1.-clamp(dot(ripple,eye),0.,1.),3.);
          float glint=pow(max(dot(ripple,normalize(sun+eye)),0.),46.);
          water=mix(water,vec3(.63,.74,.79),.48*grazing)+vec3(.70,.62,.48)*glint*env.w;
          water=mix(water,vec3(.83,.86,.83),foam*(.28+.61*clamp(boil,0.,1.)));
          surface=mix(surface,water,river);
        }
        // Let the scans carry fine relief. Differentiating their pixel luminance
        // turns tiny colour changes into sparkling, near-binary surface normals.
        float diffuse = max(dot(n,sun),0.);
        float light = .70 + diffuse*.39;
        vec3 lit = surface * light * mix(vec3(.84,.90,.99),vec3(1.055,1.02,.965),diffuse);
        lit *= mix(vec3(.70,.76,.86),vec3(1.),env.w);
        // Broad, drifting cloud shadows separate sunlit shoulders from the
        // cooler valley floor. World-space sampling keeps them fixed on turns.
        float cloud=texture2D(atlas,(pos.xz+pos.y*.19*sun.xz+time*vec2(.9,.35))/1640.).r;
        lit *= mix(vec3(.79,.85,.93),vec3(1.07,1.045,1.005),smoothstep(.40,.57,cloud));
        float distanceHaze = (1.-exp(-length(pos-cameraPosition)*.00015))
          * (1.-smoothstep(1350.,2580.,pos.y));
        lit = mix(lit,vec3(.68,.77,.81),distanceHaze*.63);
        gl_FragColor = vec4(pow(max(lit,vec3(.001)),vec3(2.2)),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// Exposed beds are closed, angular rock solids, with recessed joints, slanted
// caps, fractured sides and projecting shelves. The collision lookup samples
// their rendered triangles rather than approximating a cliff with a sphere.
function crags({
  world,
  groundHeight,
  center,
  floor,
  wallSide,
  style,
  rng,
  material,
  lightAt,
  lips,
}) {
  const strips = new Map(),
    cells = new Map(),
    resources = [];
  function face(batch, a, b, c) {
    batch.positions.push(...a, ...b, ...c);
    const denominator =
      (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    if (Math.abs(denominator) < 0.012) return;
    const hit = {
      ax: a[0],
      az: a[2],
      ay: a[1],
      bx: b[0] - a[0],
      bz: b[2] - a[2],
      by: b[1] - a[1],
      cx: c[0] - a[0],
      cz: c[2] - a[2],
      cy: c[1] - a[1],
      inv: 1 / denominator,
    };
    for (
      let i = Math.floor(Math.min(a[0], b[0], c[0]) / 32);
      i <= Math.floor(Math.max(a[0], b[0], c[0]) / 32);
      i++
    ) {
      for (
        let j = Math.floor(Math.min(a[2], b[2], c[2]) / 32);
        j <= Math.floor(Math.max(a[2], b[2], c[2]) / 32);
        j++
      ) {
        const key = i + "," + j;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(hit);
      }
    }
  }
  function rock(z, d, h, width, length, strike, minOffset = 21.5) {
    const side = Math.sign(d),
      x = center(z) + d;
    const ground = groundHeight(x, z);
    // A jointed block has a dominant plane and several broken corners.
    // The ledge retreats on just its exposed edge, never around the full rim.
    const outline = [
      [-0.97, -0.56],
      [-0.49, -1],
      [0.62, -0.85],
      [1, -0.29],
      [0.73, 0.65],
      [0.25, 1],
      [-0.74, 0.77],
      [-1, 0.12],
    ];
    const n = outline.length,
      lean = (rng() - 0.5) * 0.52,
      along = (rng() - 0.5) * 0.58;
    const brokenSide = rng() * Math.PI * 2;
    const contour = outline.map(([u, v], i) => {
      const mod = 0.79 + rng() * 0.36,
        sideFracture = Math.max(
          0,
          Math.cos((i * Math.PI * 2) / n - brokenSide),
        );
      return {
        u: u * width * mod + 0.12 * v * width,
        v: v * length * mod,
        crown: 0.7 + lean * u + along * v + 0.14 * rng() - 0.18 * sideFracture,
        breakAt: 0.26 + rng() * 0.29 + sideFracture * 0.22,
        projection: sideFracture * (0.08 + rng() * 0.24),
        weather: rng() * 0.08,
      };
    });
    const qSlope = (floor(z + 18) - floor(z - 18)) / 36,
      dip = (rng() - 0.5) * 0.25;
    const slip = (rng() - 0.5) * 0.48,
      shift = (rng() - 0.5) * 0.31,
      cleft = rng() < 0.43;
    function ring(position) {
      return contour.map(({ u, v, crown, breakAt, projection, weather }) => {
        let scale = 1,
          t = -0.5;
        if (position === "knee") {
          scale = 1.0 + projection - weather;
          t = breakAt;
        }
        if (position === "notch") {
          scale = 1.0 + projection * (cleft ? -0.31 : 0.65) - weather;
          t = breakAt + 0.05;
        }
        if (position === "shoulder") {
          scale = 0.85 + projection * 0.21 - weather;
          t = 0.8 + weather;
        }
        if (position === "cap") {
          scale = 0.65 + projection * 0.3 + weather;
          t = 1;
        }
        const dz = v * scale + length * t * shift,
          pz = z + dz;
        const du = u * scale + dz * strike + width * t * slip;
        const px =
          center(pz) + side * Math.max(minOffset, Math.abs(d) + side * du);
        const py = ground + qSlope * dz + dip * u + h * t * crown;
        return [px, py, pz];
      });
    }
    const key = Math.floor(z / 430);
    if (!strips.has(key)) strips.set(key, { positions: [] });
    const batch = strips.get(key);
    let previous = ring("base");
    // Embed every corner, including rocks spanning a pre-existing drop.
    for (const point of previous)
      point[1] = Math.min(point[1], groundHeight(point[0], point[2]) - 1.2);
    function join(next) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        face(batch, previous[i], next[i], previous[j]);
        face(batch, previous[j], next[i], next[j]);
      }
      previous = next;
    }
    join(ring("knee"));
    if (cleft) join(ring("notch"));
    join(ring("shoulder"));
    join(ring("cap"));
    const top = [
      previous.reduce((a, p) => a + p[0], 0) / n,
      previous.reduce((a, p) => a + p[1], 0) / n + h * 0.053,
      previous.reduce((a, p) => a + p[2], 0) / n,
    ];
    for (let i = 0; i < n; i++)
      face(batch, previous[i], top, previous[(i + 1) % n]);
  }
  // Two distinct landmarks frame the first turn. All subsequent scarps
  // follow seeded reaches, from a single tor to a run of offset strata.
  rock(-54, wallSide * 47, 16 + 5 * rng(), 13, 29, 0.11);
  rock(-97, -wallSide * 30, 6 + 4 * rng(), 7, 10, -0.19);
  rock(-142, wallSide * 50, 13, 17, 28, 0.09);
  for (let z = 180; z > -3800; z -= 105 + rng() * 133) {
    const s = rng() < 0.73 ? wallSide : -wallSide;
    const shelf = style === 2 ? 39 + rng() * 52 : 34 + rng() * 47;
    const count = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const tooth = 0.65 + rng() * 0.64;
      rock(
        z - i * (10 + rng() * 18),
        s * (shelf + rng() * 20),
        tooth * (8 + rng() * 18),
        7 + rng() * 15,
        14 + rng() * 29,
        (rng() - 0.5) * 0.62,
      );
    }
    if (rng() < 0.65)
      rock(
        z - 78,
        -s * (29 + rng() * 25),
        5 + rng() * 12,
        6 + rng() * 8,
        9 + rng() * 19,
        (rng() - 0.5) * 0.55,
      );
  }
  for (const lip of lips) {
    // Massive fractured slabs bracket the gap through each drop.
    for (let i = 0; i < 6; i++) {
      const s = i % 2 === 0 ? wallSide : -wallSide;
      rock(
        -lip.distance + 36 - i * 13,
        s * (28 + rng() * 11),
        3.6 + rng() * 9,
        6 + rng() * 8,
        13 + rng() * 16,
        (rng() - 0.5) * 0.48,
      );
    }
  }
  // The tributary skirts a train of plucked, slanting slabs. Their low
  // upstream ends are embedded in the stream bed; the central flight path
  // and the space swept by a banking canopy stay open.
  for (
    let z = -(lips[0].distance - 130);
    z > -(lips[0].distance + 365);
    z -= 33 + rng() * 34
  ) {
    const side = rng() < 0.58 ? wallSide : -wallSide;
    const d = side * (14.8 + rng() * 8);
    rock(
      z,
      d,
      1.6 + rng() * 2.5,
      3.0 + rng() * 4.2,
      4.3 + rng() * 8,
      (rng() - 0.5) * 0.89,
      10.9,
    );
    if (rng() < 0.6)
      rock(
        z - 8,
        d + side * 3,
        1.2 + rng() * 1.9,
        2.4 + rng() * 3,
        4 + rng() * 5,
        0.31,
        10.8,
      );
  }
  // Larger, more widely spaced ribs break up the high valley walls.
  for (let z = 580; z > -4750; z -= 172 + rng() * 169) {
    const side = rng() < 0.5 ? -1 : 1;
    for (let j = 0; j < 3; j++)
      rock(
        z - j * 29,
        side * (168 + rng() * 126),
        28 + rng() * 50,
        21 + rng() * 32,
        23 + rng() * 48,
        (rng() - 0.5) * 0.83,
      );
  }
  for (const { positions } of strips.values()) {
    const g = new THREE.BufferGeometry(),
      habitat = [],
      cover = [];
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]];
      habitat.push(y - floor(z), 0, 1000, lightAt(x, z));
      cover.push(1);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("habitat", new THREE.Float32BufferAttribute(habitat, 4));
    g.setAttribute("bedrock", new THREE.Float32BufferAttribute(cover, 1));
    const dry = new Float32Array(cover.length * 2);
    for (let i = 0; i < cover.length; i++) dry[i * 2] = 1000;
    g.setAttribute("torrent", new THREE.BufferAttribute(dry, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = "Слоистые скальные выходы";
    world.add(mesh);
    resources.push(g);
  }
  function top(x, z) {
    const list = cells.get(Math.floor(x / 32) + "," + Math.floor(z / 32));
    let highest = -Infinity;
    if (!list) return highest;
    for (const t of list) {
      const dx = x - t.ax,
        dz = z - t.az;
      const u = (dx * t.cz - dz * t.cx) * t.inv,
        v = (t.bx * dz - t.bz * dx) * t.inv;
      if (u >= 0 && v >= 0 && u + v <= 1)
        highest = Math.max(highest, t.ay + u * t.by + v * t.cy);
    }
    return highest;
  }
  return { top, resources };
}

// Angular chips below the cliff foot give the passing ground sub-metre
// parallax. Each talus patch shares geometry and draws only within 185 m.
function addScree(world, center, height, rng, section, wallSide, lips) {
  const verts = [
    [-1, 0, -0.34],
    [-0.51, 0, -0.82],
    [0.55, 0, -0.62],
    [1, 0, 0.22],
    [0.23, 0, 0.81],
    [-0.79, 0, 0.55],
  ];
  const p = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i],
      b = verts[(i + 1) % verts.length];
    p.push(...a, -0.16, 0.53, 0.04, ...b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  const pebble = new THREE.Object3D(),
    tint = new THREE.Color();
  const patches = [];
  function patch(z, cx, wet) {
    const count = wet
        ? 29 + Math.floor(rng() * 32)
        : 18 + Math.floor(rng() * 58),
      batch = new THREE.InstancedMesh(geometry, material, count);
    const yaw = rng() * 2.8;
    for (let i = 0; i < count; i++) {
      const dz = (rng() + rng() - 1) * (wet ? 9 : 10 + rng() * 19),
        x = cx + (rng() + rng() - 1) * (wet ? 5 : 7) + dz * 0.24,
        pz = z + dz;
      const r = 0.075 + Math.pow(rng(), 2.5) * (wet ? 0.97 : 0.62);
      pebble.position.set(x, height(x, pz) - r * 0.045, pz);
      pebble.rotation.set(
        (rng() - 0.5) * 0.23,
        yaw + (rng() - 0.5) * 1.3,
        (rng() - 0.5) * 0.24,
      );
      pebble.scale.set(r * (1 + rng() * 0.91), r * (0.53 + rng() * 0.61), r);
      pebble.updateMatrix();
      batch.setMatrixAt(i, pebble.matrix);
      tint.setHSL(
        0.095 + rng() * 0.035,
        0.045 + rng() * 0.082,
        0.26 + rng() * 0.21,
        THREE.SRGBColorSpace,
      );
      batch.setColorAt(i, tint);
    }
    batch.computeBoundingSphere();
    batch.name = "Мелкая осыпь";
    world.add(batch);
    patches.push({ x: cx, z, batch });
  }
  for (let z = 110; z > -3550; z -= 16 + rng() * 33) {
    const offset = (rng() < 0.5 ? -1 : 1) * (2 + rng() * 36);
    patch(z, center(z) + offset, false);
  }
  for (
    let z = -(lips[0].distance - 125);
    z > -(lips[0].distance + 433);
    z -= 12 + rng() * 13
  ) {
    const q = section(z),
      side = rng() < 0.5 ? -1 : 1;
    patch(z, q.bend + wallSide * q.brook + side * (2.1 + rng() * 2.4), true);
  }
  return {
    update(x, z) {
      for (const patch of patches)
        patch.batch.visible =
          (x - patch.x) ** 2 + (z - patch.z) ** 2 < 185 ** 2;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      for (const p of patches) p.batch.dispose();
    },
  };
}

function gridAxis(lo, hi, spacing) {
  const axis = [];
  for (let x = lo; x < hi; x += spacing(x)) axis.push(x);
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
  // Each seed chooses a hanging traverse, a ravine or a crest. The piste is
  // expressed in valley-relative coordinates, so the fine mesh follows its
  // bends instead of spending detail on the far side of the range.
  const style = String(seed) === "1847" ? 0 : Math.floor(rng() * 3);
  const wallSide = String(seed) === "1847" ? -1 : rng() < 0.5 ? -1 : 1;
  const phases = Array.from({ length: 6 }, () => rng() * Math.PI * 2);
  const waves = [
    [90 + rng() * 52, 510 + rng() * 150],
    [26 + rng() * 18, 330 + rng() * 84],
    [7 + rng() * 9, 210 + rng() * 64],
  ];
  const center = (z) =>
    waves.reduce(
      (x, [amplitude, period], i) =>
        x +
        amplitude * (Math.sin(z / period + phases[i]) - Math.sin(phases[i])),
      -wallSide * 690 * smooth(3440, 6360, -z),
    );
  const start = style === 0 ? 1795 + rng() * 115 : 1610 + rng() * 360;
  const grade = 0.309 + rng() * 0.037;
  function floor(z) {
    const along = clamp(z, -3550, 550);
    return (
      start +
      along * grade +
      9 * (Math.sin(along / 300 + phases[3]) - Math.sin(phases[3])) +
      3.2 * (Math.sin(along / 184 + phases[4]) - Math.sin(phases[4])) +
      Math.min(0, Math.max(-2000, z + 3550)) * 0.055
    );
  }
  // A wing can coast off each convex rock lip. Beyond it the gully opens,
  // then a long shallow reach brings the flight path back toward the ground.
  const lips = [
    {
      distance: 492 + rng() * 55,
      fall: 5.8 + rng() * 2.4,
      crest: 1.7 + rng() * 0.65,
      width: 13 + rng() * 6,
      skew: (rng() - 0.5) * 0.25,
    },
    {
      distance: 1881 + rng() * 54,
      fall: 6.2 + rng() * 2.6,
      crest: 1.5 + rng() * 0.81,
      width: 14 + rng() * 7,
      skew: (rng() - 0.5) * 0.31,
    },
  ];
  function dropProfile(z, v) {
    let drop = 0;
    for (const lip of lips) {
      const t = -z - lip.distance - clamp(v, -180, 180) * lip.skew;
      if (t < -125 || t > 340) continue;
      const cap =
        lip.crest * smooth(-105, -3, t) -
        (lip.crest + lip.fall) * smooth(-1, lip.width, t) +
        lip.fall * smooth(23, 176, t);
      const reveal =
        (1 - smooth(100, 335, t)) *
        smooth(0, 44, t) *
        smooth(19, 90, -v) *
        (1 - smooth(140, 345, -v)) *
        (30 + lip.fall * 2.8);
      drop += cap * (1 - smooth(104, 302, Math.abs(v))) - reveal;
    }
    return drop;
  }
  const section = (z) => {
    const bend = center(z);
    const a = noise(z / 229, 11),
      b = noise(z / 462, 52),
      c = noise(z / 133, 85);
    const stream =
      style === 1
        ? 35 + 15 * b
        : 119 + 54 * b + 16 * Math.sin(z / 216 + phases[1]);
    const reach = -z - (lips[0].distance - 166);
    const active = smooth(-110, -48, reach) * (1 - smooth(569, 662, reach));
    // A tributary falls off the uphill terrace, runs along the flight line,
    // crosses it on a slab, then drains into the main valley stream.
    const channel =
      9 + 3.8 * Math.sin(z / 54 + phases[3]) + 2 * Math.sin(z / 21 + phases[4]);
    const across = mix(
      channel,
      -9 + 3 * Math.sin(z / 42 + phases[2]),
      smooth(140, 300, reach),
    );
    const brook = mix(
      mix(81 + 15 * b, across, smooth(-90, 55, reach)),
      -stream,
      smooth(385, 605, reach),
    );
    return {
      z,
      bend,
      base: floor(z),
      a,
      b,
      c,
      stream,
      brook,
      active,
      crest: 31 + 17 * a + 15 * b,
      upper: 95 + 49 * c + 33 * b,
      ledge: 19 + 51 * b,
      second: 23 + 64 * a,
      breach: smooth(0.19, 0.66, c * 0.76 + noise(z / 92, 62) * 0.24),
      traverse: smooth(0.26, 0.7, noise(z / 760, 27)),
    };
  };
  const river = (z) => {
    const q = section(z);
    return q.bend - wallSide * q.stream;
  };
  const peaks = [];
  function peak(x, z, h, rx, rz, angle) {
    const skew = rng() * 0.36;
    peaks.push({
      x,
      z,
      h,
      rx,
      rz,
      c: Math.cos(angle),
      s: Math.sin(angle),
      skew,
    });
  }
  // Interlocking asymmetric arêtes instead of isolated radial domes.
  for (const side of [-1, 1])
    for (let band = 0; band < 3; band++) {
      for (let z = -11300; z < 6500; z += 660 + rng() * 830) {
        const dist =
          (band === 0 ? 1020 : 2450 + (band - 1) * 2200) +
          rng() * (band === 0 ? 680 : 1100);
        const h = (band === 0 ? 850 : 1510) + rng() * (band === 0 ? 980 : 1190);
        const x = center(z) + side * dist,
          heading = (rng() - 0.5) * 1.5;
        peak(
          x,
          z,
          h,
          h * (0.8 + rng() * 0.41),
          h * (0.82 + rng() * 0.63),
          heading,
        );
        peak(
          x - side * (90 + rng() * 290),
          z + 210 + rng() * 230,
          h * (0.65 + rng() * 0.19),
          h * 0.93,
          h * 0.46,
          heading + 0.35,
        );
      }
    }
  for (let z = -11600; z < -4700; z += 1330)
    for (let x = -3800; x <= 3800; x += 840 + rng() * 570) {
      const h = 1540 + rng() * 1230;
      peak(
        x + (rng() - 0.5) * 450,
        z + (rng() - 0.5) * 720,
        h,
        h * (0.66 + rng() * 0.38),
        h * (0.69 + rng() * 0.41),
        rng() * 1.6,
      );
    }
  const buckets = new Map();
  for (const p of peaks) {
    const span = Math.max(p.rx, p.rz) * 1.6 + 310;
    for (
      let i = Math.floor((p.z - span) / 500);
      i <= Math.floor((p.z + span) / 500);
      i++
    ) {
      if (!buckets.has(i)) buckets.set(i, []);
      buckets.get(i).push(p);
    }
  }
  function mountainRelief(x, z) {
    const wx =
      (noise(x / 674, z / 674) - 0.5) * 173 +
      (noise(x / 211 + 32, z / 211) - 0.5) * 42;
    const wz =
      (noise(x / 743 + 17, z / 743) - 0.5) * 188 +
      (noise(x / 210, z / 210 + 7) - 0.5) * 53;
    let summit = 0;
    for (const p of buckets.get(Math.floor(z / 500)) || []) {
      const dx = x + wx - p.x,
        dz = z + wz - p.z;
      const u = (dx * p.c + dz * p.s) / p.rx,
        v = (dz * p.c - dx * p.s) / p.rz;
      const d =
        Math.max(
          0.93 * u + v * 0.33,
          -u * 0.87 + v * 0.4,
          0.91 * v - u * 0.32,
          -v * 1.08 + u * 0.27,
          -0.74 * u - 0.65 * v,
          0.76 * u - 0.59 * v,
        ) +
        p.skew * Math.abs(u + v * 0.25);
      summit = Math.max(summit, p.h * (1 - d));
    }
    const fold =
      1 - Math.abs(noise(x / 420 + wz * 0.003, z / 157 + wx * 0.003) * 2 - 1);
    const spine =
      1 - Math.abs(noise(x / 310 + wx * 0.004, z / 340 + wz * 0.003) * 2 - 1);
    let mass =
      Math.max(44 + noise(x / 530, z / 530) * 170, summit) +
      (spine - 0.58) * 142 +
      (noise(x / 107, z / 110) - 0.5) * 66 +
      (noise(x / 40, z / 46) - 0.5) * 19 -
      Math.pow(fold, 3) * 139 * smooth(130, 850, summit);
    // Resistant bedding makes slanting plateaux and broken rock faces on
    // selected spurs. The dip direction is independent of the valley slope.
    const dip = x * 0.115 - z * 0.063 + 34 * (noise(x / 460, z / 460) - 0.5);
    const strat = (mass - dip) / 75,
      frac = strat - Math.floor(strat);
    const band = smooth(0.15, 0.77, noise(x / 650 + 36, z / 650));
    mass += 75 * (smooth(0.62, 0.89, frac) - frac) * band * 0.81;
    return mass;
  }
  function bench(v, z, q) {
    const d = Math.abs(v),
      positive = v >= 0;
    const joint =
      (noise(v / 43 + 31, z / 59) - 0.5) * 9 +
      (noise(v / 130, z / 136) - 0.5) * 19;
    const inner = positive ? q.crest : q.crest + 8;
    const outer = q.upper + (positive ? 0 : 14);
    const u = d + joint * smooth(20, 63, d);
    const ledge =
      smooth(inner - 3, inner + 7, u) * (q.ledge * (0.35 + 0.65 * q.breach)) +
      smooth(outer - 3, outer + 11, u) * q.second;
    const sloping = Math.max(0, u - inner) * (0.1 + 0.1 * q.c);
    const talus = (ledge + sloping) * (1 - smooth(259, 590, d));
    const stream = q.stream;
    const foundation =
      -smooth(25, 48, u) * (13 + 15 * q.a) -
      smooth(64, 88, u) * (8 + 16 * q.c) -
      smooth(82, stream + 8, u) * 17;
    const opposite = d - stream - 16;
    const rebound =
      Math.max(0, opposite) * 0.31 + smooth(34, 50, opposite) * (14 + 23 * q.b);
    const cut = (foundation + rebound) * (1 - smooth(306, 620, d));
    if (style === 0) return positive ? talus : cut;
    if (style === 1)
      return positive
        ? talus
        : talus * smooth(stream + 4, stream + 29, d) -
            6 * smooth(16, stream, d);
    const spur = positive ? q.traverse : 1 - q.traverse;
    return mix(cut, talus, smooth(0.47, 0.86, spur)) * (0.85 + 0.2 * q.b);
  }
  function rawHeight(x, z, q = section(z)) {
    const v = (x - q.bend) * wallSide,
      d = Math.abs(v);
    const closure = smooth(6030, 8530, -z);
    const mountainMix = Math.max(smooth(155, 1070, d), closure);
    const large = mountainMix > 0 ? mountainRelief(x, z) * mountainMix : 0;
    const camber =
      v *
      (0.013 + 0.025 * Math.sin(z / 315 + phases[4])) *
      (1 - smooth(30, 120, d));
    const rugged = smooth(17, 140, d);
    const fine = (noise(x / 18, z / 21) - 0.5) * (0.22 + rugged * 2.1);
    const terrace = bench(v, z, q);
    const bed = v + q.stream;
    const brook =
      q.active * (1 - smooth(1, 8, Math.abs(v - q.brook))) * (1.3 + 0.56 * q.c);
    const channel =
      (1 - smooth(1, 13.5, Math.abs(bed))) * (3.1 + q.b * 3.2) * (1 - closure);
    return (
      q.base +
      camber +
      fine +
      terrace +
      large +
      dropProfile(z, v) +
      rugged * (noise(x / 104, z / 121) - 0.5) * 12 -
      channel -
      brook
    );
  }
  function stoneCover(v, z, q, relief) {
    const d = Math.abs(v);
    const layer = noise((v + z * 0.21) / 95, z / 115);
    const onLine = 0.1 + 0.44 * smooth(0.25, 0.7, layer) + 0.14 * q.c;
    const banks = smooth(18, 64, d) * (1 - smooth(200, 650, d));
    const flagstone = v > 0 || style === 1 ? 0.24 + q.breach * 0.38 : 0.17;
    let cap = 0;
    for (const lip of lips) {
      const t = -z - lip.distance - v * lip.skew;
      cap = Math.max(
        cap,
        smooth(-69, -8, t) * (1 - smooth(17, 83, t)) * (1 - smooth(70, 176, d)),
      );
    }
    const scree = q.active * (1 - smooth(5, 31, Math.abs(v - q.brook)));
    return clamp(
      onLine * (1 - smooth(90, 320, d)) +
        banks * flagstone +
        cap * 0.68 +
        scree * 0.45 +
        smooth(220, 920, relief) * 0.35,
      0,
      1,
    );
  }
  const world = new THREE.Group();
  scene.add(world);
  const xs = gridAxis(
    -9100,
    9100,
    (u) => 4.3 + Math.min(145, Math.max(0, Math.abs(u) - 143) * 0.039),
  );
  const zs = gridAxis(
    -12000,
    5600,
    (z) => 10 + Math.min(180, Math.max(-3770 - z, z - 480, 0) * 0.049),
  );
  for (const lip of lips) {
    for (let dx = -23; dx < 34; dx += 3) {
      const z = -lip.distance + dx;
      if (zs.every((row) => Math.abs(z - row) > 1.3)) zs.push(z);
    }
  }
  zs.sort((a, b) => a - b);
  const rows = zs.map(section),
    w = xs.length,
    h = zs.length,
    count = w * h;
  const pos = new Float32Array(count * 3),
    env = new Float32Array(count * 4);
  const heights = new Float32Array(count),
    rockCover = new Float32Array(count),
    torrent = new Float32Array(count * 2);
  const index = new Uint32Array((w - 1) * (h - 1) * 6);
  for (let j = 0; j < h; j++) {
    const q = rows[j],
      z = zs[j];
    for (let i = 0; i < w; i++) {
      const id = j * w + i,
        u = xs[i],
        x = q.bend + u,
        y = rawHeight(x, z, q);
      pos[id * 3] = x;
      pos[id * 3 + 1] = heights[id] = y;
      pos[id * 3 + 2] = z;
      env[id * 4] = y - q.base;
      env[id * 4 + 2] = z < -5630 ? 1000 : u + wallSide * q.stream;
      torrent[id * 2] = u * wallSide - q.brook;
      torrent[id * 2 + 1] = q.active;
      rockCover[id] = stoneCover(u * wallSide, z, q, y - q.base);
      if (i === w - 1 || j === h - 1) continue;
      index.set(
        [id, id + w, id + 1, id + 1, id + w, id + w + 1],
        (j * (w - 1) + i) * 6,
      );
    }
  }
  function groundHeight(x, z) {
    if (z < zs[0] || z > zs[h - 1]) return rawHeight(x, z);
    const j = cell(zs, z),
      b = (z - zs[j]) / (zs[j + 1] - zs[j]);
    const u = x - mix(rows[j].bend, rows[j + 1].bend, b);
    if (u < xs[0] || u > xs[w - 1]) return rawHeight(x, z);
    const i = cell(xs, u),
      a = (u - xs[i]) / (xs[i + 1] - xs[i]);
    const id = j * w + i;
    if (a + b < 1)
      return (
        heights[id] +
        a * (heights[id + 1] - heights[id]) +
        b * (heights[id + w] - heights[id])
      );
    const top = heights[id + w + 1];
    return (
      top +
      (1 - a) * (heights[id + w] - top) +
      (1 - b) * (heights[id + 1] - top)
    );
  }
  let height = groundHeight;
  const land = new THREE.BufferGeometry();
  land.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  land.setAttribute("bedrock", new THREE.BufferAttribute(rockCover, 1));
  land.setAttribute("torrent", new THREE.BufferAttribute(torrent, 2));
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
        x = rows[j].bend + xs[i],
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
  material.uniforms.snowline.value = 1960 + 90 * Math.sin(phases[0]);
  for (const name of ["meadow", "cliff"]) {
    const texture = flightTexture(name + ".webp");
    if (!texture) continue;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    material.uniforms[name + "Photo"].value = texture;
    material.uniforms[name === "meadow" ? "haveMeadow" : "haveCliff"].value = 1;
  }
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
        new THREE.Vector3(
          xs[col] + Math.min(...rows.slice(row, zEnd + 1).map((q) => q.bend)),
          low,
          zs[row],
        ),
        new THREE.Vector3(
          xs[xEnd] + Math.max(...rows.slice(row, zEnd + 1).map((q) => q.bend)),
          high,
          zs[zEnd],
        ),
      );
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(
        new THREE.Sphere(),
      );
      tiles.push(geometry);
    }
  const indices = new THREE.BufferAttribute(reordered, 1);
  for (const geometry of tiles) {
    geometry.setIndex(indices);
    const tile = new THREE.Mesh(geometry, material);
    world.add(tile);
  }

  const lightAt = (x, z) =>
    env[(cell(zs, z) * w + cell(xs, x - center(z))) * 4 + 3];
  const rockFaces = crags({
    world,
    groundHeight,
    center,
    floor,
    wallSide,
    style,
    rng: randomSource(seed + "/escarpments"),
    material,
    lightAt,
    lips,
  });
  height = (x, z) => Math.max(groundHeight(x, z), rockFaces.top(x, z));
  const mist = createValleyMist(
    world,
    height,
    river,
    atlas,
    randomSource(seed + "/mist"),
  );
  const vegetation = createVegetation({
    scene: world,
    seed,
    height,
    center,
    river,
    forest: (x, z, y, ny) =>
      rockFaces.top(x, z) > groundHeight(x, z) - 0.25 ? 0 : forest(x, z, y, ny),
  });
  const gravel = addScree(
    world,
    center,
    height,
    randomSource(seed + "/scree"),
    section,
    wallSide,
    lips,
  );
  function update(x, z, heading, time = 0) {
    material.uniforms.time.value = time;
    mist.material.uniforms.time.value = time;
    vegetation.update(x, z, heading);
    gravel.update(x, z);
  }
  update(center(0), 0, 0);
  return {
    height,
    center,
    update,
    hitsObstacle: vegetation.hitsObstacle,
    dispose() {
      scene.remove(world);
      vegetation.dispose();
      gravel.dispose();
      for (const asset of [
        mist.material,
        mist.geometry,
        ...rockFaces.resources,
        ...tiles,
        land,
        material,
        atlas,
      ])
        asset.dispose();
    },
  };
}
