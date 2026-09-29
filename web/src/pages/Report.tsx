import ImpactStats from "../components/ImpactStats";
import { Droplets, Leaf, ShieldCheck, Trees } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import BeforeAfter from "../components/BeforeAfter";
import EvidenceCard from "../components/EvidenceCard";
import EvidenceDetail from "../components/EvidenceDetail";
import EvidenceTimeline from "../components/EvidenceTimeline";
import SiteMap from "../components/SiteMap";
import StoryOutputs from "../components/StoryOutputs";
import { GradeChip, Notice, Spinner, ViewToggle } from "../components/ui";
import { api } from "../lib/api";
import { fmtDate, waterText } from "../lib/format";
import type { Evidence, Project } from "../lib/types";

export default function Report() {
  const { token = "" } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [layout, setLayout] = useState<"grid" | "timeline">("timeline");

  useEffect(() => {
    api.report(token).then(setProject).catch((e: Error) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Notice tone="red">{error}</Notice>
      </div>
    );
  }
  if (!project) return <Spinner label="Loading report…" />;

  const byId = new Map(project.evidence.map((e) => [e.id, e]));
  const open = byId.get(params.get("item") ?? "") ?? null;
  const setOpen = (ev: Evidence | null) => setParams(ev ? { item: ev.id } : {});
  const story = project.stories[0];
  const siteNames = Object.fromEntries(project.sites.map((s) => [s.id, s.name]));

  return (
    <div className="min-h-screen pb-16">
      <header className="bg-gradient-to-br from-emerald-900 via-emerald-800 to-sky-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-200">
            <Leaf className="size-4" /> GreenProof impact report
          </div>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{project.name}</h1>
          <p className="mt-2 text-emerald-100">
            {[project.org && `Implemented by ${project.org}`, project.funder && `funded by ${project.funder}`, project.start_date && `since ${fmtDate(project.start_date)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {project.description && <p className="mt-3 max-w-3xl text-emerald-50">{project.description}</p>}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8">
        <ImpactStats project={project} />

        {project.summary.length > 0 && (
          <section className="rounded-2xl bg-white p-5 ring-1 ring-stone-200">
            <h2 className="mb-2 font-semibold">Summary</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
              {project.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        {project.sites.map((site) => {
          const before = site.pair && byId.get(site.pair.before);
          const after = site.pair && byId.get(site.pair.after);
          const sm = site.metrics;
          return (
            <section key={site.id} className="space-y-4">
              <div className="flex items-center gap-2">
                {site.kind === "lake" ? <Droplets className="size-5 text-sky-600" /> : <Trees className="size-5 text-emerald-600" />}
                <h2 className="text-xl font-semibold">{site.name}</h2>
                <span className="text-sm text-stone-500">{sm.boundary_ha} ha</span>
              </div>
              <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                {before && after ? (
                  <BeforeAfter before={before} after={after} />
                ) : (
                  <div className="grid place-items-center rounded-xl bg-stone-100 p-8 text-sm text-stone-500">Before/after pending: needs repeat photos</div>
                )}
                <div className="space-y-3">
                  <SiteMap sites={[site]} evidence={project.evidence.filter((e) => e.site_id === site.id)} measurements={project.measurements.filter((x) => x.site_id === site.id)} focusSiteId={site.id} height={220} onEvidenceClick={setOpen} />
                  {sm.water && (
                    <div className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900">
                      {waterText(sm.water)}
                    </div>
                  )}
                  {sm.survival && (
                    <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                      <b>{sm.survival.pct}%</b> survival ({sm.survival.alive}/{sm.survival.planted}, {fmtDate(sm.survival.date)})
                    </div>
                  )}
                  <div className="text-xs text-stone-500">
                    {sm.photos} photos · {sm.videos} videos · average Proof Score {sm.avg_proof ?? "—"}
                  </div>
                </div>
              </div>
            </section>
          );
        })}

        {story && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Story & downloads</h2>
            <StoryOutputs story={story} siteNames={siteNames} />
          </section>
        )}

        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">All evidence, by date captured</h2>
            <span className="flex items-center gap-2 text-xs text-stone-500">
              <GradeChip grade="strong" /> <GradeChip grade="review" /> <GradeChip grade="weak" /> tap any item for its checks and provenance
            </span>
          </div>
          <ViewToggle value={layout} onChange={setLayout} />
          {layout === "timeline" ? (
            <EvidenceTimeline evidence={project.evidence} sites={project.sites} onOpen={setOpen} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {project.evidence.map((ev) => (
                <EvidenceCard key={ev.id} ev={ev} sites={project.sites} onOpen={() => setOpen(ev)} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 text-sm text-stone-600 ring-1 ring-stone-200">
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-stone-800">
            <ShieldCheck className="size-4 text-emerald-700" /> How this evidence was checked
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Every photo and video is stored unchanged in Cloudinary; each item lists its public ID, version and SHA-256 hash so a verifier can match it to the original.</li>
            <li>Proof Score = location (photo GPS inside the site boundary) + capture time + originality (no identical or near-identical file in any project, using Cloudinary perceptual hashes) + file integrity (camera data present, no editing software).</li>
            <li>Activities such as desilting, water-filled lake or saplings planted are recognised by Cloudinary AI; survival counts and water spread are field observations entered by the team.</li>
            <li>Faces are blurred in every photo shown here; videos are included only after the project team has accepted them. This report presents evidence; it does not certify carbon or green credits.</li>
          </ul>
        </section>
      </main>
      {open && <EvidenceDetail ev={open} project={project} onClose={() => setOpen(null)} token={token} />}
    </div>
  );
}
