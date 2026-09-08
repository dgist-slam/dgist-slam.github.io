let points, side, spacing;
self.onmessage = ({ data: d }) => {
  if (d.type === "scene") {
    points = d.points;
    side = d.side;
    spacing = d.spacing;
    self.postMessage({ ready: true });
    return;
  }
  const start = performance.now(),
    depth = new Float32Array(640 * 480).fill(Infinity),
    r = d.pose.r,
    e = d.pose.e;
  for (let i = 0; i < side; i++)
    for (let j = 0; j < side; j++) {
      const ox = (i - (side - 1) / 2) * spacing,
        oz = (j - (side - 1) / 2) * spacing;
      for (let p = 0; p < points.length; p += 3) {
        const x = points[p] + ox - e[0],
          y = points[p + 1] - e[1],
          z = points[p + 2] + oz - e[2];
        const X = r[0] * x + r[1] * y + r[2] * z,
          Y = r[3] * x + r[4] * y + r[5] * z,
          Z = r[6] * x + r[7] * y + r[8] * z;
        if (Z <= 0.01 || Z >= d.far) continue;
        const u = Math.floor((500 * X) / Z + 320),
          v = Math.floor(240 - (500 * Y) / Z);
        if (u >= 0 && u < 640 && v >= 0 && v < 480) {
          const k = v * 640 + u;
          if (Z < depth[k]) depth[k] = Z;
        }
      }
    }
  const pixels = new Uint8ClampedArray(640 * 480 * 4);
  for (let i = 0; i < depth.length; i++) {
    let c = [245, 245, 245];
    if (Number.isFinite(depth[i])) {
      const t = Math.min(1, depth[i] / d.far);
      c =
        t < 0.5
          ? [255, 89 + 272 * t, 20 + 80 * t]
          : [
              255 - 408 * (t - 0.5),
              225 - 134 * (t - 0.5),
              60 + 322 * (t - 0.5),
            ];
    }
    pixels.set([...c.map(Math.round), 255], i * 4);
  }
  const ms = performance.now() - start;
  self.postMessage({ ms, pixels }, [pixels.buffer]);
};
