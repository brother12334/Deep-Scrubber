import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });

export const Icon = {
  dashboard: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>),
  scan: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>),
  exposures: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>),
  removals: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></svg>),
  monitoring: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M3 12h4l3 7 4-14 3 7h4" /></svg>),
  sources: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>),
  reports: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 17v-3M12 17v-6M16 17v-2" /></svg>),
  settings: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>),
  billing: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>),
  help: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>),
  bell: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>),
  menu: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 6h16M4 12h16M4 18h16" /></svg>),
  shield: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg>),
  check: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="m5 12 5 5L20 7" /></svg>),
  warn: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>),
  cycle: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></svg>),
  external: (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M14 3h7v7" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>),
};
