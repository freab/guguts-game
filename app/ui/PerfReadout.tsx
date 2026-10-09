"use client";

import { requestProfile, usePerf } from "../scene/perf/perfStore";

/**
 * #debug frame budget: live frame / GPU time, and the profiler's results — each
 * feature's cost is how much faster the frame got with it switched off.
 */
function formatCount(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : `${Math.round(n)}`;
}

export default function PerfReadout({ className = "" }: { className?: string }) {
  const perf = usePerf();
  const base = perf.rows?.[0];
  const gpu =
    perf.gpuTiming === false ? "n/a" : perf.gpuMs === null ? "…" : `${perf.gpuMs.toFixed(1)} ms`;

  return (
    <div
      className={`pointer-events-auto rounded-md bg-night/70 px-3 py-2 font-mono text-[11px] leading-snug text-cream ${className}`}
    >
      <div>
        frame {perf.frameMs.toFixed(1)} ms ({perf.frameMs ? (1000 / perf.frameMs).toFixed(0) : "–"} fps) · GPU {gpu}
      </div>
      <div>
        CPU update {perf.updateMs.toFixed(1)} ms · render {perf.renderMs.toFixed(1)} ms
      </div>
      {perf.geometry.length > 0 && (
        <table className="mt-1">
          <tbody>
            {perf.geometry.map((g) => (
              <tr key={g.name}>
                <td className="pr-3">{g.name}</td>
                <td className="pr-3 text-right">{formatCount(g.triangles)} tris</td>
                <td className="text-right">{g.draws} draws</td>
              </tr>
            ))}
            <tr className="text-cream/60">
              <td className="pr-3">total</td>
              <td className="pr-3 text-right">{formatCount(perf.geometry.reduce((a, g) => a + g.triangles, 0))} tris</td>
              <td className="text-right">{perf.geometry.reduce((a, g) => a + g.draws, 0)} draws</td>
            </tr>
          </tbody>
        </table>
      )}
      {perf.step ? (
        <div className="text-amber-300">profiling: {perf.step}… stand still</div>
      ) : (
        <button className="mt-1 underline" onClick={requestProfile}>
          Profile frame
        </button>
      )}
      {perf.rows && base && (
        <table className="mt-1">
          <thead className="text-cream/60">
            <tr>
              <th className="pr-3 text-left font-normal">step</th>
              <th className="pr-3 text-right font-normal">fps</th>
              <th className="pr-3 text-right font-normal">frame</th>
              <th className="pr-3 text-right font-normal">GPU</th>
              <th className="pr-3 text-right font-normal">update</th>
              <th className="pr-3 text-right font-normal">render</th>
              <th className="text-right font-normal">saves</th>
            </tr>
          </thead>
          <tbody>
            {perf.rows.map((r) => (
              <tr key={r.name}>
                <td className="pr-3">{r.name}</td>
                <td className="pr-3 text-right">{r.fps.toFixed(0)}</td>
                <td className="pr-3 text-right">{r.frameMs.toFixed(1)}</td>
                <td className="pr-3 text-right">{r.gpuMs?.toFixed(1) ?? "n/a"}</td>
                <td className="pr-3 text-right">{r.updateMs.toFixed(1)}</td>
                <td className="pr-3 text-right">{r.renderMs.toFixed(1)}</td>
                <td className="text-right">{r === base ? "" : (base.frameMs - r.frameMs).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
