const fs = require("fs"),
  path = require("path");
const root = path.resolve(__dirname, "..") + "/";
const { render, trajectory, K, W, H } = require(root + "tests/fixtures.cjs");
require(root + "vendor/opencv.js").then((cv) => {
  try {
    const dir = process.argv[2] || path.join(__dirname, "generated");
    fs.mkdirSync(dir, { recursive: true });
    for (const kind of ["motion", "static", "rotation", "fast-turn"]) {
      const frames = [];
      for (let i = 0; i < 180; i += 6) {
        let { R, C } = trajectory(i, kind);
        if (kind === "fast-turn" && i >= 90) {
          C = trajectory(90, "motion").C;
          const a = 0.4 * Math.sin(((i - 90) / 6) * 0.3);
          R = [
            [Math.cos(a), 0, Math.sin(a)],
            [0, 1, 0],
            [-Math.sin(a), 0, Math.cos(a)],
          ];
        }
        const gray = render(cv, R, C);
        frames.push(Array.from(gray.data));
        gray.delete();
      }
      fs.writeFileSync(
        dir + "/" + kind + ".json",
        JSON.stringify({
          width: W,
          height: H,
          K,
          frames,
          expectNoInitialization: !["motion", "fast-turn"].includes(kind),
          ...(kind === "motion" ? { forceRecoveryAt: 25 } : {}),
        }),
      );
    }
    const { R, C } = trajectory(90, "motion"),
      gray = render(cv, R, C);
    fs.writeFileSync(dir + "/image.bin", gray.data);
    gray.delete();
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
});
