// State regression: retain the reason while inference is throttled and replace
// an unusable initial reference, even when descriptor matches are plentiful.
const assert = require("node:assert/strict");
global.VOGeometry = require("../geometry.js");
const { Tracker } = require("../tracker.js");
const { render, trajectory, K } = require("./fixtures.cjs");
require("../vendor/opencv.js").then(async (cv) => {
  const tracker = new Tracker(cv, { processHz: 10, learnedMode: true });
  const pose = trajectory(0, "static");
  const gray = render(cv, pose.R, pose.C);
  const learned = {
    points: Array.from({ length: 60 }, (_, i) => [20 + i, 50]),
  };
  const matcher = {
    extract: async () => learned,
    match: async () => learned.points.map((_, i) => [i, i, 1]),
  };
  try {
    await tracker.processAsync(gray, K, matcher);
    const oldKey = tracker.initKey;
    oldKey.time = performance.now() - 3000;
    tracker.nextLearnedAt = 0;
    tracker.flow = () => []; // Descriptor matches exist, but all pixel checks fail.
    const failure = await tracker.processAsync(gray, K, matcher);
    assert.equal(failure.initialization.stage, "matches");
    assert.equal(failure.initialization.learnedMatches, 60);
    assert.notEqual(tracker.initKey, oldKey);
    tracker.nextLearnedAt = Infinity;
    const throttled = await tracker.processAsync(gray, K, matcher);
    assert.equal(throttled.status, failure.status);
    assert.equal(throttled.reason, failure.reason);
    tracker.reset();
    await tracker.processAsync(gray, null, matcher);
    const missingK = await tracker.processAsync(gray, null, matcher);
    assert.equal(missingK.phase, "uncalibrated");
    assert.equal(missingK.pose, null);
    assert.equal(tracker.initKey, null);
    console.log("PASS: initialization reason, stale reference, missing K");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    gray.delete();
    tracker.reset();
  }
});
