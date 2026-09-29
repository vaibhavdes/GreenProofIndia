import { ArrowLeftRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import BeforeAfter from "../../components/BeforeAfter";
import { Button, Empty, inputClass } from "../../components/ui";
import { api } from "../../lib/api";
import { captureTime, fmtDate, waterText } from "../../lib/format";
import type { Site } from "../../lib/types";
import type { TabProps } from "../ProjectPage";

function PairPicker({ site, props }: { site: Site; props: TabProps }) {
  const { project, setProject, onError } = props;
  const images = project.evidence
    .filter((e) => e.site_id === site.id && e.status === "ready" && e.resource_type === "image" && e.review?.status !== "rejected")
    .sort((a, b) => (captureTime(a) ?? "").localeCompare(captureTime(b) ?? ""));
  const [before, setBefore] = useState(site.pair?.before ?? images[0]?.id ?? "");
  const [after, setAfter] = useState(site.pair?.after ?? images[images.length - 1]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    try {
      setProject(await api.updateSite(project.id, site.id, body));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  if (images.length < 2) return null;
  const label = (id: string) => {
    const e = images.find((i) => i.id === id)!;
    return `${fmtDate(captureTime(e))} · ${e.activities?.[0]?.name ?? e.caption ?? e.public_id.split("/").pop()}`;
  };
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="min-w-[200px] flex-1">
        <span className="mb-1 block text-xs text-stone-500">Before</span>
        <select className={inputClass} value={before} onChange={(e) => setBefore(e.target.value)}>
          {images.map((e) => (
            <option key={e.id} value={e.id}>
              {label(e.id)}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-[200px] flex-1">
        <span className="mb-1 block text-xs text-stone-500">After</span>
        <select className={inputClass} value={after} onChange={(e) => setAfter(e.target.value)}>
          {images.map((e) => (
            <option key={e.id} value={e.id}>
              {label(e.id)}
            </option>
          ))}
        </select>
      </label>
      <Button variant="secondary" busy={busy} onClick={() => save({ pair: { before, after } })} disabled={before === after}>
        Use this pair
      </Button>
      {site.pair && !site.pair.auto && (
        <Button variant="ghost" onClick={() => save({ clear_pair: true })}>
          <RotateCcw className="size-4" /> Automatic
        </Button>
      )}
    </div>
  );
}

export default function CompareTab(props: TabProps) {
  const { project } = props;
  const byId = new Map(project.evidence.map((e) => [e.id, e]));
  if (project.sites.length === 0) {
    return <Empty icon={<ArrowLeftRight className="size-10" />} title="No sites yet">Add a site and upload photos taken at different times.</Empty>;
  }
  return (
    <div className="space-y-8">
      <p className="text-sm text-stone-600">
        GreenProof pairs photos of each site taken at least two weeks apart. When both have GPS, their positions must be within 150 m; compass direction helps rank candidates.
        Cloudinary applies the same crop and face blur to both photos. You can also choose a pair yourself.
      </p>
      {project.sites.map((site) => {
        const pair = site.pair;
        const before = pair && byId.get(pair.before);
        const after = pair && byId.get(pair.after);
        return (
          <section key={site.id} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-stone-200 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold">{site.name}</h3>
              {pair && (
                <span className="text-xs text-stone-500">
                  {pair.auto ? "Auto-paired" : "Chosen"} · {pair.reason}
                </span>
              )}
            </div>
            {before && after ? (
              <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <BeforeAfter before={before} after={after} />
                <div className="space-y-3 text-sm">
                  {[before, after].map((e, i) => (
                    <button key={e.id} onClick={() => props.openEvidence(e)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left ring-1 ring-stone-200 hover:ring-emerald-500">
                      <img src={e.views?.thumb} alt="" className="h-14 w-20 rounded-lg object-cover" />
                      <div className="min-w-0">
                        <div className="font-medium">{i === 0 ? "Before" : "After"} · {fmtDate(captureTime(e))}</div>
                        <div className="truncate text-xs text-stone-500">
                          {e.activities?.map((a) => a.name).join(", ") || e.caption} · Proof {e.proof?.score}
                        </div>
                      </div>
                    </button>
                  ))}
                  {site.metrics.water && (
                    <div className="rounded-xl bg-sky-50 p-3 text-sky-900">
                      {waterText(site.metrics.water)}
                    </div>
                  )}
                  {site.metrics.survival && (
                    <div className="rounded-xl bg-emerald-50 p-3 text-emerald-900">
                      <b>{site.metrics.survival.pct}%</b> of saplings alive ({site.metrics.survival.alive}/{site.metrics.survival.planted})
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="rounded-xl bg-stone-50 p-4 text-sm text-stone-500">
                Needs at least two photos of this site taken two or more weeks apart ({site.metrics.photos} photo(s) so far).
              </p>
            )}
            <PairPicker key={`${pair?.before}-${pair?.after}`} site={site} props={props} />
          </section>
        );
      })}
    </div>
  );
}
