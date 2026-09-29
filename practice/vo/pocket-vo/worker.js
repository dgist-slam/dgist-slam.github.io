importScripts(
  "geometry.js?v=xlg1",
  "tracker.js?v=xlg1",
  "learned-matcher.js?v=xlg1",
  "vendor/ort/ort.webgpu.min.js",
  "vendor/opencv.js",
);
let api,
  tracker,
  matcher,
  processing = false,
  pendingReset = false,
  modelError = "";
function modelStatus(message) {
  postMessage({ type: "matcher-status", message });
}
cv.then(async (c) => {
  api = c;
  tracker = new PocketTracker.Tracker(c, { processHz: 10, learnedMode: true });
  modelStatus("XFeat + LighterGlue 모델 준비 중…");
  try {
    matcher = await new PocketLearned.LearnedMatcher(c).init();
    modelStatus(`XFeat + LighterGlue · ${matcher.backend} · 초기화/복구`);
  } catch (e) {
    modelError = String(e);
    matcher = null;
    tracker.learnedMode = false;
    modelStatus("학습 모델 로드 실패 · LK / ORB 대체 모드");
  }
  postMessage({ type: "ready" });
});
onmessage = async ({ data: d }) => {
  if (!tracker) return;
  if (d.type === "reset") {
    if (processing) pendingReset = true;
    else tracker.reset();
    return;
  }
  if (processing) return;
  processing = true;
  const start = performance.now();
  let rgba, gray;
  try {
    rgba = api.matFromArray(
      d.height,
      d.width,
      api.CV_8UC4,
      new Uint8Array(d.pixels),
    );
    gray = new api.Mat();
    api.cvtColor(rgba, gray, api.COLOR_RGBA2GRAY);
    let result;
    if (matcher) {
      try {
        result = await tracker.processAsync(gray, d.intrinsics, matcher);
      } catch (e) {
        // Preserve the map on ML failure. Explicitly disclose the fallback.
        modelError = String(e);
        await matcher.dispose().catch(() => {});
        matcher = null;
        tracker.learnedMode = false;
        modelStatus("학습 매처 실행 실패 · LK / ORB 대체 모드");
        result = tracker.output({
          phase: tracker.initialized ? "lost" : "initializing",
          pose: null,
          status: "학습 매처 실패 · 지도 유지",
          inliers: 0,
          reprojection: null,
        });
      }
    } else result = tracker.process(gray, d.intrinsics);
    postMessage({
      ...result,
      type: "result",
      epoch: d.epoch,
      ms: performance.now() - start,
      matcher: matcher
        ? {
            name: "XFeat + LighterGlue",
            backend: matcher.backend,
            ...matcher.stats,
          }
        : { name: "LK / ORB fallback", error: modelError },
    });
  } catch (e) {
    tracker.reset();
    postMessage({ type: "error", epoch: d.epoch, message: String(e) });
  } finally {
    rgba?.delete();
    gray?.delete();
    processing = false;
    if (pendingReset) {
      tracker.reset();
      pendingReset = false;
    }
  }
};
