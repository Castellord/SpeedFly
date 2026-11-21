import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

let scans;
function loadScans() {
  if (scans) return scans;
  const loader = new GLTFLoader();
  scans = Promise.all(
    ["boulder_01", "rock_09"].map(async (name) => {
      const gltf = await loader.loadAsync(
        import.meta.env.BASE_URL + "assets/models/" + name + "-lod.glb",
      );
      const { geometry, material } = gltf.scene.getObjectByName("near");
      geometry.computeBoundingBox();
      const box = geometry.boundingBox,
        center = box.getCenter(new THREE.Vector3()),
        size = box.getSize(new THREE.Vector3());
      const length = Math.max(size.x, size.z);
      geometry.translate(-center.x, -box.min.y, -center.z);
      geometry.scale(1 / length, 1 / length, 1 / length);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      material.side = THREE.FrontSide;
      material.map.anisotropy = 4;
      // A top surface sampled from the actual triangles follows the irregular
      // outline closely enough for a body-sized collision, including flat slabs.
      const res = 32,
        heights = new Float32Array(res * res).fill(-Infinity);
      const a = new THREE.Vector3(),
        b = new THREE.Vector3(),
        c = new THREE.Vector3();
      const pos = geometry.attributes.position,
        ix = geometry.index;
      const toCell = (v) =>
        Math.max(0, Math.min(res - 1, Math.floor((v + 0.5) * res)));
      for (let j = 0; j < ix.count; j += 3) {
        a.fromBufferAttribute(pos, ix.getX(j));
        b.fromBufferAttribute(pos, ix.getX(j + 1));
        c.fromBufferAttribute(pos, ix.getX(j + 2));
        const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(det) < 1e-10) continue;
        for (
          let z = toCell(Math.min(a.z, b.z, c.z));
          z <= toCell(Math.max(a.z, b.z, c.z));
          z++
        )
          for (
            let x = toCell(Math.min(a.x, b.x, c.x));
            x <= toCell(Math.max(a.x, b.x, c.x));
            x++
          ) {
            const px = (x + 0.5) / res - 0.5 - c.x,
              pz = (z + 0.5) / res - 0.5 - c.z;
            const u = ((b.z - c.z) * px + (c.x - b.x) * pz) / det,
              v = ((c.z - a.z) * px + (a.x - c.x) * pz) / det;
            if (u >= 0 && v >= 0 && u + v <= 1) {
              const k = z * res + x;
              heights[k] = Math.max(
                heights[k],
                u * a.y + v * b.y + (1 - u - v) * c.y,
              );
            }
          }
      }
      const levels = ["middle", "far"].map((name) => {
        const level = new THREE.BufferGeometry();
        for (const [key, attr] of Object.entries(geometry.attributes))
          level.setAttribute(key, attr);
        level.setIndex(gltf.scene.getObjectByName(name).geometry.index);
        level.boundingSphere = geometry.boundingSphere;
        return level;
      });
      return {
        geometry,
        levels,
        material,
        top: (x, z) =>
          Math.max(Math.abs(x), Math.abs(z)) > 0.5
            ? -Infinity
            : heights[toCell(z) * res + toCell(x)],
      };
    }),
  );
  return scans;
}

export function createScannedRocks(scene, world, seed) {
  let value = Number(seed) >>> 0,
    disposed = false;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  const batches = [],
    buckets = new Map(),
    root = new THREE.Group(),
    placements = [];
  let assets;
  const object = new THREE.Object3D();
  const add = (x, z, length, heightScale, angle, model) => {
    // Sink the base into the downhill edge so scree sits in the slope.
    const base =
      Math.min(world.height(x, z), world.height(x, z - length * 0.22)) -
      length * 0.065;
    placements.push({
      x,
      z,
      base,
      length,
      heightScale,
      angle,
      model,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
    });
  };
  add(world.center(-18) + 18, -18, 15, 0.96, 0.82, 0);
  add(world.center(-43) - 20, -43, 11, 0.76, 2.61, 1);
  for (let z = -60; z >= -3320; z -= 34 + random() * 90) {
    const side = random() > 0.5 ? 1 : -1;
    const shoulder = 20 + random() * 25;
    const count = 2 + Math.floor(random() * 5);
    for (let i = 0; i < count; i++) {
      const rz = z + (random() - 0.5) * 26;
      const length = i === 0 ? 7 + random() * 11 : 1 + random() * 5;
      const rx = world.center(rz) + side * (shoulder + i * 1.8 + random() * 6);
      add(
        rx,
        rz,
        length,
        0.73 + random() * 0.38,
        random() * Math.PI * 2,
        random() > 0.55 ? 1 : 0,
      );
    }
  }
  // Talus spills over the shoulders and into the flight line in small fans.
  // Their low tops are distinct from the larger blocks flanking the gates.
  for (let z = -12; z > -3200; z -= 48 + random() * 68) {
    const side = random() > 0.5 ? 1 : -1;
    for (let j = 0; j < 4; j++) {
      const rz = z + random() * 8;
      add(
        world.center(rz) + side * (5 + j * 1.4 + random() * 2),
        rz,
        1.6 + random() * 3.9,
        0.62 + random() * 0.26,
        random() * Math.PI * 2,
        j % 2,
      );
    }
  }
  add(world.center(-448) + 15, -448, 17, 0.65, 0.52, 0);
  add(world.center(-612) - 17, -612, 12, 0.63, 0.18, 1);
  for (let z = -39; z > -3250; z -= 75 + random() * 112) {
    const side = random() < 0.5 ? -1 : 1;
    const length = 7 + random() * 5;
    add(
      world.center(z) + side * (9 + 0.65 * length + random() * 2),
      z,
      length,
      1.1 + random() * 0.44,
      random() * 6.28,
      0,
    );
  }
  scene.add(root);
  const ready = loadScans().then((models) => {
    if (disposed) return;
    assets = models;
    const grouped = new Map();
    for (const rock of placements) {
      if (rock.length > 2.5)
        world.addPass(
          rock.x,
          rock.base,
          rock.z,
          rock.length * 0.43,
          rock.length *
            rock.heightScale *
            models[rock.model].geometry.boundingBox.max.y,
        );
      const tile = Math.floor(rock.z / 75),
        key = tile * 2 + rock.model;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(rock);
      for (
        let k = Math.floor((rock.z - rock.length) / 32);
        k <= Math.floor((rock.z + rock.length) / 32);
        k++
      ) {
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(rock);
      }
    }
    for (const list of grouped.values()) {
      const model = models[list[0].model];
      const batch = new THREE.InstancedMesh(
        model.geometry,
        model.material,
        list.length,
      );
      for (let i = 0; i < list.length; i++) {
        const rock = list[i];
        object.position.set(rock.x, rock.base, rock.z);
        object.rotation.y = rock.angle;
        object.scale.set(
          rock.length,
          rock.length * rock.heightScale,
          rock.length,
        );
        object.updateMatrix();
        batch.setMatrixAt(i, object.matrix);
        const color = new THREE.Color().setScalar(0.68 + (0.2 * (i % 6)) / 5);
        batch.setColorAt(i, color);
      }
      batch.computeBoundingSphere();
      const levels = [
        batch,
        ...model.levels.map((geometry) => {
          const lod = new THREE.InstancedMesh(geometry, model.material, 0);
          lod.instanceMatrix = batch.instanceMatrix;
          lod.instanceColor = batch.instanceColor;
          lod.count = batch.count;
          lod.boundingSphere = batch.boundingSphere;
          return lod;
        }),
      ];
      batches.push(levels);
      root.add(...levels);
    }
  });
  return {
    ready,
    update(x, z) {
      for (const levels of batches) {
        const sphere = levels[0].boundingSphere;
        const distance =
          Math.hypot(sphere.center.x - x, sphere.center.z - z) - sphere.radius;
        const active =
          distance < 55 ? 0 : distance < 190 ? 1 : distance < 630 ? 2 : -1;
        for (let i = 0; i < levels.length; i++)
          levels[i].visible = i === active;
      }
    },
    hits(x, y, z) {
      const near = buckets.get(Math.floor(z / 32));
      if (!near || !assets) return false;
      for (const rock of near) {
        const dx = x - rock.x,
          dz = z - rock.z;
        if (
          Math.abs(dx) > rock.length ||
          Math.abs(dz) > rock.length ||
          y < rock.base - 0.1
        )
          continue;
        const u = (dx * rock.cos - dz * rock.sin) / rock.length,
          v = (dx * rock.sin + dz * rock.cos) / rock.length;
        if (
          y <=
          rock.base +
            rock.length * rock.heightScale * assets[rock.model].top(u, v)
        )
          return true;
      }
      return false;
    },
    dispose() {
      disposed = true;
      root.removeFromParent();
      for (const levels of batches) for (const mesh of levels) mesh.dispose();
      buckets.clear();
    },
  };
}
