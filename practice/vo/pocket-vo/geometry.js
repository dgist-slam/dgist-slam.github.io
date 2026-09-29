/* Two-view geometry: normalized eight-point RANSAC, essential decomposition.
   R,t map reference camera coordinates into current camera coordinates. */
(function (root) {
  const I = () => [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    tr = (A) => A[0].map((_, i) => A.map((r) => r[i])),
    dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
    mul = (A, B) => A.map((r) => tr(B).map((c) => dot(r, c))),
    mv = (A, v) => A.map((r) => dot(r, v)),
    norm = (v) => Math.hypot(...v),
    unit = (v) => v.map((x) => x / (norm(v) || 1)),
    cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ],
    med = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)] || 0;
  function eigen(A) {
    let n = A.length,
      a = A.map((r) => r.slice()),
      v = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => +(i === j)),
      );
    for (let sweep = 0; sweep < 35; sweep++) {
      let peak = 0;
      for (let p = 0; p < n; p++)
        for (let q = p + 1; q < n; q++) {
          let z = a[p][q];
          peak = Math.max(peak, Math.abs(z));
          if (Math.abs(z) < 1e-13) continue;
          let phi = 0.5 * Math.atan2(2 * z, a[q][q] - a[p][p]),
            c = Math.cos(phi),
            s = Math.sin(phi),
            pp = a[p][p],
            qq = a[q][q];
          a[p][p] = c * c * pp - 2 * s * c * z + s * s * qq;
          a[q][q] = s * s * pp + 2 * s * c * z + c * c * qq;
          a[p][q] = a[q][p] = 0;
          for (let k = 0; k < n; k++) {
            if (k !== p && k !== q) {
              let x = a[k][p],
                y = a[k][q];
              a[k][p] = a[p][k] = c * x - s * y;
              a[k][q] = a[q][k] = s * x + c * y;
            }
            let x = v[k][p],
              y = v[k][q];
            v[k][p] = c * x - s * y;
            v[k][q] = s * x + c * y;
          }
        }
      if (peak < 1e-11) break;
    }
    return { values: a.map((r, i) => r[i]), vectors: v };
  }
  function fit(a, b, ids) {
    function normalize(p) {
      let mx = 0,
        my = 0;
      for (let i of ids) {
        mx += p[i][0];
        my += p[i][1];
      }
      mx /= ids.length;
      my /= ids.length;
      let d =
          ids.reduce((s, i) => s + Math.hypot(p[i][0] - mx, p[i][1] - my), 0) /
          ids.length,
        s = Math.SQRT2 / Math.max(d, 1e-8);
      return {
        T: [
          [s, 0, -s * mx],
          [0, s, -s * my],
          [0, 0, 1],
        ],
        p: ids.map((i) => [(p[i][0] - mx) * s, (p[i][1] - my) * s]),
      };
    }
    let x = normalize(a),
      y = normalize(b),
      A = Array.from({ length: 9 }, () => Array(9).fill(0));
    for (let k = 0; k < ids.length; k++) {
      let [u, v] = x.p[k],
        [s, t] = y.p[k],
        r = [s * u, s * v, s, t * u, t * v, t, u, v, 1];
      for (let i = 0; i < 9; i++)
        for (let j = i; j < 9; j++) A[i][j] += r[i] * r[j];
    }
    for (let i = 0; i < 9; i++) for (let j = 0; j < i; j++) A[i][j] = A[j][i];
    let e = eigen(A),
      k = e.values.indexOf(Math.min(...e.values)),
      f = e.vectors.map((r) => r[k]),
      F = [f.slice(0, 3), f.slice(3, 6), f.slice(6, 9)];
    return mul(mul(tr(y.T), F), x.T);
  }
  function decompose(E) {
    let e = eigen(mul(tr(E), E)),
      order = [0, 1, 2].sort((a, b) => e.values[b] - e.values[a]),
      v0 = unit(e.vectors.map((r) => r[order[0]])),
      v1 = unit(e.vectors.map((r) => r[order[1]])),
      V = tr([v0, v1, cross(v0, v1)]),
      u0 = unit(mv(E, v0)),
      u1 = unit(mv(E, v1));
    u1 = unit(u1.map((x, i) => x - dot(u0, u1) * u0[i]));
    let U = tr([u0, u1, cross(u0, u1)]),
      W = [
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1],
      ];
    return {
      rotations: [mul(mul(U, W), tr(V)), mul(mul(U, tr(W)), tr(V))],
      t: cross(u0, u1),
    };
  }
  function error(E, a, b) {
    let x = [...a, 1],
      y = [...b, 1],
      ex = mv(E, x),
      ety = mv(tr(E), y),
      r = dot(y, ex);
    return (
      (r * r) / (ex[0] ** 2 + ex[1] ** 2 + ety[0] ** 2 + ety[1] ** 2 + 1e-20)
    );
  }
  function estimate(a, b, f = 300, random = Math.random) {
    if (a.length < 16) return null;
    let best = [],
      threshold = (1.2 / f) ** 2;
    for (let iter = 0; iter < 100; iter++) {
      let ids = new Set();
      while (ids.size < 8) ids.add(Math.floor(random() * a.length));
      let E = fit(a, b, [...ids]),
        inliers = [];
      for (let i = 0; i < a.length; i++)
        if (error(E, a[i], b[i]) < threshold) inliers.push(i);
      if (inliers.length > best.length) best = inliers;
      if (best.length > 0.9 * a.length && iter > 15) break;
    }
    if (best.length < 16 || best.length < a.length * 0.5) return null;
    let E = fit(a, b, best),
      d = decompose(E),
      winner = null;
    for (let R of d.rotations)
      for (let sign of [1, -1]) {
        let t = d.t.map((v) => v * sign),
          positive = 0,
          angles = [];
        for (let i of best) {
          let u = mv(R, [...a[i], 1]),
            v = [...b[i], 1],
            uu = dot(u, u),
            vv = dot(v, v),
            uv = dot(u, v),
            ut = dot(u, t),
            vt = dot(v, t),
            den = uu * vv - uv * uv;
          if (den < 1e-12) continue;
          let l = (-ut * vv + uv * vt) / den,
            m = (uu * vt - uv * ut) / den;
          if (l > 0 && m > 0) {
            positive++;
            angles.push(
              Math.acos(Math.min(1, Math.max(-1, dot(unit(u), unit(v))))),
            );
          }
        }
        if (!winner || positive > winner.positive)
          winner = { R, t, positive, parallax: med(angles), inliers: best };
      }
    if (
      !winner ||
      winner.positive < best.length * 0.75 ||
      winner.parallax < 0.004
    )
      return null;
    return winner;
  }
  function fitRotation(a, b, ids) {
    let S = Array.from({ length: 3 }, () => [0, 0, 0]);
    for (let i of ids) {
      let x = unit([...a[i], 1]),
        y = unit([...b[i], 1]);
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) S[r][c] += x[r] * y[c];
    }
    let [xx, xy, xz] = S[0],
      [yx, yy, yz] = S[1],
      [zx, zy, zz] = S[2],
      N = [
        [xx + yy + zz, yz - zy, zx - xz, xy - yx],
        [yz - zy, xx - yy - zz, xy + yx, zx + xz],
        [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
        [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
      ],
      e = eigen(N),
      i = e.values.indexOf(Math.max(...e.values)),
      [w, x, y, z] = e.vectors.map((r) => r[i]);
    return [
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ];
  }
  function rotationOnly(a, b, f, random = Math.random) {
    let best = [];
    for (let n = 0; n < 40; n++) {
      let ids = new Set();
      while (ids.size < 3) ids.add(Math.floor(random() * a.length));
      let R = fitRotation(a, b, [...ids]),
        inliers = [];
      for (let i = 0; i < a.length; i++) {
        let q = mv(R, [...a[i], 1]);
        if (
          q[2] > 0 &&
          Math.hypot(q[0] / q[2] - b[i][0], q[1] / q[2] - b[i][1]) * f < 1.3
        )
          inliers.push(i);
      }
      if (inliers.length > best.length) best = inliers;
      if (best.length > a.length * 0.9) break;
    }
    return best.length > a.length * 0.82;
  }
  root.VOGeometry = {
    I,
    tr,
    mul,
    mv,
    dot,
    norm,
    unit,
    med,
    estimate,
    eigen,
    fitRotation,
    rotationOnly,
  };
  if (typeof module !== "undefined") module.exports = root.VOGeometry;
})(globalThis);
