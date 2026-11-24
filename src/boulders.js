import * as THREE from "three";

// Two asymmetric, rounded granite forms, normalized to a one-metre footprint.
function boulder(variant) {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const points = geometry.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i),
      y = points.getY(i),
      z = points.getZ(i);
    const bulge =
      0.94 + 0.07 * Math.sin(x * 3 + variant * 2) * Math.cos(z * 2 + y);
    points.setXYZ(
      i,
      (x * bulge + y * 0.12) * 0.46,
      Math.max(-0.66, y * bulge) * (variant ? 0.25 : 0.36),
      z * bulge * (variant ? 0.35 : 0.43),
    );
  }
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox.min.y, 0);
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
  // A top surface sampled from the actual triangles follows the irregular
  // outline closely enough for a body-sized collision, including flat slabs.
  const res = 32,
    heights = new Float32Array(res * res).fill(-Infinity);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const pos = geometry.attributes.position;
  const toCell = (v) =>
    Math.max(0, Math.min(res - 1, Math.floor((v + 0.5) * res)));
  for (let j = 0; j < pos.count; j += 3) {
    a.fromBufferAttribute(pos, j);
    b.fromBufferAttribute(pos, j + 1);
    c.fromBufferAttribute(pos, j + 2);
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
  return {
    geometry,
    top: (x, z) =>
      Math.max(Math.abs(x), Math.abs(z)) > 0.5
        ? -Infinity
        : heights[toCell(z) * res + toCell(x)],
  };
}

export function createBoulders(scene, world, seed) {
  let value = Number(seed) >>> 0;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  const batches = [],
    buckets = new Map(),
    root = new THREE.Group(),
    placements = [];
  const models = [boulder(0), boulder(1)];
  const material = new THREE.MeshLambertMaterial({ flatShading: true });
  const palette = [0xc0ae91, 0xd9c19c, 0xaa9d8c, 0xb7aaa0, 0xcdb794];
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
  // Their low tops are distinct from the larger blocks flanking the flight line.
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
      material,
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
      const color = new THREE.Color(palette[i % palette.length]);
      batch.setColorAt(i, color);
    }
    batch.computeBoundingSphere();
    batches.push(batch);
    root.add(batch);
  }
  return {
    update(x, z) {
      for (const batch of batches) {
        const sphere = batch.boundingSphere;
        batch.visible =
          Math.hypot(sphere.center.x - x, sphere.center.z - z) <
          630 + sphere.radius;
      }
    },
    hits(x, y, z) {
      const near = buckets.get(Math.floor(z / 32));
      if (!near) return false;
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
            rock.length * rock.heightScale * models[rock.model].top(u, v)
        )
          return true;
      }
      return false;
    },
    dispose() {
      root.removeFromParent();
      for (const batch of batches) batch.dispose();
      for (const model of models) model.geometry.dispose();
      material.dispose();
      buckets.clear();
    },
  };
}
