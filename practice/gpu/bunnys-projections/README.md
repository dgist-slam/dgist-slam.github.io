# Browser point-cloud playground

[Open the live lab](https://dgist-slam.github.io/practice/gpu/bunnys-projections/) · [Python / CUDA and Colab lab](https://github.com/team-aprl/lecture-RT616-public/tree/main/practice/gpu/bunnys_projections)

An installation-free RT616 exercise: render Stanford point clouds on the visitor's own computer. WebGL2 uses instanced points, a vertex shader and a depth buffer; a JavaScript worker supplies the CPU implementation. No rendering server, account, CUDA installation, npm dependency or Docker is needed. A compatible browser can use NVIDIA, AMD, Intel or Apple graphics. WebGL availability alone does not guarantee hardware acceleration; the page displays the renderer when the browser permits it and flags common software renderers. A CPU fallback is available.

## Try it

Choose a model, grid (2–64 per side), point count, and camera path. Drag to turn, scroll to approach, or play Hover, Orbit, Dolly, Helix and Fly-through trajectories. Start with 8×8 and 12,000 points/model; 64×64×100,000 means 409.6 million vertex invocations per frame and can be slow. The model is stored once, with instance offsets calculated in the shader.

Run K frames to compare the same scene and camera poses. The log and browser console report each frame; JSON exports settings, camera poses and timings. Stop takes effect after the current frame. Three warm-up frames per backend are excluded and measurement order alternates.

- **CPU ms:** worker projection, nearest camera-Z buffer and color conversion; excludes worker messaging and display.
- **GPU wall ms:** uniform updates, clear, draw and synchronous 640×480 RGBA readback. The point buffer is already resident.
- **GPU timer ms:** `EXT_disjoint_timer_query_webgl2` GPU command duration, when supported. Unavailable, disjoint or timed-out samples are null, never fabricated.
- **Live GPU submit ms:** JavaScript command submission only, explicitly not GPU execution time. Live displayed FPS includes scheduling and browser presentation and is refresh-rate limited.

This compares JavaScript CPU rendering against the WebGL graphics pipeline, not Numba against CUDA. The native exercise is a separate implementation. CPU double arithmetic, GPU float arithmetic and rasterization/depth precision can differ at edge pixels. Both use 640×480, focal length 500, one-pixel points, camera-Z coloring and the same near/far cutoff. CPU work happens in a worker to keep controls responsive. Benchmark images are not sent to a server; standard GitHub Pages asset requests still occur.

## Run locally / edit

From this repository root:

```sh
python -m http.server 8770 --bind 127.0.0.1
```

Open `http://127.0.0.1:8770/practice/gpu/bunnys-projections/`. Opening HTML via `file://` will not load worker/data assets correctly. GitHub Pages serves this directory directly from `main`; no build step is required.

Files: `app.js` (WebGL, camera, UI, benchmark), `cpu-worker.js` (CPU), `index.html` / `style.css`, `data/` (model manifest and point buffers). This browser edition was added on 2026-09-09 alongside the existing Python/CUDA edition.

To rebuild the data, install `numpy` and `plyfile`, then run `python build_data.py` in this directory. Original archives are cached in ignored `.model-cache/`. See [validation results](VALIDATION.md) for tested hardware and limits.

## Model provenance

Source: [Stanford 3D Scanning Repository](https://graphics.stanford.edu/data/3Dscanrep/). Bunny, Dragon, Happy Buddha and Drill retain their original rights and source usage conditions; these assets are not newly licensed by this repository. This is an educational rendering experiment. See Stanford's repository for acknowledgments and model details.

`data/models.json` records source archives, SHA-256 of each original archive and derived buffer, original point counts, sample counts and layout. The buffers are little-endian float32 XYZ, centered horizontally, translated to ground level and normalized to unit height; deterministic NumPy seed 616 samples at most 100,000 vertices, then shuffles them for prefix sampling. All four buffers together are about 2.9 MB. Model data is downloaded once per load (browser caching may avoid repeated transfers), not once per rendered frame.

GPU timing reference: [MDN timer query extension](https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query).
