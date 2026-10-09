// Adapted from the upstream TrendChart (MIT). Keep nulls as gaps and show isolated measurements.
import { useState } from "react";
import type { Sample } from "../types";
import { elapsed, formatNumber, numeric } from "../utils/metrics";
export function TrendChart({
  samples,
  title,
  unit,
  series,
  active,
  onInspect,
}: {
  samples: Sample[];
  title: string;
  unit: string;
  series: {
    key: "throughput" | "bandwidth" | "p50" | "p99";
    label: string;
    color: string;
  }[];
  active: number | null;
  onInspect: (index: number | null) => void;
}) {
  const [focused, setFocused] = useState(false);
  const values = samples.flatMap((s) =>
    series.map((l) => s[l.key]).filter((v): v is number => numeric(v) !== null),
  );
  const max = values.reduce((largest, v) => Math.max(largest, v), 1) * 1.12;
  const first = samples[0]?.elapsed ?? 0,
    last = samples.at(-1)?.elapsed ?? first,
    span = Math.max(1, last - first);
  const x = (s: Sample) =>
    samples.length === 1 ? 406 : 60 + ((s.elapsed - first) / span) * 692;
  const y = (v: number) => 154 - (v / max) * 130;
  const inspected = active === null ? samples.at(-1) : samples[active];
  const tick = (v: number) =>
    v >= 1e6
      ? `${formatNumber(v / 1e6, 1)}M`
      : v >= 1e3
        ? `${formatNumber(v / 1e3, 1)}k`
        : formatNumber(v, 1);
  return (
    <article className="chart">
      <div className="chart-heading">
        <h3>{title}</h3>
        <span>{unit}</span>
      </div>
      <div className="legend">
        {series.map((l) => (
          <span key={l.key}>
            <i style={{ background: l.color }} />
            {l.label}
            <strong>{formatNumber(inspected?.[l.key], 2)}</strong>
          </span>
        ))}
      </div>
      {!values.length ? (
        <div className="empty-chart">
          No measured {title.toLowerCase()} in this window
        </div>
      ) : (
        <>
          <svg
            viewBox="0 0 780 190"
            role="img"
            aria-label={`${title} over elapsed time`}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect(),
                t =
                  first +
                  Math.min(
                    1,
                    Math.max(
                      0,
                      (((e.clientX - r.left) / r.width) * 780 - 60) / 692,
                    ),
                  ) *
                    span;
              onInspect(
                samples.reduce(
                  (best, s, i) =>
                    Math.abs(s.elapsed - t) <
                    Math.abs(samples[best].elapsed - t)
                      ? i
                      : best,
                  0,
                ),
              );
            }}
            onPointerLeave={() => {
              if (!focused) onInspect(null);
            }}
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1="60"
                  x2="752"
                  y1={y(max * f)}
                  y2={y(max * f)}
                  className="grid"
                />
                <text x="50" y={y(max * f) + 4} textAnchor="end">
                  {tick(max * f)}
                </text>
              </g>
            ))}
            {series.map((l) => {
              const segments: Sample[][] = [];
              let part: Sample[] = [];
              for (const s of samples) {
                if (s[l.key] === null) {
                  if (part.length) segments.push(part);
                  part = [];
                } else part.push(s);
              }
              if (part.length) segments.push(part);
              return (
                <g key={l.key}>
                  {segments.map((ss, i) => (
                    <g key={i}>
                      <polyline
                        fill="none"
                        stroke={l.color}
                        strokeWidth="2.5"
                        points={ss
                          .map((s) => `${x(s)},${y(s[l.key]!)}`)
                          .join(" ")}
                      />
                      {ss.length === 1 && (
                        <circle
                          cx={x(ss[0])}
                          cy={y(ss[0][l.key]!)}
                          r="4"
                          fill={l.color}
                        />
                      )}
                    </g>
                  ))}
                </g>
              );
            })}
            {(samples.length === 1 ? [0.5] : [0, 0.5, 1]).map((f) => (
              <text
                key={f}
                x={60 + 692 * f}
                y="179"
                textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
              >
                {elapsed(
                  samples.length === 1 ? first : first + (last - first) * f,
                )}
              </text>
            ))}
            {active !== null && samples[active] && (
              <line
                x1={x(samples[active])}
                x2={x(samples[active])}
                y1="24"
                y2="154"
                stroke="#8393a8"
                strokeDasharray="4 4"
              />
            )}
          </svg>
          <label className="chart-inspector">
            Inspect time
            <input
              aria-label={`Inspect ${title} sample`}
              type="range"
              min="0"
              max={Math.max(0, samples.length - 1)}
              value={active ?? Math.max(0, samples.length - 1)}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                onInspect(null);
              }}
              onChange={(e) => onInspect(Number(e.target.value))}
            />
          </label>
        </>
      )}
    </article>
  );
}
