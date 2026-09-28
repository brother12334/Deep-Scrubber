"use client";

/** Privacy score ring. 100 = nothing actionable found. Colour reflects state. */
export function ScoreRing({ score, size = 148 }: { score: number; size?: number }) {
  const r = (size - 16) / 2;
  const c = 2 * Math.PI * r;
  const tone = score >= 80 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--red)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Privacy score ${score} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-2)" strokeWidth="12" fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={tone}
        strokeWidth="12"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(100, score)) / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 600ms ease" }}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="var(--text)" fontSize={size / 3.6} fontWeight={650}>
        {score}
      </text>
      <text x="50%" y={size / 2 + size / 5} textAnchor="middle" fill="var(--text-faint)" fontSize={11}>
        / 100
      </text>
    </svg>
  );
}
