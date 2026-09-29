import ImpactStats from "../../components/ImpactStats";
import { Clapperboard, Droplets, Loader2, Trash2, Trees } from "lucide-react";
import { useState } from "react";
import SiteMap from "../../components/SiteMap";
import StoryOutputs from "../../components/StoryOutputs";
import { Button, Field, inputClass, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import { fmtDate, waterText } from "../../lib/format";
import type { LatLng, Site } from "../../lib/types";
import type { TabProps } from "../ProjectPage";

function MeasureForm({ site, props }: { site: Site; props: TabProps }) {
  const { project, setProject, onError } = props;
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [ha, setHa] = useState("");
  const [polygon, setPolygon] = useState<LatLng[] | null>(null);
  const [plot, setPlot] = useState("");
  const [planted, setPlanted] = useState("");
  const [alive, setAlive] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = { site_id: site.id, date, kind: site.kind === "lake" ? "water" : "survival", note: note || null };
      if (site.kind === "lake") {
        if (polygon && polygon.length >= 3) body.water_polygon = polygon;
        else body.water_area_ha = parseFloat(ha);
      } else {
        Object.assign(body, { plot: plot || null, planted: parseInt(planted, 10), alive: parseInt(alive, 10) });
      }
      setProject(await api.addMeasurement(project.id, body));
      setHa("");
      setPolygon(null);
      setPlanted("");
      setAlive("");
      setNote("");
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date observed">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        {site.kind === "lake" ? (
          <Field label="Water spread (ha)">
            <input className={inputClass} inputMode="decimal" value={polygon ? "from map" : ha} disabled={!!polygon} onChange={(e) => setHa(e.target.value)} placeholder="or draw it" />
          </Field>
        ) : (
          <Field label="Sample plot">
            <input className={inputClass} value={plot} onChange={(e) => setPlot(e.target.value)} placeholder="e.g. Plot A (optional)" />
          </Field>
        )}
      </div>
      {site.kind === "lake" ? (
        <div className="space-y-2">
          <Button variant="secondary" onClick={() => setPolygon(polygon ? null : [])}>
            {polygon ? "Cancel drawing" : "Draw water edge on map"}
          </Button>
          {polygon && (
            <>
              <SiteMap sites={[site]} drawing={polygon} onDrawAdd={(p) => setPolygon((d) => [...(d ?? []), p])} focusSiteId={site.id} height={320} />
              <p className="text-xs text-stone-500">Tap along the edge of the water visible on the satellite image or in your field photos ({polygon.length} points).</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Saplings planted">
            <input className={inputClass} inputMode="numeric" value={planted} onChange={(e) => setPlanted(e.target.value)} required />
          </Field>
          <Field label="Alive now">
            <input className={inputClass} inputMode="numeric" value={alive} onChange={(e) => setAlive(e.target.value)} required />
          </Field>
        </div>
      )}
      <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (method, who counted)" />
      <Button type="submit" busy={busy} disabled={site.kind === "lake" ? !(polygon && polygon.length >= 3) && !ha : !planted || !alive}>
        Add observation
      </Button>
    </form>
  );
}

export default function ImpactTab(props: TabProps) {
  const { project, setProject, onError, reload } = props;
  const [busy, setBusy] = useState(false);
  const latest = project.stories[0];
  const siteNames = Object.fromEntries(project.sites.map((s) => [s.id, s.name]));

  async function generate() {
    setBusy(true);
    try {
      await api.createStory(project.id);
      await reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <ImpactStats project={project} />

      {project.summary.length > 0 && (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-stone-200 sm:p-5">
          <h3 className="mb-2 font-semibold">Summary</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
            {project.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-500">Written from this project's evidence and observations; it also opens the verification pack PDF.</p>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        {project.sites.map((site) => {
          const sm = site.metrics;
          const rows = project.measurements.filter((x) => x.site_id === site.id);
          return (
            <div key={site.id} className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-stone-200 sm:p-5">
              <div className="flex items-center gap-2">
                {site.kind === "lake" ? <Droplets className="size-5 text-sky-600" /> : <Trees className="size-5 text-emerald-600" />}
                <h3 className="font-semibold">{site.name}</h3>
                <span className="text-xs text-stone-500">{sm.boundary_ha} ha site</span>
              </div>
              {sm.water && (
                <p className="text-sm">{waterText(sm.water)}</p>
              )}
              {sm.survival && (
                <p className="text-sm">
                  <b>{sm.survival.alive}</b> of {sm.survival.planted} saplings alive on {fmtDate(sm.survival.date)} = <b className="text-emerald-700">{sm.survival.pct}%</b>.
                </p>
              )}
              {rows.length > 0 && (
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-stone-100">
                        <td className="py-1.5 text-stone-500">{r.date}</td>
                        <td className="py-1.5">{r.kind === "water" ? `${r.water_area_ha} ha water${r.water_polygon ? " (mapped)" : ""}` : `${r.plot ? r.plot + ": " : ""}${r.alive}/${r.planted} alive`}</td>
                        <td className="py-1.5 text-right">
                          <button
                            onClick={() => api.deleteMeasurement(project.id, r.id).then(setProject).catch(onError)}
                            className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-red-700"
                            aria-label="Remove"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <MeasureForm site={site} props={props} />
            </div>
          );
        })}
      </section>
      <p className="text-xs text-stone-500">
        Water spread and survival counts are field observations entered by the team, and each one is kept in the audit log. Survival is the figure the Green Credit Programme
        uses: credits are counted per surviving tree after verification.
      </p>

      <section className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-stone-200 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Impact story</h3>
            <p className="text-sm text-stone-500">
              One click: Cloudinary builds a before/after image per site, a 9:16 reel, a verification pack PDF and social crops, all from the original evidence with faces blurred.
            </p>
          </div>
          <Button onClick={generate} busy={busy || latest?.status === "processing"}>
            <Clapperboard className="size-4" /> {latest ? "Regenerate" : "Generate story"}
          </Button>
        </div>
        {latest?.status === "processing" && (
          <p className="flex items-center gap-2 text-sm text-stone-600">
            <Loader2 className="size-4 animate-spin" /> Cloudinary is rendering the reel and PDF…
          </p>
        )}
        {latest?.status === "error" && <Notice tone="red">{latest.error}</Notice>}
        {latest?.status === "ready" && <StoryOutputs story={latest} siteNames={siteNames} />}
      </section>
    </div>
  );
}
