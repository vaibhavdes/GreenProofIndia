import { Film } from "lucide-react";
import { captureTime, gradeStyle, siteName } from "../lib/format";
import type { Evidence, Site } from "../lib/types";

function monthKey(ev: Evidence): string {
  return (captureTime(ev) ?? "").slice(0, 7);
}

function monthLabel(key: string): string {
  if (!key) return "Date unknown";
  const d = new Date(`${key}-01T00:00:00`);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/** Evidence grouped by the month it was captured (camera time, else upload time), oldest first. */
export default function EvidenceTimeline({ evidence, sites, onOpen }: { evidence: Evidence[]; sites: Site[]; onOpen: (ev: Evidence) => void }) {
  const groups = new Map<string, Evidence[]>();
  for (const ev of evidence.filter((e) => e.status === "ready")) {
    const key = monthKey(ev);
    groups.set(key, [...(groups.get(key) ?? []), ev]);
  }
  const months = [...groups.keys()].sort();

  return (
    <ol className="relative space-y-6 border-l-2 border-emerald-200 pl-5">
      {months.map((key) => {
        const items = groups.get(key)!.sort((a, b) => (captureTime(a) ?? "").localeCompare(captureTime(b) ?? ""));
        const activities = new Map<string, number>();
        items.forEach((e) => e.activities?.forEach((a) => activities.set(a.name, (activities.get(a.name) ?? 0) + 1)));
        const siteCount = new Set(items.map((e) => e.site_id)).size;
        return (
          <li key={key} className="relative">
            <span className="absolute -left-[27px] top-1 size-3 rounded-full bg-emerald-600 ring-4 ring-stone-50" />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-semibold">{monthLabel(key)}</h3>
              <span className="text-xs text-stone-500">
                {items.length} item(s) · {siteCount === 1 ? siteName(sites, items[0].site_id) : `${siteCount} sites`}
              </span>
            </div>
            {activities.size > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {[...activities.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([name, n]) => (
                    <span key={name} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                      {name} · {n}
                    </span>
                  ))}
              </div>
            )}
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {items.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => onOpen(ev)}
                  className={`relative shrink-0 overflow-hidden rounded-lg ring-2 hover:opacity-90 ${ev.review?.status === "rejected" ? "opacity-40" : ""}`}
                  style={{ ["--tw-ring-color" as string]: ev.proof ? gradeStyle[ev.proof.grade].ring : "#d6d3d1" }}
                  title={`${ev.caption ?? ""} · Proof ${ev.proof?.score ?? "—"}`}
                >
                  <img src={ev.views?.thumb} alt={ev.caption ?? ""} loading="lazy" className="h-20 w-28 object-cover" />
                  {ev.resource_type === "video" && <Film className="absolute right-1 top-1 size-3.5 text-white drop-shadow" />}
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{ev.proof?.score}</span>
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
