import { AlertTriangle, Film, Loader2, MapPin } from "lucide-react";
import { captureTime, fmtDate, siteName } from "../lib/format";
import type { Evidence, Site } from "../lib/types";
import { GradeChip } from "./ui";

export default function EvidenceCard({ ev, sites, onOpen, match }: { ev: Evidence; sites: Site[]; onOpen: () => void; match?: string | null }) {
  if (ev.status !== "ready") {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl bg-stone-100 p-3 text-center text-xs text-stone-500 ring-1 ring-stone-200">
        {ev.status === "processing" ? (
          <>
            <Loader2 className="size-5 animate-spin text-emerald-700" />
            Cloudinary is analysing…
          </>
        ) : (
          <button onClick={onOpen} className="flex flex-col items-center gap-1 text-red-700">
            <AlertTriangle className="size-5" />
            Could not process: tap for details
          </button>
        )}
      </div>
    );
  }
  const rejected = ev.review?.status === "rejected";
  return (
    <button
      onClick={onOpen}
      className={`group overflow-hidden rounded-xl bg-white text-left ring-1 ring-stone-200 transition hover:shadow-md hover:ring-emerald-500 ${rejected ? "opacity-50" : ""}`}
    >
      <div className="relative aspect-[4/3] bg-stone-200">
        <img src={ev.views?.thumb} alt={ev.caption ?? ""} loading="lazy" className="size-full object-cover" />
        <div className="absolute left-2 top-2 flex gap-1">
          {ev.proof && <GradeChip grade={ev.proof.grade} score={ev.proof.score} />}
        </div>
        {ev.resource_type === "video" && (
          <span className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white">
            <Film className="size-3.5" />
          </span>
        )}
        {match && <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{match} match</span>}
        {rejected && <span className="absolute bottom-2 right-2 rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">REJECTED</span>}
        {ev.review?.status === "accepted" && (
          <span className="absolute bottom-2 right-2 rounded bg-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">ACCEPTED</span>
        )}
      </div>
      <div className="space-y-1 p-2.5">
        <div className="line-clamp-1 text-sm font-medium text-stone-800">{ev.activities?.[0]?.name ?? ev.caption ?? (ev.resource_type === "video" ? "Video" : "Photo")}</div>
        <div className="flex items-center gap-1 text-xs text-stone-500">
          <MapPin className="size-3" />
          <span className="truncate">{siteName(sites, ev.site_id)}</span>
          <span>·</span>
          <span className="shrink-0">{fmtDate(captureTime(ev))}</span>
        </div>
      </div>
    </button>
  );
}
