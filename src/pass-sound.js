// Index audible surfaces once for each line. Only nearby trunks, crowns and
// rock faces contribute to the short reflected rush at the pilot's ears.
export function createPassSound() {
  const cells = new Map(),
    cue = { strength: 0, pan: 0, approach: 0 };
  const key = (x, z) => x + "," + z;
  function add(x, base, z, radius, height) {
    const item = { x, base, z, radius, top: base + height };
    const reach = radius + 22;
    for (
      let i = Math.floor((x - reach) / 48);
      i <= Math.floor((x + reach) / 48);
      i++
    )
      for (
        let j = Math.floor((z - reach) / 48);
        j <= Math.floor((z + reach) / 48);
        j++
      ) {
        const k = key(i, j);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(item);
      }
  }
  function sample(s) {
    cue.strength = cue.pan = cue.approach = 0;
    const near = cells.get(key(Math.floor(s.x / 48), Math.floor(s.z / 48)));
    if (!near) return cue;
    const rx = Math.cos(s.canopyHeading),
      rz = Math.sin(s.canopyHeading);
    for (const p of near) {
      const dx = p.x - s.x,
        dz = p.z - s.z,
        flat = Math.hypot(dx, dz);
      const dy = Math.max(p.base - s.y, s.y - p.top, 0);
      const range = Math.hypot(Math.max(0, flat - p.radius), dy);
      const gain = Math.max(0, 1 - range / 22) ** 2 * Math.min(1, s.speed / 28);
      if (gain <= cue.strength) continue;
      cue.strength = gain;
      cue.pan = ((dx * rx + dz * rz) / Math.max(1, flat)) * Math.cos(s.bank);
      cue.approach =
        (dx * Math.sin(s.heading) - dz * Math.cos(s.heading)) /
        Math.max(1, flat);
    }
    return cue;
  }
  return { add, sample };
}
