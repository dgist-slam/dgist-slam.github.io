(async () => {
  const reports = {};
  for (const kind of [
    "motion",
    "static",
    "rotation",
    "brightness-motion",
    "brightness-static",
    "brightness-rotation",
  ]) {
    const fixture = await (
      await fetch(
        "tests/generated/" + kind.replace("brightness-", "") + ".json",
      )
    ).json();
    if (kind.startsWith("brightness-")) {
      fixture.frames = fixture.frames.map((a, i) =>
        i < 3 ? a : a.map((v) => Math.min(255, v + 65)),
      );
      delete fixture.forceRecoveryAt;
    }
    const worker = new Worker("tests/learned-worker.js");
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Test timeout " + kind)),
        90000,
      );
      worker.onmessage = (e) => {
        clearTimeout(timer);
        resolve(e.data);
      };
      worker.onerror = reject;
      worker.postMessage({ ...fixture, type: "sequence", forceWasm: true });
    }).finally(() => worker.terminate());
    if (!result.ok) throw Error(kind + ": " + result.error);
    if (
      kind === "brightness-motion" &&
      !result.log.some(
        (r) =>
          r.initialization?.method === "learned+normalized-LK" &&
          r.phase === "tracking",
      )
    )
      throw Error("Normalized LK initialization was not exercised");
    reports[kind] = {
      backend: result.backend,
      trackingFrames: result.log.filter((r) => r.phase === "tracking").length,
      final: result.log.at(-1),
      stats: result.stats,
    };
  }
  return JSON.stringify(reports);
})();
