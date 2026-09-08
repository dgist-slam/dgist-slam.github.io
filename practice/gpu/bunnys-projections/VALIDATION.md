# Validation — 2026-09-09

Tested in a local Chromium browser with WebGL2 on Windows and an NVIDIA GeForce RTX 5070 Ti Laptop GPU (ANGLE / Direct3D11). The timer-query extension was available. This is a device-specific snapshot, not a promised speedup on other hardware.

- Browser page loads; four point-buffer assets and manifest load successfully.
- Default Bunny 8×8, 12,000 points/model renders visibly; K=3 benchmark completes with actual CPU, GPU wall and GPU timer values.
- Dragon 64×64, 12,000 points/model, Fly-through, K=3 completes: CPU mean 443.267 ms, GPU wall mean 25.967 ms, GPU timer mean 24.167 ms in this run.
- Happy Buddha and Drill selection, CPU mode, Dolly and Helix playback exercised; CPU live playback uses a worker.
- JavaScript syntax checks pass; browser reports no uncaught errors in these flows.
- First benchmark frame additionally compares CPU/GPU foreground masks and RGB values outside the measured interval; these metrics are included in JSON. Floating-point edge differences are expected.
- Default Bunny first-frame check: foreground IoU 1.00000, RGB mean absolute error 0.020 / 255.
- Simulated WebGL context loss successfully switches to CPU rendering (768,000 points, 26.20 ms in the observed frame).

Not tested: physical AMD/Intel/Apple GPU devices, mobile browsers, every browser/driver combination. WebGL2 and timer-query support are detected at runtime; unsupported timer measurements remain null.
