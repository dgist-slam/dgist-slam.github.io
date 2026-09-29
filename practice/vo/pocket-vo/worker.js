importScripts("geometry.js?v=mapvo2", "tracker.js?v=mapvo2", "vendor/opencv.js");
let api, tracker;
cv.then((c) => {
  api = c;
  tracker = new PocketTracker.Tracker(c);
  postMessage({ type: "ready" });
});
onmessage = ({ data: d }) => {
  if (!tracker) return;
  if (d.type === "reset") {
    tracker.reset();
    return;
  }
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
    const result = tracker.process(gray, d.intrinsics);
    postMessage({
      ...result,
      type: "result",
      epoch: d.epoch,
      ms: performance.now() - start,
    });
  } catch (e) {
    tracker.reset();
    postMessage({ type: "error", epoch: d.epoch, message: String(e) });
  } finally {
    rgba?.delete();
    gray?.delete();
  }
};
