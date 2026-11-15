// Reduce a heap-soak.mjs JSON: start/end/peak, slope after warm-up, per-minute floor/ceiling, long frames.
import fs from "node:fs";
const j = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const S = j.samples,
  MB = 1048576,
  f = (s) => (s.usedBytes / MB).toFixed(1);
for (const s of S.filter((s) => s.kind !== "sample"))
  console.log(
    s.kind,
    s.tS.toFixed(0),
    f(s),
    "long50",
    s.long50,
    "long33",
    s.long33,
    "maxFrame",
    s.maxFrameMs.toFixed(0),
    "longtasks",
    s.longtasks,
    s.taskMaxMs,
  );
const last = S.at(-1);
console.log("frames", last.frames, "samples", S.length);
const peak = S.reduce((a, b) => (b.usedBytes > a.usedBytes ? b : a));
console.log("peak", f(peak), "at", peak.tS.toFixed(0));
const pk = S.reduce((a, b) => ((b.hudHeap ?? 0) > (a.hudHeap ?? 0) ? b : a));
console.log("hud(perf.memory) peak", ((pk.hudHeap ?? 0) / MB).toFixed(1));
function slope(a) {
  const n = a.length,
    mx = a.reduce((s, p) => s + p[0], 0) / n,
    my = a.reduce((s, p) => s + p[1], 0) / n;
  let nu = 0,
    de = 0;
  for (const [x, y] of a) {
    nu += (x - mx) * (y - my);
    de += (x - mx) ** 2;
  }
  return nu / de;
}
console.log(
  "slope raw MB/min (t>=60s)",
  slope(S.filter((s) => s.tS >= 60).map((s) => [s.tS / 60, s.usedBytes / MB])).toFixed(3),
);
const g = S.filter((s) => s.kind.startsWith("gc"));
console.log("slope forced-GC points MB/min", slope(g.map((s) => [s.tS / 60, s.usedBytes / MB])).toFixed(3));
for (let m = 0; m < j.minutes; m++) {
  const w = S.filter((s) => s.tS >= m * 60 && s.tS < (m + 1) * 60 && s.kind === "sample");
  if (!w.length) continue;
  console.log(
    "min",
    m,
    "lo",
    Math.min(...w.map((s) => s.usedBytes / MB)).toFixed(1),
    "hi",
    Math.max(...w.map((s) => s.usedBytes / MB)).toFixed(1),
    "fps",
    w.at(-1).fps?.toFixed(1),
  );
}
console.log(
  "warnings",
  j.warnings.length,
  j.info.stats?.env?.preset,
  j.info.stats?.env?.backend,
  j.info.stats?.env?.gpu,
);
