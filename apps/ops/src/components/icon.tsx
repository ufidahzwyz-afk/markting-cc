import type { CSSProperties } from "react";

export type IconName = "grid" | "layers" | "chart" | "gear" | "arrow" | "chevron" | "check" | "clock" | "alert" | "link" | "lock" | "search" | "close" | "file" | "play" | "eye" | "filter" | "reset";

const paths: Record<IconName, string[]> = {
  grid: ["M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"],
  layers: ["m12 3 10 5-10 5L2 8l10-5Z", "m2 12 10 5 10-5", "m2 16 10 5 10-5"],
  chart: ["M4 3v17h17", "M8 15v-4M13 15V7M18 15v-5"],
  gear: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "m9.5 3-.6 2.2-1.9 1-2.1-.6L2.5 10l1.5 1.6v.8L2.5 14l2.4 4.4L7 17.8l1.9 1 .6 2.2h5l.6-2.2 1.9-1 2.1.6 2.4-4.4-1.5-1.6v-.8l1.5-1.6-2.4-4.4-2.1.6-1.9-1L14.5 3h-5Z"],
  arrow: ["M4 12h16", "m14 6 6 6-6 6"],
  chevron: ["m9 5 7 7-7 7"],
  check: ["m5 12 4 4L19 6"],
  clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 7v5l3 2"],
  alert: ["m12 3 10 18H2L12 3Z", "M12 9v5M12 17h.01"],
  link: ["m10 13 4-4", "m8 15-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 5 0", "m16 9 2-2a4 4 0 0 0-5-5l-4 4a4 4 0 0 0 0 5"],
  lock: ["M6 10h12v11H6z", "M8 10V6a4 4 0 0 1 8 0v4", "M12 14v3"],
  search: ["M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m15 15 6 6"],
  close: ["m6 6 12 12M18 6 6 18"],
  file: ["M14 2H5v20h14V7l-5-5Z", "M14 2v6h5M8 12h8M8 16h5"],
  play: ["m8 4 12 8-12 8V4Z"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"],
  filter: ["M3 5h18l-7 8v6l-4 2v-8L3 5Z"],
  reset: ["M3 10a9 9 0 1 1 2 9", "M3 4v6h6"],
};

export function Icon({ name, size = 20, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">{paths[name].map((d, index) => <path key={index} d={d} />)}</svg>;
}
