import type { Evidence, Grade, SiteMetrics } from "./types";

export function fmtDate(value?: string | null, withTime = false): string {
  if (!value) return "—";
  const d = new Date(value.length === 19 ? value : value.replace("Z", "+00:00"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

export function captureTime(ev: Evidence): string | undefined {
  return ev.exif?.taken_at ?? ev.uploaded_at?.slice(0, 19);
}

export function fmtBytes(n?: number): string {
  if (!n) return "—";
  return n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`;
}

export const gradeStyle: Record<Grade, { label: string; chip: string; ring: string }> = {
  strong: { label: "Strong", chip: "bg-emerald-100 text-emerald-800 ring-emerald-600/20", ring: "#059669" },
  review: { label: "Needs review", chip: "bg-amber-100 text-amber-800 ring-amber-600/20", ring: "#d97706" },
  weak: { label: "Weak", chip: "bg-red-100 text-red-800 ring-red-600/20", ring: "#dc2626" },
};

export function siteName(sites: { id: string; name: string }[], id?: string | null): string {
  return sites.find((s) => s.id === id)?.name ?? "No site";
}

export function waterText(w: SiteMetrics["water"] & object): string {
  if (w.change_ha === null) return `Water spread ${w.latest_ha} ha on ${fmtDate(w.latest_date)} (one observation so far)`;
  const sign = w.change_ha >= 0 ? "+" : "";
  const pct = w.change_pct !== null ? `, ${sign}${w.change_pct}%` : "";
  return `Water spread ${w.baseline_ha} ha (${fmtDate(w.baseline_date)}) → ${w.latest_ha} ha (${fmtDate(w.latest_date)}): ${sign}${w.change_ha} ha${pct}`;
}
