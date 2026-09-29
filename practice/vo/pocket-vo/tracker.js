/* Sparse monocular VO: LK tracks -> two-view bootstrap -> persistent 3D map / PnP.
 * Pose convention: X_camera = R * X_map + t. Scale is arbitrary per segment.
 */
(function (root) {
  const G = root.VOGeometry,
    { I, tr, mul, mv, dot, norm, unit, med } = G;
  const add = (a, b) => a.map((v, i) => v + b[i]),
    sub = (a, b) => a.map((v, i) => v - b[i]),
    scale = (a, s) => a.map((v) => v * s);
  function ray(p, k) {
    let y = (p[1] - k.cy) / k.fy;
    return [(p[0] - k.cx - (k.skew || 0) * y) / k.fx, y, 1];
  }
  const center = (R, t) => scale(mv(tr(R), t), -1);
  function project(X, R, t, k) {
    let q = add(mv(R, X), t);
    if (q[2] <= 0) return null;
    return [
      (k.fx * q[0]) / q[2] + ((k.skew || 0) * q[1]) / q[2] + k.cx,
      (k.fy * q[1]) / q[2] + k.cy,
    ];
  }
  function triangulate(p0, k0, R0, t0, p1, k1, R1, t1, minAngle = 0.012) {
    let c0 = center(R0, t0),
      c1 = center(R1, t1),
      u = unit(mv(tr(R0), ray(p0, k0))),
      v = unit(mv(tr(R1), ray(p1, k1))),
      b = dot(u, v),
      den = 1 - b * b;
    if (den < Math.sin(minAngle) ** 2) return null;
    let w = sub(c0, c1),
      d = dot(u, w),
      e = dot(v, w),
      s = (b * e - d) / den,
      t = (e - b * d) / den;
    if (s <= 0 || t <= 0) return null;
    let X = scale(add(add(c0, scale(u, s)), add(c1, scale(v, t))), 0.5),
      q0 = project(X, R0, t0, k0),
      q1 = project(X, R1, t1, k1);
    if (!q0 || !q1 || norm(sub(q0, p0)) > 1.5 || norm(sub(q1, p1)) > 1.5)
      return null;
    return X;
  }
  class Tracker {
    constructor(cv) {
      this.cv = cv;
      this.segment = 0;
      this.reset();
    }
    reset() {
      this.prev?.delete();
      this.key?.gray.delete();
      this.prev = null;
      this.key = null;
      this.features = [];
      this.R = I();
      this.t = [0, 0, 0];
      this.initialized = false;
      this.frame = 0;
      this.failures = 0;
      this.segment++;
      this.error = null;
      this.w = 0;
      this.h = 0;
      this.initAttempt = 0;
      this.recoveries = 0;
    }
    restart(gray, k) {
      this.prev?.delete();
      this.key?.gray.delete();
      this.prev = null;
      this.key = null;
      this.features = [];
      this.R = I();
      this.t = [0, 0, 0];
      this.initialized = false;
      this.failures = 0;
      this.segment++;
      this.detect(gray, k);
    }
    detect(gray, k) {
      const cv = this.cv,
        mask = new cv.Mat(this.h, this.w, cv.CV_8UC1, new cv.Scalar(255)),
        corners = new cv.Mat();
      try {
        for (let f of this.features)
          cv.circle(
            mask,
            new cv.Point(f.p[0], f.p[1]),
            8,
            new cv.Scalar(0),
            -1,
          );
        cv.goodFeaturesToTrack(
          gray,
          corners,
          650,
          0.012,
          7,
          mask,
          3,
          false,
          0.04,
        );
        const counts = Array(48).fill(0),
          cell = (p) =>
            Math.min(7, Math.floor((p[0] * 8) / this.w)) +
            8 * Math.min(5, Math.floor((p[1] * 6) / this.h));
        for (let f of this.features) counts[cell(f.p)]++;
        for (let i = 0; i < corners.rows && this.features.length < 300; i++) {
          let p = [corners.data32F[i * 2], corners.data32F[i * 2 + 1]],
            c = cell(p);
          if (
            p[0] < 12 ||
            p[1] < 12 ||
            p[0] > this.w - 12 ||
            p[1] > this.h - 12 ||
            counts[c] >= 7
          )
            continue;
          counts[c]++;
          this.features.push({
            p,
            base: p.slice(),
            k,
            R: this.initialized ? this.R.map((r) => r.slice()) : I(),
            t: this.initialized ? this.t.slice() : [0, 0, 0],
            X: null,
            age: 0,
          });
        }
      } finally {
        mask.delete();
        corners.delete();
      }
    }
    flow(previous, current, features) {
      if (!features.length) return [];
      const cv = this.cv,
        mats = [];
      let mat = (m) => {
        mats.push(m);
        return m;
      };
      try {
        let p = mat(
            cv.matFromArray(
              features.length,
              1,
              cv.CV_32FC2,
              features.flatMap((f) => f.p),
            ),
          ),
          q = mat(new cv.Mat()),
          ok = mat(new cv.Mat()),
          err = mat(new cv.Mat()),
          back = mat(new cv.Mat()),
          bok = mat(new cv.Mat()),
          be = mat(new cv.Mat()),
          size = new cv.Size(21, 21),
          crit = new cv.TermCriteria(
            cv.TermCriteria_COUNT | cv.TermCriteria_EPS,
            25,
            0.01,
          );
        cv.calcOpticalFlowPyrLK(
          previous,
          current,
          p,
          q,
          ok,
          err,
          size,
          3,
          crit,
        );
        cv.calcOpticalFlowPyrLK(
          current,
          previous,
          q,
          back,
          bok,
          be,
          size,
          3,
          crit,
        );
        let result = [];
        for (let i = 0; i < features.length; i++) {
          let a = features[i],
            x = q.data32F[i * 2],
            y = q.data32F[i * 2 + 1],
            fb = Math.hypot(
              back.data32F[i * 2] - a.p[0],
              back.data32F[i * 2 + 1] - a.p[1],
            );
          if (
            ok.data[i] &&
            bok.data[i] &&
            err.data32F[i] < 30 &&
            fb < 0.8 &&
            x > 8 &&
            y > 8 &&
            x < this.w - 8 &&
            y < this.h - 8
          )
            result.push({ ...a, previous: a.p, p: [x, y], age: a.age + 1 });
        }
        return result;
      } finally {
        mats.forEach((m) => m.delete());
      }
    }
    coverage(features) {
      if (!features.length) return 0;
      let cells = new Set(
        features.map(
          (f) =>
            Math.floor((f.p[0] * 4) / this.w) +
            4 * Math.floor((f.p[1] * 3) / this.h),
        ),
      );
      return cells.size;
    }
    bootstrap(k) {
      this.initMessage =
        "초기화 · 가까운 물체와 먼 배경을 함께 보며 옆으로 이동";
      let fs = this.features.filter((f) => f.k && f.age >= 3);
      if (fs.length < 55 || this.coverage(fs) < 6) return null;
      let flow = med(fs.map((f) => norm(sub(f.p, f.base))));
      if (flow < 7) {
        this.initMessage = "초기화 · 옆으로 조금 더 이동하세요";
        return null;
      }
      let a = fs.map((f) => ray(f.base, f.k).slice(0, 2)),
        b = fs.map((f) => ray(f.p, k).slice(0, 2)),
        rotationOnly = G.rotationOnly(a, b, Math.max(k.fx, k.fy));
      if (rotationOnly) {
        this.initMessage =
          "회전 / 낮은 시차 · 옆으로 이동해야 깊이를 구할 수 있습니다";
        return null;
      }
      let pose = G.estimate(a, b, Math.max(k.fx, k.fy));
      if (!pose || pose.parallax < 0.012) return null;
      // Reject homography-dominated starts: planar/pure-rotation geometry has ambiguous depth.
      const cv = this.cv,
        mats = [];
      try {
        let A = cv.matFromArray(
            fs.length,
            1,
            cv.CV_32FC2,
            fs.flatMap((f) => f.base),
          ),
          B = cv.matFromArray(
            fs.length,
            1,
            cv.CV_32FC2,
            fs.flatMap((f) => f.p),
          ),
          mask = new cv.Mat();
        mats.push(A, B, mask);
        let H = cv.findHomography(A, B, cv.RANSAC, 1.2, mask, 500, 0.995);
        mats.push(H);
        let n = Array.from(mask.data).reduce((s, x) => s + (x ? 1 : 0), 0);
        if (n > fs.length * 0.93) {
          this.initMessage =
            "평면 위주 장면 · 가까운 물체와 먼 배경을 함께 보세요";
          return null;
        }
      } finally {
        mats.forEach((m) => m.delete());
      }
      let landmarks = [];
      for (let i of pose.inliers) {
        let f = fs[i],
          X = triangulate(f.base, f.k, I(), [0, 0, 0], f.p, k, pose.R, pose.t);
        if (X) landmarks.push({ f, X });
      }
      if (landmarks.length < 40 || this.coverage(landmarks.map((l) => l.f)) < 6)
        return null;
      const depth = med(landmarks.map((l) => l.X[2]));
      if (!(depth > 0)) return null;
      const s = 1 / depth;
      this.R = pose.R;
      this.t = scale(pose.t, s);
      this.initialized = true;
      for (let { f, X } of landmarks) f.X = scale(X, s);
      this.features = landmarks.map((l) => l.f);
      return { inliers: this.features.length, error: 0, initialized: true };
    }
    pnp(features, k) {
      let mapped = features.filter((f) => f.X);
      if (mapped.length < 15 || this.coverage(mapped) < 4) return null;
      const cv = this.cv,
        mats = [],
        keep = (m) => {
          mats.push(m);
          return m;
        };
      try {
        const obj = keep(
            cv.matFromArray(
              mapped.length,
              1,
              cv.CV_64FC3,
              mapped.flatMap((f) => f.X),
            ),
          ),
          img = keep(
            cv.matFromArray(
              mapped.length,
              1,
              cv.CV_64FC2,
              mapped.flatMap((f) => ray(f.p, k).slice(0, 2)),
            ),
          ),
          K = keep(cv.matFromArray(3, 3, cv.CV_64F, I().flat())),
          D = keep(new cv.Mat()),
          rv = keep(new cv.Mat()),
          tv = keep(new cv.Mat()),
          inliers = keep(new cv.Mat()),
          RM = keep(new cv.Mat());
        let f = Math.max(k.fx, k.fy),
          ok = cv.solvePnPRansac(
            obj,
            img,
            K,
            D,
            rv,
            tv,
            false,
            100,
            2 / f,
            0.995,
            inliers,
            cv.SOLVEPNP_EPNP,
          );
        if (!ok || inliers.rows < 15 || inliers.rows < mapped.length * 0.5)
          return null;
        let ids = Array.from(inliers.data32S),
          a = keep(
            cv.matFromArray(
              ids.length,
              1,
              cv.CV_64FC3,
              ids.flatMap((i) => mapped[i].X),
            ),
          ),
          b = keep(
            cv.matFromArray(
              ids.length,
              1,
              cv.CV_64FC2,
              ids.flatMap((i) => ray(mapped[i].p, k).slice(0, 2)),
            ),
          );
        if (!cv.solvePnP(a, b, K, D, rv, tv, true, cv.SOLVEPNP_ITERATIVE))
          return null;
        cv.Rodrigues(rv, RM);
        let R = Array.from({ length: 3 }, (_, i) =>
            Array.from(RM.data64F.slice(i * 3, i * 3 + 3)),
          ),
          t = Array.from(tv.data64F),
          valid = [],
          errors = [];
        if (!R.flat().concat(t).every(Number.isFinite)) return null;
        for (let item of mapped) {
          let q = project(item.X, R, t, k),
            err = q ? norm(sub(q, item.p)) : Infinity;
          if (err < 2) {
            valid.push(item);
            errors.push(err);
          }
        }
        if (
          valid.length < 15 ||
          valid.length < mapped.length * 0.5 ||
          this.coverage(valid) < 4 ||
          med(errors) > 1.1
        )
          return null;
        const delta = mul(R, tr(this.R)),
          angle = Math.acos(
            Math.max(
              -1,
              Math.min(1, (delta[0][0] + delta[1][1] + delta[2][2] - 1) / 2),
            ),
          ),
          depth = med(valid.map((f) => add(mv(this.R, f.X), this.t)[2])),
          distance = norm(sub(center(R, t), center(this.R, this.t)));
        if (angle > 0.5 || distance > Math.max(0.08, depth * 0.2)) return null;
        return { R, t, valid, error: med(errors), inliers: valid.length };
      } finally {
        mats.forEach((m) => m.delete());
      }
    }
    saveKey(gray, k) {
      this.key?.gray.delete();
      this.key = {
        gray: gray.clone(),
        features: this.features
          .filter((f) => f.X)
          .map((f) => ({ ...f, p: f.p.slice() })),
        k,
      };
    }
    process(gray, k) {
      this.frame++;
      if (this.w !== gray.cols || this.h !== gray.rows) {
        this.reset();
        this.w = gray.cols;
        this.h = gray.rows;
      }
      let result = {
        pose: null,
        status: "초기화 · 옆으로 천천히 이동",
        phase: "initializing",
        inliers: 0,
        reprojection: null,
        segment: this.segment,
        recovered: false,
      };
      if (!this.prev) {
        this.detect(gray, k);
        this.prev = gray.clone();
        return this.output(result);
      }
      this.features = this.flow(this.prev, gray, this.features);
      if (!k) {
        result.status = "K 미제공 · 특징점만 추적";
        result.phase = "uncalibrated";
        if (this.features.length < 170) this.detect(gray, k);
      } else if (!this.initialized) {
        const seeded = this.features.filter((f) => f.k);
        if (seeded.length < 45) {
          this.features = [];
          this.detect(gray, k);
        } else if (this.frame % 4 === 0) {
          let init = this.bootstrap(k);
          if (init) {
            this.saveKey(gray, k);
            Object.assign(result, {
              phase: "tracking",
              status: "3D 지도 초기화 완료",
              inliers: init.inliers,
              pose: this.pose(),
            });
          } else result.status = this.initMessage;
        }
      } else {
        let solved = this.pnp(this.features, k);
        if (!solved && this.key && this.failures % 2 === 0) {
          let backup = this.flow(this.key.gray, gray, this.key.features),
            recovered = this.pnp(backup, k);
          if (recovered) {
            solved = recovered;
            this.features = backup;
            result.recovered = true;
            this.recoveries++;
          }
        }
        if (solved) {
          this.R = solved.R;
          this.t = solved.t;
          this.failures = 0;
          let valid = new Set(solved.valid);
          this.features = this.features.filter((f) => !f.X || valid.has(f));
          let added = 0;
          for (let f of this.features) {
            if (!f.X && f.k && f.age >= 4 && added < 25) {
              const X = triangulate(
                f.base,
                f.k,
                f.R,
                f.t,
                f.p,
                k,
                this.R,
                this.t,
              );
              if (X) {
                let z = add(mv(this.R, X), this.t)[2];
                if (z > 0.02 && z < 30) {
                  f.X = X;
                  added++;
                }
              }
            }
          }
          this.features = this.features.filter((f) => f.X || f.age < 100);
          if (this.features.length < 230 || this.frame % 8 === 0)
            this.detect(gray, k);
          if (this.frame % 12 === 0 && solved.inliers > 35)
            this.saveKey(gray, k);
          Object.assign(result, {
            phase: "tracking",
            status: result.recovered
              ? "기준 영상에서 추적 복구"
              : "3D 지도 기반 추적",
            pose: this.pose(),
            inliers: solved.inliers,
            reprojection: solved.error,
          });
        } else {
          this.failures++;
          Object.assign(result, {
            phase: "lost",
            status: "추적 불확실 · 위치 유지 / 복구 중",
          });
          if (this.failures >= 24) {
            this.restart(gray, k);
            result.segment = this.segment;
            result.phase = "initializing";
            result.status = "추적 손실 · 새 구간 초기화";
          }
        }
      }
      this.prev?.delete();
      this.prev = gray.clone();
      return this.output(result);
    }
    pose() {
      return { position: center(this.R, this.t), rotation: tr(this.R) };
    }
    output(result) {
      return {
        ...result,
        segment: this.segment,
        mapPoints: this.features.filter((f) => f.X).length,
        tracks: this.features.map((f) => [
          ...(f.previous || f.p),
          ...f.p,
          !!f.X,
        ]),
        recoveries: this.recoveries,
      };
    }
  }
  root.PocketTracker = { Tracker, triangulate, project, ray, center };
  if (typeof module !== "undefined") module.exports = root.PocketTracker;
})(globalThis);
