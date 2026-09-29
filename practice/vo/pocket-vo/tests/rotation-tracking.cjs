const assert = require("node:assert/strict");
const app = require("node:path").resolve(__dirname, "..");
global.VOGeometry = require(app + "/geometry.js");
const G = VOGeometry,
  { Tracker } = require(app + "/tracker.js"),
  { render, trajectory, K } = require(app + "/tests/fixtures.cjs");
require(app + "/vendor/opencv.js").then((cv) => {
  try {
    for (const speed of [0.04, 0.08, 0.12]) {
      let seed = 7341;
      Math.random = () =>
        (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
      let t = new Tracker(cv, { processHz: 10 }),
        r;
      for (let i = 0; i <= 120; i += 3) {
        const p = trajectory(i, "motion"),
          im = render(cv, p.R, p.C);
        r = t.process(im, K);
        im.delete();
      }
      const C = trajectory(120, "motion").C,
        origin = t.pose().position;
      t.learnedMode = true;
      const log = [];
      for (let n = 0; n < 75; n++) {
        const a = 0.4 * Math.sin((n * speed) / 0.4),
          R = [
            [Math.cos(a), 0, Math.sin(a)],
            [0, 1, 0],
            [-Math.sin(a), 0, Math.cos(a)],
          ],
          im = render(cv, R, C);
        r = t.process(im, K);
        im.delete();
        const D = G.mul(G.tr(t.pose().rotation), G.tr(R));
        const angleError = Math.acos(
          Math.max(-1, Math.min(1, (D[0][0] + D[1][1] + D[2][2] - 1) / 2)),
        );
        log.push({
          angleError,
          n,
          a,
          phase: r.phase,
          inliers: r.inliers,
          reason: r.reason,
          drift: G.norm(t.pose().position.map((x, i) => x - origin[i])),
        });
      }
      assert(
        log.filter((x) => x.phase === "tracking").length >= 70,
        "rotation tracking fell below 70/75",
      );
      assert(
        Math.max(...log.map((x) => x.drift)) < 0.03,
        "rotation position drift exceeds tolerance",
      );
      const maxAngleError = Math.max(
        ...log.filter((x) => x.phase === "tracking").map((x) => x.angleError),
      );
      assert(maxAngleError < 0.03, "tracked rotation exceeds 0.03 rad error");
      console.log(
        JSON.stringify({
          speed,
          tracking: log.filter((x) => x.phase === "tracking").length,
          maxAngleError,
          maxDrift: Math.max(...log.map((x) => x.drift)),
          failures: log.filter((x) => x.phase === "lost"),
        }),
      );
      t.reset();
    }
    console.log("PASS: fast rotation, reversals, bounded position drift");
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
});
