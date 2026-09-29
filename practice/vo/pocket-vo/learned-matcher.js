/* Official XFeat + XFeat-trained LighterGlue. All images/inference stay on device.
 * Model provenance, licenses and parity results: models/manifest.json.
 */
(function (root) {
  // PyTorch grid_sample(align_corners=false, padding=zeros), cubic coefficient -0.75.
  function cubic(x) {
    x = Math.abs(x);
    return x <= 1
      ? (1.25 * x - 2.25) * x * x + 1
      : x < 2
        ? ((-0.75 * x + 3.75) * x - 6) * x + 3
        : 0;
  }
  function sample(data, w, h, c, x, y, bicubic = false) {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      radius = bicubic ? 2 : 1;
    let value = 0;
    for (let j = 1 - radius; j <= radius; j++)
      for (let i = 1 - radius; i <= radius; i++) {
        const u = ix + i,
          v = iy + j;
        if (u < 0 || v < 0 || u >= w || v >= h) continue;
        const wx = bicubic ? cubic(x - u) : Math.max(0, 1 - Math.abs(x - u));
        const wy = bicubic ? cubic(y - v) : Math.max(0, 1 - Math.abs(y - v));
        value += data[c * w * h + v * w + u] * wx * wy;
      }
    return value;
  }
  function decode(
    outputs,
    width,
    height,
    originalWidth,
    originalHeight,
    maxPoints = 512,
  ) {
    const heat = outputs.heatmap.data,
      dense = outputs.descriptors.data,
      reliability = outputs.reliability.data;
    const dh = outputs.descriptors.dims[2],
      dw = outputs.descriptors.dims[3],
      candidates = [];
    for (let y = 8; y < height - 8; y++)
      for (let x = 8; x < width - 8; x++) {
        const value = heat[y * width + x];
        if (value <= 0.05) continue;
        let maximum = true;
        for (let j = -2; j <= 2 && maximum; j++)
          for (let i = -2; i <= 2; i++)
            if (heat[(y + j) * width + x + i] > value) {
              maximum = false;
              break;
            }
        if (!maximum) continue;
        const u = (x * dw) / (width - 1) - 0.5,
          v = (y * dh) / (height - 1) - 0.5;
        const score = value * sample(reliability, dw, dh, 0, u, v);
        if (score > 0) candidates.push({ x, y, u, v, score });
      }
    candidates.sort((a, b) => b.score - a.score);
    const points = candidates.slice(0, maxPoints),
      descriptors = new Float32Array(points.length * 64);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      let length = 0;
      for (let c = 0; c < 64; c++) {
        const d = sample(dense, dw, dh, c, p.u, p.v, true);
        descriptors[i * 64 + c] = d;
        length += d * d;
      }
      length = Math.max(1e-12, Math.sqrt(length));
      for (let c = 0; c < 64; c++) descriptors[i * 64 + c] /= length;
    }
    return {
      points: points.map((p) => [
        (p.x * originalWidth) / width,
        (p.y * originalHeight) / height,
      ]),
      descriptors,
      width: originalWidth,
      height: originalHeight,
    };
  }
  function filterMatches(scores, n, m, threshold = 0.1) {
    const row = new Int32Array(n),
      col = new Int32Array(m),
      bestRow = new Float32Array(n),
      bestCol = new Float32Array(m);
    bestRow.fill(-Infinity);
    bestCol.fill(-Infinity);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++) {
        const value = scores[i * m + j];
        if (value > bestRow[i]) {
          bestRow[i] = value;
          row[i] = j;
        }
        if (value > bestCol[j]) {
          bestCol[j] = value;
          col[j] = i;
        }
      }
    const matches = [];
    for (let i = 0; i < n; i++) {
      const j = row[i],
        confidence = Math.exp(bestRow[i]);
      if (col[j] === i && confidence > threshold)
        matches.push([i, j, confidence]);
    }
    return matches;
  }
  class LearnedMatcher {
    constructor(cv, { baseURL = new URL(".", location.href).href } = {}) {
      this.cv = cv;
      this.baseURL = baseURL;
      this.backend = "준비 중";
      this.stats = { extractions: 0, matchCalls: 0, lastMatches: 0, lastMs: 0 };
    }
    async init(forceWasm = false) {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = new URL("vendor/ort/", this.baseURL).href;
      const gpu =
        !forceWasm &&
        !!navigator.gpu &&
        !!(await navigator.gpu.requestAdapter());
      try {
        await this.createSessions(gpu ? "webgpu" : "wasm");
      } catch (e) {
        await this.dispose();
        if (!gpu) throw e;
        try {
          await this.createSessions("wasm");
        } catch (second) {
          await this.dispose();
          throw Error(String(e) + "; WASM retry: " + String(second));
        }
        this.fallbackReason = String(e);
      }
      return this;
    }
    async createSessions(provider) {
      // WebGPU may leave unsupported operators on WASM; report the mixed provider honestly.
      const options = {
        executionProviders:
          provider === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
        graphOptimizationLevel: "all",
      };
      this.extractor = await ort.InferenceSession.create(
        new URL("models/xfeat.onnx", this.baseURL).href,
        options,
      );
      this.matcher = await ort.InferenceSession.create(
        new URL("models/lighterglue.onnx", this.baseURL).href,
        options,
      );
      this.backend = provider === "webgpu" ? "WebGPU / WASM" : "WASM";
    }
    async dispose() {
      await this.extractor?.release();
      await this.matcher?.release();
      this.extractor = this.matcher = null;
    }
    async run(session, feeds) {
      try {
        return await this[session].run(feeds);
      } catch (e) {
        if (this.backend !== "WebGPU / WASM") throw e;
        this.fallbackReason = String(e);
        await this.dispose();
        await this.createSessions("wasm");
        return await this[session].run(feeds);
      }
    }
    async extract(gray) {
      const cv = this.cv,
        width = Math.max(32, Math.floor(gray.cols / 32) * 32),
        height = Math.max(32, Math.floor(gray.rows / 32) * 32);
      let resized = new cv.Mat(),
        output,
        tensor;
      try {
        cv.resize(
          gray,
          resized,
          new cv.Size(width, height),
          0,
          0,
          cv.INTER_LINEAR,
        );
        const data = Float32Array.from(resized.data, (x) => x / 255);
        tensor = new ort.Tensor("float32", data, [1, 1, height, width]);
        output = await this.run("extractor", { image: tensor });
        this.stats.extractions++;
        return decode(output, width, height, gray.cols, gray.rows);
      } finally {
        resized.delete();
        tensor?.dispose();
        if (output) Object.values(output).forEach((t) => t.dispose());
      }
    }
    async match(a, b) {
      if (a.points.length < 12 || b.points.length < 12) {
        this.stats.lastMatches = 0;
        return [];
      }
      const start = performance.now(),
        tensors = [];
      const tensor = (data, dims) => {
        const t = new ort.Tensor("float32", data, dims);
        tensors.push(t);
        return t;
      };
      const normalized = (f) =>
        Float32Array.from(
          f.points.flatMap((p) => [
            (p[0] - f.width / 2) / (Math.max(f.width, f.height) / 2),
            (p[1] - f.height / 2) / (Math.max(f.width, f.height) / 2),
          ]),
        );
      let output;
      try {
        output = await this.run("matcher", {
          keypoints0: tensor(normalized(a), [1, a.points.length, 2]),
          keypoints1: tensor(normalized(b), [1, b.points.length, 2]),
          descriptors0: tensor(a.descriptors, [1, a.points.length, 64]),
          descriptors1: tensor(b.descriptors, [1, b.points.length, 64]),
        });
        const matches = filterMatches(
          output.log_scores.data,
          a.points.length,
          b.points.length,
        );
        this.stats.matchCalls++;
        this.stats.lastMatches = matches.length;
        this.stats.lastMs = performance.now() - start;
        return matches;
      } finally {
        tensors.forEach((t) => t.dispose());
        if (output) Object.values(output).forEach((t) => t.dispose());
      }
    }
  }
  root.PocketLearned = { LearnedMatcher, decode, filterMatches, sample };
  if (typeof module !== "undefined") module.exports = root.PocketLearned;
})(globalThis);
