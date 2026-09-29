const $ = (id) => document.getElementById(id),
  view = $("view"),
  ctx = view.getContext("2d"),
  video = $("video"),
  input = document.createElement("canvas"),
  ic = input.getContext("2d", { willReadFrequently: true }),
  map = $("map"),
  mc = map.getContext("2d");
const PROCESS_HZ = 10,
  FRAME_INTERVAL = 1000 / PROCESS_HZ;
let worker = new Worker("worker.js?v=rotation1"),
  ready = false,
  running = false,
  busy = false,
  stream = null,
  mode = "",
  generation = 0,
  frameHandle = 0,
  nextFrameAt = 0,
  lastMedia = -1,
  lastResult = 0,
  frameCount = 0,
  demoFrame = 0,
  path = [[0, 0, 0]],
  world = VOGeometry.I(),
  position = [0, 0, 0],
  keyframes = 0;
let xrSource = null,
  xrSupported = false,
  xrPending = false,
  lastXRSize = "";
const scene = [];
let rng = 12345;
function random() {
  rng = (1664525 * rng + 1013904223) >>> 0;
  return rng / 4294967296;
}
for (let i = 0; i < 650; i++)
  scene.push([
    (random() - 0.5) * 18,
    (random() - 0.5) * 12,
    4 + random() * 16,
    100 + random() * 155,
  ]);
function drawMap() {
  const w = map.width,
    h = map.height;
  mc.fillStyle = "#131e28";
  mc.fillRect(0, 0, w, h);
  mc.strokeStyle = "#24333f";
  mc.lineWidth = 1;
  for (let x = 0; x < w; x += 30) {
    mc.beginPath();
    mc.moveTo(x, 0);
    mc.lineTo(x, h);
    mc.stroke();
  }
  for (let y = 0; y < h; y += 30) {
    mc.beginPath();
    mc.moveTo(0, y);
    mc.lineTo(w, y);
    mc.stroke();
  }
  let extent = Math.max(
      0.05,
      ...path.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[2]))),
    ),
    s = (Math.min(w, h) * 0.4) / extent;
  const xy = (p) => [w / 2 + p[0] * s, h / 2 - p[2] * s];
  mc.strokeStyle = "#8df3c3";
  mc.lineWidth = 2.5;
  mc.beginPath();
  path.forEach((p, i) => {
    let [x, y] = xy(p);
    i ? mc.lineTo(x, y) : mc.moveTo(x, y);
  });
  mc.stroke();
  let [x, y] = xy(position);
  mc.fillStyle = "#8df3c3";
  mc.beginPath();
  mc.arc(x, y, 5, 0, 7);
  mc.fill();
  mc.fillStyle = "#93aab8";
  mc.font = "12px sans-serif";
  mc.fillText("X →", w - 45, h - 16);
  mc.fillText("Z ↑", 14, 22);
  mc.fillText(keyframes + " pose updates · relative scale", 14, h - 16);
}
let epoch = 0,
  activeSegment = null,
  fpsAverage = 0;
function reset() {
  activeSegment = null;
  fpsAverage = 0;
  epoch++;
  worker.postMessage({ type: "reset" });
  path = [[0, 0, 0]];
  world = VOGeometry.I();
  position = [0, 0, 0];
  keyframes = 0;
  drawMap();
  $("inliers").textContent = "—";
  $("trackingReason").textContent = "";
  $("segmentNote").textContent =
    "처음에 옆으로 천천히 이동해 3D 지도를 만드세요.";
}
function stop() {
  generation++;
  const oldXR = xrSource;
  xrSource = null;
  if (oldXR) oldXR.stop();
  xrPending = false;
  document.body.classList.remove("xr-active");
  $("fullscreen").disabled = false;
  $("xr").disabled = !ready || !xrSupported;
  running = false;
  cancelAnimationFrame(frameHandle);
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.pause();
  video.srcObject = null;
  $("stop").disabled = true;
  $("camera").disabled = !ready;
  $("demo").disabled = !ready;
  $("mode").textContent = "중지";
  lastMedia = -1;
  window.removeEventListener("devicemotion", onMotion);
  clearInterval(imuTimer);
  imuTimer = null;
  $("imu").disabled = false;
  $("imuState").textContent = "연결 전";
  $("imuHz").textContent = "— Hz";
  for (let id of ["fps", "features", "ms"]) $(id).textContent = "—";
  epoch++;
  worker.postMessage({ type: "reset" });
}
function prepare(name) {
  reset();
  mode = name;
  running = true;
  nextFrameAt = lastResult = 0;
  demoFrame = frameCount = 0;
  $("empty").style.display = "none";
  $("stop").disabled = false;
  $("camera").disabled = true;
  $("demo").disabled = true;
  $("xr").disabled = true;
  $("mode").textContent =
    name === "demo"
      ? "합성 영상"
      : name === "xr"
        ? "Android AR"
        : "일반 카메라";
}
async function startCamera() {
  stop();
  let token = generation;
  $("camera").disabled = true;
  $("status").textContent = "카메라 권한 확인 중…";
  try {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error("카메라는 HTTPS 또는 localhost에서 열어야 합니다.");
    const candidate = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    if (token !== generation) {
      candidate.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = candidate;
    video.srcObject = stream;
    await video.play();
    if (token !== generation) return;
    let ratio = video.videoHeight / video.videoWidth;
    input.width = view.width = 384;
    input.height = view.height = Math.round(384 * ratio);
    view.parentElement.style.aspectRatio = `384 / ${input.height}`;
    prepare("camera");
    showCameraSettings();
    $("status").textContent =
      "시작했습니다. 제자리 회전보다 옆으로 천천히 이동해 보세요.";
    frameHandle = requestAnimationFrame(loop);
  } catch (e) {
    if (token === generation) {
      stop();
      $("status").textContent =
        e.name === "NotAllowedError"
          ? "카메라 권한이 거절되었습니다. 브라우저 설정에서 허용하거나 합성 영상을 이용하세요."
          : e.message;
    }
  }
}
function demo() {
  stop();
  input.width = view.width = 384;
  input.height = view.height = 288;
  view.parentElement.style.aspectRatio = "4 / 3";
  prepare("demo");
  $("status").textContent =
    "합성 3D 장면 · 같은 영상 추적·자세 추정 경로로 계산합니다.";
  frameHandle = requestAnimationFrame(loop);
}
function renderDemo() {
  let f = 384 / (2 * Math.tan((65 * Math.PI) / 360)),
    t = demoFrame++ / PROCESS_HZ,
    cx = 1.5 * Math.sin(t * 0.22),
    cz = 0.4 * Math.sin(t * 0.15);
  ic.fillStyle = "#18232d";
  ic.fillRect(0, 0, 384, 288);
  for (let [x, y, z, l] of scene) {
    let depth = z - cz,
      u = (f * (x - cx)) / depth + 192,
      v = (f * y) / depth + 144,
      size = Math.max(2, 10 / depth);
    if (u < 0 || u > 384 || v < 0 || v > 288) continue;
    ic.fillStyle = `rgb(${l},${l},${l})`;
    ic.fillRect(u - size, v - size, size * 2, size * 2);
    ic.fillStyle = "#101820";
    ic.fillRect(u, v, size, size);
  }
}
function loop(now) {
  if (!running) return;
  frameHandle = requestAnimationFrame(loop);
  if (
    busy ||
    now < nextFrameAt ||
    (mode === "camera" &&
      (video.readyState < 2 || video.currentTime === lastMedia))
  )
    return;
  // Keep a 10 Hz schedule without queuing missed frames.
  nextFrameAt = now + FRAME_INTERVAL - ((now - nextFrameAt) % FRAME_INTERVAL);
  if (mode === "demo") renderDemo();
  else {
    const h = Math.round((384 * video.videoHeight) / video.videoWidth);
    if (h !== input.height) {
      reset();
      input.height = view.height = h;
      view.parentElement.style.aspectRatio = `384 / ${h}`;
      showCameraSettings();
    }
    ic.drawImage(video, 0, 0, input.width, input.height);
    lastMedia = video.currentTime;
  }
  ctx.drawImage(input, 0, 0);
  let data = ic.getImageData(0, 0, input.width, input.height),
    f =
      input.width /
      (2 *
        Math.tan(((mode === "demo" ? 65 : +$("fov").value) * Math.PI) / 360)),
    K =
      mode === "demo" || $("approximate").checked
        ? { fx: f, fy: f, cx: input.width / 2, cy: input.height / 2, skew: 0 }
        : null;
  showK(K, mode === "demo" ? "합성 장면 설정값" : "시야각 추정 · 미보정");
  submitPixels(data.data, input.width, input.height, K);
}

worker.onmessage = (e) => {
  let d = e.data;
  if (d.type === "matcher-status") {
    $("matcherState").textContent = d.message;
    return;
  }
  if (d.type === "ready") {
    ready = true;
    $("camera").disabled = false;
    $("demo").disabled = false;
    $("xr").disabled = !xrSupported;
    $("status").textContent =
      "준비됐습니다. 카메라 또는 합성 영상으로 시작하세요.";
    return;
  }
  busy = false;
  if (!running || d.epoch !== epoch) return;
  if (d.type === "error") {
    $("status").textContent = "계산 오류 · " + d.message;
    stop();
    return;
  }
  let now = performance.now();
  if (lastResult) {
    const hz = 1000 / (now - lastResult);
    fpsAverage = fpsAverage ? 0.85 * fpsAverage + 0.15 * hz : hz;
    $("fps").textContent = fpsAverage.toFixed(1);
  }
  lastResult = now;
  frameCount++;
  $("features").textContent = d.tracks.length;
  if (d.matcher?.backend)
    $("matcherState").textContent =
      `${d.matcher.name} · ${d.matcher.backend} · 매칭 ${d.matcher.lastMatches || 0}점 / ${(d.matcher.lastMs || 0).toFixed(0)} ms · 평소 LK 추적`;
  $("ms").textContent = d.ms.toFixed(0);
  $("resolution").textContent = input.width + " × " + input.height + " / WASM";
  $("status").textContent = d.status + (mode === "demo" ? " · 합성 영상" : "");
  $("inliers").textContent = d.inliers || "—";
  $("mapped").textContent = d.mapPoints || 0;
  $("reprojection").textContent = Number.isFinite(d.reprojection)
    ? d.reprojection.toFixed(2) + " px"
    : "—";
  $("trackingState").textContent =
    d.phase === "tracking"
      ? "추적 중"
      : d.phase === "lost"
        ? d.failedFrames < 3
          ? "검증 대기"
          : "복구 중"
        : d.phase === "uncalibrated"
          ? "K 필요"
          : "초기화";
  $("trackingState").dataset.phase = d.phase;
  $("trackingReason").textContent =
    d.phase === "lost"
      ? `${d.reason || "추적 불확실"} · 기준 영상 ${d.referenceFrames}개 / 지도점 ${d.retainedPoints}개 보존. 이전에 보던 장면으로 돌아가면 복구를 시도합니다.`
      : d.phase === "initializing"
        ? `${d.reason || "기준 영상 준비 중"}${d.initialization?.learnedMatches !== undefined ? ` · LightGlue ${d.initialization.learnedMatches}점 / LK ${d.initialization.lkTracks}점` : ""}`
        : d.referenceFrames
          ? `복구용 기준 영상 ${d.referenceFrames}개 저장`
          : "";
  ctx.lineWidth = 1;
  for (let [x, y, u, v, mapped] of d.tracks) {
    ctx.strokeStyle = mapped ? "#8df3c388" : "#efb56e66";
    ctx.fillStyle = mapped ? "#8df3c3" : "#efb56e";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(u, v);
    ctx.stroke();
    ctx.fillRect(u - 1, v - 1, 2, 2);
  }
  if (activeSegment !== d.segment) {
    if (activeSegment !== null)
      $("segmentNote").textContent =
        "영상 크기 또는 입력이 바뀌어 새 구간을 시작했습니다. 이전 구간과 스케일·좌표가 연결되지 않습니다.";
    activeSegment = d.segment;
    path = [[0, 0, 0]];
    position = [0, 0, 0];
    world = VOGeometry.I();
    keyframes = 0;
    drawMap();
  }
  if (d.pose) {
    position = d.pose.position;
    world = d.pose.rotation;
    path.push(position.slice());
    if (path.length > 2000) path.shift();
    keyframes++;
    drawMap();
  }
  window.voDiagnostics = {
    mode,
    frames: frameCount,
    matcher: d.matcher,
    learnedInitializations: d.learnedInitializations,
    learnedRecoveries: d.learnedRecoveries,
    targetHz: PROCESS_HZ,
    processedHz: fpsAverage,
    keyframes,
    tracks: d.tracks.length,
    mapped: d.mapPoints,
    inliers: d.inliers,
    reprojection: d.reprojection,
    phase: d.phase,
    segment: d.segment,
    recoveries: d.recoveries,
    reason: d.reason,
    initialization: d.initialization,
    references: d.referenceFrames,
    retained: d.retainedPoints,
    failedFrames: d.failedFrames,
    guidedTracks: d.guidedTracks,
    ms: d.ms,
    position: position.slice(),
    pathLength: path.length,
  };
};

worker.onerror = (e) => {
  stop();
  ready = false;
  $("camera").disabled = $("demo").disabled = true;
  $("status").textContent =
    "엔진을 불러오지 못했습니다. 페이지를 새로 열어 주세요. " + e.message;
};
let imuCount = 0,
  imuStart = 0,
  imuLast = 0,
  imuConnectedAt = 0,
  imuTimer = null;
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
function onMotion(e) {
  imuCount++;
  imuLast = performance.now();
  let a = e.acceleration,
    r = e.rotationRate,
    g = e.accelerationIncludingGravity;
  $("acc").textContent = [a?.x, a?.y, a?.z].map(fmt).join(" / ");
  $("gyro").textContent = [r?.alpha, r?.beta, r?.gamma].map(fmt).join(" / ");
  $("gravity").textContent =
    "중력 포함: " + [g?.x, g?.y, g?.z].map(fmt).join(" / ");
  $("imuState").textContent = "수신 중";
}
$("imu").onclick = async () => {
  try {
    if (!isSecureContext) throw new Error("HTTPS에서 연결하세요.");
    if (typeof DeviceMotionEvent === "undefined")
      throw new Error("이 브라우저는 동작 센서를 제공하지 않습니다.");
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      let p = await DeviceMotionEvent.requestPermission();
      if (p !== "granted") throw new Error("동작 센서 권한이 거절되었습니다.");
    }
    window.removeEventListener("devicemotion", onMotion);
    window.addEventListener("devicemotion", onMotion);
    imuCount = 0;
    imuStart = performance.now();
    imuConnectedAt = imuStart;
    imuLast = 0;
    $("imu").disabled = true;
    $("imuState").textContent = "센서 신호 대기…";
    clearInterval(imuTimer);
    imuTimer = setInterval(() => {
      let now = performance.now(),
        elapsed = (now - imuStart) / 1000;
      $("imuHz").textContent =
        (imuCount / Math.max(elapsed, 0.001)).toFixed(1) + " Hz";
      if (now - (imuLast || imuConnectedAt) > 3000) {
        $("imuState").textContent = "신호 없음 · 기기·권한 확인";
        $("imu").disabled = false;
        $("imuHz").textContent = "0 Hz";
      }
      imuCount = 0;
      imuStart = now;
    }, 1000);
  } catch (e) {
    $("imuState").textContent = e.message;
  }
};
$("camera").onclick = startCamera;
$("demo").onclick = demo;
$("stop").onclick = () => {
  stop();
  $("status").textContent = "중지했습니다. 카메라와 센서 연결을 해제했습니다.";
};
$("reset").onclick = reset;
$("fov").oninput = () => {
  $("fovValue").textContent = $("fov").value + "°";
  reset();
};
$("approximate").onchange = reset;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stop();
    $("status").textContent =
      "백그라운드로 전환되어 중지했습니다. 다시 시작해 주세요.";
  }
});
window.addEventListener("pagehide", stop);
drawMap();
function showK(k, label) {
  $("kSource").textContent = k ? label : "K 미제공 · 특징점만 추적";
  $("cameraK").textContent = k
    ? `처리 영상 ${view.width} × ${view.height}\nfx ${k.fx.toFixed(2)}   fy ${k.fy.toFixed(2)}\ncx ${k.cx.toFixed(2)}   cy ${k.cy.toFixed(2)}\nskew ${(k.skew || 0).toFixed(3)} px`
    : "fx —   fy —   cx —   cy —";
}
function showCameraSettings() {
  let track = stream?.getVideoTracks()[0],
    s = track?.getSettings() || {};
  $("cameraInfo").textContent =
    `${track?.label || "카메라"} · 실제 영상 ${video.videoWidth} × ${video.videoHeight} · ${s.frameRate?.toFixed(1) || "—"} Hz · resize ${s.resizeMode || "미제공"} · 내부 행렬 API 없음`;
}
function submitPixels(pixels, width, height, intrinsics) {
  busy = true;
  worker.postMessage(
    { epoch, pixels: pixels.buffer, width, height, intrinsics },
    [pixels.buffer],
  );
}
async function startXR() {
  stop();
  const token = generation;
  xrPending = true;
  $("xr").disabled = true;
  $("camera").disabled = true;
  $("demo").disabled = true;
  $("stop").disabled = false;
  $("status").textContent = "Android AR / 카메라 권한 요청 중…";
  const source = new PocketXRCamera.XRCameraSource({
    processHz: PROCESS_HZ,
    canProcess: () => running && mode === "xr" && !busy,
    onStatus: (message) => {
      if (source === xrSource) $("status").textContent = message;
    },
    onEnd: (message) => {
      if (source === xrSource) {
        stop();
        $("status").textContent = message || "AR 세션 종료";
      }
    },
    onFrame: (pixels, w, h, k, raw) => {
      if (source !== xrSource || !running) return;
      let signature = `${raw.width}x${raw.height}`;
      if (lastXRSize !== signature) {
        reset();
        lastXRSize = signature;
        view.width = input.width = w;
        view.height = input.height = h;
        view.parentElement.style.aspectRatio = `${w} / ${h}`;
      }
      $("cameraInfo").textContent =
        `WebXR 카메라 ${raw.width} × ${raw.height} → 처리 ${w} × ${h} · 동일 프레임의 투영 행렬`;
      showK(k, "WebXR 자동 획득");
      ctx.putImageData(new ImageData(pixels, w, h), 0, 0);
      submitPixels(pixels, w, h, k);
    },
  });
  xrSource = source;
  try {
    await source.start(document.body);
    if (token !== generation || source !== xrSource) return;
    xrPending = false;
    lastXRSize = "";
    prepare("xr");
    document.body.classList.add("xr-active");
    $("fullscreen").disabled = true;
    $("status").textContent = "AR 카메라와 내부 파라미터 수신 대기";
  } catch (e) {
    if (token === generation) {
      stop();
      $("status").textContent =
        `AR 시작 실패: ${e.message} · Android Chrome / ARCore 및 카메라 권한을 확인하세요.`;
    }
  }
}
$("xr").onclick = startXR;
(async () => {
  try {
    xrSupported =
      !!navigator.xr &&
      typeof XRWebGLBinding !== "undefined" &&
      typeof XRWebGLBinding.prototype.getCameraImage === "function" &&
      (await navigator.xr.isSessionSupported("immersive-ar"));
    $("xrSupport").textContent = xrSupported
      ? "Android AR 시작 가능 · Raw Camera 권한과 DOM overlay 지원은 시작 시 확인합니다."
      : "이 브라우저는 AR 카메라 자동 K 경로를 제공하지 않습니다. 지원되는 Android Chrome에서 열어 주세요.";
    $("xr").disabled = !ready || !xrSupported || running || xrPending;
    $("xr").classList.toggle("secondary", !xrSupported);
    $("camera").classList.toggle("secondary", xrSupported);
  } catch (e) {
    $("xrSupport").textContent = "AR 지원을 확인하지 못했습니다: " + e.message;
  }
})();

// Fullscreen is an explicit user action; the physical rotation hint works
// without orientation-lock APIs, including browsers that lack fullscreen.
const fullscreenButton = $("fullscreen");
fullscreenButton.hidden =
  !document.fullscreenEnabled || !document.documentElement.requestFullscreen;
fullscreenButton.onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else
      await document.documentElement.requestFullscreen({
        navigationUI: "hide",
      });
  } catch {
    $("status").textContent =
      "전체 화면을 열 수 없습니다. 휴대폰을 가로로 돌려 사용하세요.";
  }
};
document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent = document.fullscreenElement
    ? "전체 화면 해제"
    : "전체 화면";
  fullscreenButton.setAttribute(
    "aria-pressed",
    String(!!document.fullscreenElement),
  );
});
