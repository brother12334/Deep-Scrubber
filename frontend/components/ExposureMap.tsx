"use client";

import { useRouter } from "next/navigation";

export interface MapData {
  nodes: Array<{ key: string; label: string; categories: string[]; sources: number; records: number }>;
  search: { key: string; label: string; engines: number; records: number };
}

/**
 * Exposure map (spec §16): identity at the root, one branch per exposure group.
 * Clicking a node opens the matching exposures.
 */
export function ExposureMap({ data }: { data: MapData }) {
  const router = useRouter();
  const nodes = [
    ...data.nodes.map((n) => ({ key: n.key, label: n.label, count: n.sources, unit: n.sources === 1 ? "source" : "sources", href: `/exposures?category=${n.categories.join(",")}`, active: n.records > 0 })),
    { key: "search", label: data.search.label, count: data.search.records, unit: data.search.records === 1 ? "result" : "results", href: "/exposures?tab=search", active: data.search.records > 0 },
  ];
  const W = 960;
  const H = 230;
  const colW = W / nodes.length;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640 }} role="img" aria-label="Where your information is exposed">
        <g>
          <rect x={W / 2 - 80} y={8} width={160} height={40} rx={10} fill="var(--surface-2)" stroke="var(--border-strong)" />
          <text x={W / 2} y={33} textAnchor="middle" fill="var(--text)" fontSize={13} fontWeight={650} letterSpacing="0.06em">
            YOUR IDENTITY
          </text>
        </g>
        {nodes.map((n, i) => {
          const cx = colW * i + colW / 2;
          return (
            <g key={n.key} style={{ cursor: "pointer" }} onClick={() => router.push(n.href)} tabIndex={0} role="link" aria-label={`${n.label}: ${n.count} ${n.unit}`} onKeyDown={(e) => e.key === "Enter" && router.push(n.href)}>
              <path d={`M ${W / 2} 48 C ${W / 2} 90, ${cx} 80, ${cx} 118`} stroke={n.active ? "var(--border-strong)" : "var(--border)"} fill="none" strokeWidth={1.5} strokeDasharray={n.active ? undefined : "4 4"} />
              <rect x={cx - colW / 2 + 8} y={118} width={colW - 16} height={96} rx={12} fill="var(--surface)" stroke={n.active ? "var(--amber)" : "var(--border)"} strokeOpacity={n.active ? 0.6 : 1} />
              <text x={cx} y={142} textAnchor="middle" fill="var(--text-muted)" fontSize={11} fontWeight={600} letterSpacing="0.04em">
                {n.label.toUpperCase()}
              </text>
              <text x={cx} y={180} textAnchor="middle" fill={n.active ? "var(--text)" : "var(--text-faint)"} fontSize={26} fontWeight={650}>
                {n.count}
              </text>
              <text x={cx} y={200} textAnchor="middle" fill="var(--text-faint)" fontSize={11}>
                {n.unit}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
