import { Download, FileText } from "lucide-react";
import type { Story } from "../lib/types";
import { Notice } from "./ui";

export default function StoryOutputs({ story, siteNames }: { story: Story; siteNames: Record<string, string> }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <div>
          <div className="mb-2 text-sm font-semibold">Impact reel</div>
          {story.reel?.url ? (
            <video src={story.reel.url} controls playsInline className="aspect-[9/16] w-full rounded-xl bg-black" />
          ) : (
            <Notice tone="amber">Reel not available{story.reel_error ? `: ${story.reel_error}` : ""}</Notice>
          )}
        </div>
        <div className="space-y-4">
          {story.composites?.map((c) => (
            <div key={c.site_id}>
              <div className="mb-1 text-sm font-semibold">{siteNames[c.site_id] ?? "Site"}: before | after</div>
              <a href={c.url} target="_blank" rel="noreferrer">
                <img src={c.url} alt="Before and after" className="w-full rounded-xl ring-1 ring-stone-200" loading="lazy" />
              </a>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {story.pack?.url && (
              <a href={story.pack.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-800">
                <FileText className="size-4" /> Verification pack (PDF)
              </a>
            )}
            {story.reel?.url && (
              <a href={story.reel.url} download className="inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-medium ring-1 ring-stone-300 hover:bg-stone-100">
                <Download className="size-4" /> Reel (MP4)
              </a>
            )}
          </div>
          {story.pack_error && <Notice tone="amber">PDF not available: {story.pack_error}</Notice>}
        </div>
      </div>
      {story.social && story.social.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold">Social posts (Cloudinary smart crop, faces blurred)</div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {story.social.map((s) =>
              (["square", "vertical", "wide"] as const).map((k) => (
                <a key={`${s.evidence_id}-${k}`} href={s[k]} target="_blank" rel="noreferrer" className="shrink-0">
                  <img src={s[k]} alt={`${k} post`} className={`h-44 rounded-lg ring-1 ring-stone-200 ${k === "vertical" ? "aspect-[9/16]" : k === "square" ? "aspect-square" : "aspect-[1200/630]"} object-cover`} loading="lazy" />
                  <div className="mt-1 text-center text-xs capitalize text-stone-500">{k}</div>
                </a>
              )),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
