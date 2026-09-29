// Browser test harness: real ONNX inference and real LK / geometric checks.
importScripts(
  "../geometry.js",
  "../tracker.js",
  "../learned-matcher.js",
  "../vendor/ort/ort.webgpu.min.js",
  "../vendor/opencv.js",
);
let api;
const ready = new Promise((resolve) =>
  cv.then((c) => {
    api = c;
    resolve();
  }),
);
const assert = (ok, message) => {
  if (!ok) throw Error(message);
};
onmessage = async ({ data: d }) => {
  let matcher, tracker;
  try {
    await ready;
    matcher = await new PocketLearned.LearnedMatcher(api, {
      baseURL: new URL("../", location.href).href,
    }).init(d.forceWasm);
    if (d.type === "pair") {
      let features = [];
      for (const data of d.frames) {
        const gray = api.matFromArray(
          d.height,
          d.width,
          api.CV_8UC1,
          new Uint8Array(data),
        );
        try {
          features.push(await matcher.extract(gray));
        } finally {
          gray.delete();
        }
      }
      const matches = await matcher.match(features[0], features[1]);
      postMessage({
        ok: true,
        backend: matcher.backend,
        stats: matcher.stats,
        features: features.map((f) => ({
          ...f,
          descriptors: Array.from(f.descriptors),
        })),
        matches,
      });
    } else {
      tracker = new PocketTracker.Tracker(api, {
        processHz: 10,
        learnedMode: true,
      });
      const log = [];
      for (let i = 0; i < d.frames.length; i++) {
        const gray = api.matFromArray(
          d.height,
          d.width,
          api.CV_8UC1,
          new Uint8Array(d.frames[i]),
        );
        // Bypass only the cheap tracking decision in one frame, to deterministically
        // exercise learned reacquisition. The learned matches and final PnP are real.
        const original = tracker.process;
        if (i === d.forceRecoveryAt)
          tracker.process = function (...args) {
            const pnp = this.pnp;
            this.pnp = () => null;
            try {
              return original.apply(this, args);
            } finally {
              this.pnp = pnp;
            }
          };
        tracker.nextLearnedAt = 0; // Feed recorded frames without real-time sleeps.
        try {
          const r = await tracker.processAsync(gray, d.K, matcher);
          log.push({
            phase: r.phase,
            segment: r.segment,
            pose: r.pose,
            learnedInitializations: r.learnedInitializations,
            learnedRecoveries: r.learnedRecoveries,
            references: r.referenceFrames,
          });
        } finally {
          gray.delete();
          tracker.process = original;
        }
      }
      const initialized = log.filter((r) => r.phase === "tracking");
      if (d.expectNoInitialization)
        assert(!initialized.length, "static/rotation initialized translation");
      else {
        assert(initialized.length > 0, "no learned initialization");
        assert(
          log.at(-1).learnedInitializations === 1,
          "unexpected number of initializations",
        );
        assert(
          new Set(log.map((r) => r.segment)).size === 1,
          "map was discarded",
        );
        if (d.forceRecoveryAt !== undefined)
          assert(
            log.at(-1).learnedRecoveries > 0,
            "learned recovery not exercised",
          );
      }
      postMessage({
        ok: true,
        backend: matcher.backend,
        stats: matcher.stats,
        log,
      });
    }
  } catch (e) {
    postMessage({ ok: false, error: String(e), stack: e.stack });
  } finally {
    tracker?.reset();
    await matcher?.dispose();
  }
};
