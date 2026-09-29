import { Crosshair, Droplets, FileDown, Pencil, Plus, Search, Trees, Undo2, X } from "lucide-react";
import { useState } from "react";
import SiteMap from "../../components/SiteMap";
import { Button, Field, inputClass, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import { downloadSiteKml } from "../../lib/kml";
import type { LatLng, Site } from "../../lib/types";
import type { TabProps } from "../ProjectPage";

export function PlaceSearch({ onFound }: { onFound: (p: LatLng) => void }) {
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function find(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setMsg(null);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`);
      const [hit] = await r.json();
      if (hit) onFound([+hit.lat, +hit.lon]);
      else setMsg("Place not found");
    } catch {
      setMsg("Search unavailable");
    }
  }
  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (p) => onFound([p.coords.latitude, p.coords.longitude]),
      () => setMsg("Location permission denied"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }
  return (
    <form onSubmit={find} className="flex gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-2.5 size-4 text-stone-400" />
        <input className={`${inputClass} pl-8`} placeholder="Find a lake or village (e.g. Wagholi lake, Pune)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Button variant="secondary" type="submit">
        Go
      </Button>
      <Button variant="secondary" onClick={locate} title="My location">
        <Crosshair className="size-4" />
      </Button>
      {msg && <span className="self-center text-xs text-stone-500">{msg}</span>}
    </form>
  );
}

export default function OverviewTab({ project, setProject, openEvidence, onError }: TabProps) {
  const [drawing, setDrawing] = useState<LatLng[] | null>(null);
  const [editing, setEditing] = useState<Site | "new" | null>(project.sites.length === 0 ? "new" : null);
  const [form, setForm] = useState({ name: "", kind: project.kind === "plantation" ? "plantation" : "lake", baseline_date: "" });
  const [fly, setFly] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  function startNew() {
    setEditing("new");
    setDrawing([]);
    setForm({ name: "", kind: project.kind === "plantation" ? "plantation" : "lake", baseline_date: "" });
  }

  function startRedraw(site: Site) {
    setEditing(site);
    setDrawing([]);
    setFocus(site.id);
  }

  function cancel() {
    setEditing(null);
    setDrawing(null);
  }

  async function save() {
    if (!drawing || drawing.length < 3) return;
    setBusy(true);
    try {
      if (editing === "new") {
        setProject(await api.createSite(project.id, { ...form, boundary: drawing, baseline_date: form.baseline_date || null }));
      } else if (editing) {
        setProject(await api.updateSite(project.id, editing.id, { boundary: drawing }));
      }
      cancel();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  const drawingActive = drawing !== null;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <PlaceSearch onFound={setFly} />
        <SiteMap
          sites={project.sites}
          evidence={project.evidence}
          measurements={project.measurements}
          drawing={drawing}
          onDrawAdd={(p) => setDrawing((d) => [...(d ?? []), p])}
          onEvidenceClick={openEvidence}
          focusSiteId={focus}
          flyTo={fly}
          height={520}
        />
        <p className="text-xs text-stone-500">Dots are evidence with GPS, coloured by Proof Score. Blue outlines are lakes, green outlines are plantations; dashed areas are measured water spread.</p>
      </div>

      <aside className="space-y-4">
        {drawingActive ? (
          <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-emerald-300">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{editing === "new" ? "New site" : `Redraw ${(editing as Site)?.name}`}</h3>
              <button onClick={cancel} aria-label="Cancel" className="rounded p-1 text-stone-500 hover:bg-stone-100">
                <X className="size-4" />
              </button>
            </div>
            <Notice tone="sky">Tap the map at each corner of the site boundary ({drawing!.length} points{drawing!.length < 3 ? ", need 3+" : ""}).</Notice>
            {editing === "new" && (
              <>
                <Field label="Site name">
                  <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Main lake / Plot A" />
                </Field>
                <Field label="Site type">
                  <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                    <option value="lake">Lake / pond</option>
                    <option value="plantation">Plantation plot</option>
                  </select>
                </Field>
                <Field label="Baseline date" hint="When the 'before' condition was recorded (optional)">
                  <input className={inputClass} type="date" value={form.baseline_date} onChange={(e) => setForm({ ...form, baseline_date: e.target.value })} />
                </Field>
              </>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDrawing((d) => (d ?? []).slice(0, -1))} disabled={!drawing!.length}>
                <Undo2 className="size-4" /> Undo
              </Button>
              <Button onClick={save} busy={busy} disabled={drawing!.length < 3 || (editing === "new" && !form.name.trim())} className="flex-1">
                Save site
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={startNew} className="w-full">
            <Plus className="size-4" /> Add a site
          </Button>
        )}

        {editing === "new" && !drawingActive && project.sites.length === 0 && (
          <Notice tone="sky">
            Start by adding a site: find the lake or plot on the map, then tap <b>Add a site</b> and outline it.
          </Notice>
        )}

        {project.sites.map((s) => (
          <div
            key={s.id}
            className={`rounded-2xl bg-white p-4 ring-1 transition ${focus === s.id ? "ring-emerald-500" : "ring-stone-200"}`}
            onMouseEnter={() => setFocus(s.id)}
          >
            <div className="flex items-start gap-3">
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${s.kind === "lake" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>
                {s.kind === "lake" ? <Droplets className="size-5" /> : <Trees className="size-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{s.name}</div>
                <div className="text-xs text-stone-500">
                  {s.metrics.boundary_ha} ha · {s.metrics.photos} photos · {s.metrics.videos} videos
                  {s.metrics.avg_proof != null && ` · avg proof ${s.metrics.avg_proof}`}
                </div>
              </div>
              {s.boundary.length >= 3 && (
                <button onClick={() => downloadSiteKml(s, project.name)} className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" title="Download boundary as KML">
                  <FileDown className="size-4" />
                </button>
              )}
              <button onClick={() => startRedraw(s)} className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" title="Redraw boundary">
                <Pencil className="size-4" />
              </button>
            </div>
            {s.metrics.activities.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {s.metrics.activities.slice(0, 6).map(([name, n]) => (
                  <span key={name} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                    {name} · {n}
                  </span>
                ))}
              </div>
            )}
            {s.metrics.flagged > 0 && <p className="mt-2 text-xs font-medium text-red-700">{s.metrics.flagged} weak or reused item(s) need review</p>}
          </div>
        ))}
      </aside>
    </div>
  );
}
