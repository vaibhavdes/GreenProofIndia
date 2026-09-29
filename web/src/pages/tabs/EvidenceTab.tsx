import { Camera, CloudDownload, ImageUp, Search, Video, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import EvidenceCard from "../../components/EvidenceCard";
import EvidenceTimeline from "../../components/EvidenceTimeline";
import { Button, Empty, inputClass, Notice, ViewToggle } from "../../components/ui";
import { api } from "../../lib/api";
import { openUploader } from "../../lib/uploader";
import type { TabProps } from "../ProjectPage";

const NAME_KEY = "gp_uploader_name";

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

const EXAMPLES = ["dry lakebed with cracks", "excavator desilting", "saplings with tree guards", "lake full of water"];

export default function EvidenceTab({ project, config, reload, openEvidence, onError }: TabProps) {
  const [siteId, setSiteId] = useState("");
  const [name, setName] = useState(storedName());
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [layout, setLayout] = useState<"grid" | "timeline">("grid");
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({ site_id: "", activity: "", grade: params.get("grade") ?? "", media: "" });
  useEffect(() => setFilters((f) => ({ ...f, grade: params.get("grade") ?? "" })), [params]);
  const [results, setResults] = useState<{ items: { id: string; match: string | null }[]; visual: boolean | null } | null>(null);
  const [searching, setSearching] = useState(false);

  const active = q.trim() !== "" || Object.values(filters).some(Boolean);

  useEffect(() => {
    if (!active) {
      setResults(null);
      return;
    }
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await api.search(project.id, { q, ...filters }));
      } catch (e) {
        onError(e);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
    // Re-run when new evidence finishes processing too.
  }, [q, filters, active, project.id, project.evidence.length, onError]);

  const shown = useMemo(() => {
    if (!results) return project.evidence.map((ev) => ({ ev, match: null as string | null }));
    const byId = new Map(project.evidence.map((e) => [e.id, e]));
    return results.items.filter((r) => byId.has(r.id)).map((r) => ({ ev: byId.get(r.id)!, match: r.match }));
  }, [results, project.evidence]);

  function upload(kind: "image" | "video") {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
    let count = 0;
    openUploader({
      config,
      projectId: project.id,
      siteId: siteId || undefined,
      kind,
      uploader: name,
      onUploaded: (publicId, resourceType) => {
        count += 1;
        api.ingest(project.id, publicId, resourceType).then(reload).catch(onError);
      },
      onDone: () => {
        if (count) setNotice(`${count} file(s) uploaded. Cloudinary is tagging, captioning and checking them now.`);
        reload();
      },
      onError: (m) => onError(new Error(m)),
    });
  }

  async function sync() {
    try {
      const { queued } = await api.sync(project.id);
      setNotice(queued ? `Found ${queued} new file(s) in the Cloudinary Media Library.` : "Nothing new in the Media Library for this project.");
      reload();
    } catch (e) {
      onError(e);
    }
  }

  // The most recently processed item tells which Cloudinary AI add-ons are answering.
  const latestAi = [...project.evidence].filter((e) => e.status === "ready" && e.ai).sort((a, b) => (b.uploaded_at ?? "").localeCompare(a.uploaded_at ?? ""))[0]?.ai ?? {};
  const AI_NAMES: Record<string, string> = { captioning: "AI Content Analysis (captions)", google_tagging: "Google Auto Tagging", ai_vision: "AI Vision (activities)" };
  const missingAi = Object.entries(latestAi)
    .filter(([, status]) => status !== "ok")
    .map(([name]) => AI_NAMES[name] ?? name);

  const setFilter = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-4 ring-1 ring-stone-200 sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[180px] flex-1">
            <span className="mb-1 block text-xs font-medium text-stone-600">Site</span>
            <select className={inputClass} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">Match by photo GPS (recommended)</option>
              {project.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[160px] flex-1">
            <span className="mb-1 block text-xs font-medium text-stone-600">Your name (field worker)</span>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" />
          </label>
          <Button onClick={() => upload("image")} disabled={!config.ready}>
            <ImageUp className="size-4" /> Upload photos
          </Button>
          <Button variant="secondary" onClick={() => upload("video")} disabled={!config.ready}>
            <Video className="size-4" /> Upload video
          </Button>
          <Button variant="ghost" onClick={sync} title="Pick up files added straight to the Media Library with this project's tag">
            <CloudDownload className="size-4" /> Import from Media Library
          </Button>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-stone-500">
          <Camera className="mt-px size-3.5 shrink-0" />
          Upload the original camera files (not WhatsApp forwards) so GPS and time stay in them. Your phone's location at upload is saved as a backup signal.
        </p>
        {missingAi.length > 0 && (
          <div className="mt-3">
            <Notice>
              Cloudinary AI add-ons that did not run on the latest upload: {missingAi.join(", ")}. Uploads are still stored, located and scored. Enable their free plans under
              Add-ons in the Cloudinary console, then open an item and choose “Run Cloudinary AI again”.
            </Notice>
          </div>
        )}
        {project.sites.length === 0 && (
          <div className="mt-3">
            <Notice>Add a site boundary first (Sites tab) so photos can be matched to it by GPS.</Notice>
          </div>
        )}
        {notice && (
          <div className="mt-3">
            <Notice tone="emerald">
              {notice}{" "}
              <button className="underline" onClick={() => setNotice(null)}>
                ok
              </button>
            </Notice>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
          <div className="relative col-span-2 md:col-span-1">
            <Search className="absolute left-3 top-2.5 size-4 text-stone-400" />
            <input className={`${inputClass} pl-9`} placeholder="Describe what you are looking for…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button className="absolute right-2 top-2 rounded p-0.5 text-stone-400 hover:text-stone-700" onClick={() => setQ("")} aria-label="Clear">
                <X className="size-4" />
              </button>
            )}
          </div>
          <select className={inputClass} value={filters.site_id} onChange={setFilter("site_id")} aria-label="Site filter">
            <option value="">All sites</option>
            {project.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select className={inputClass} value={filters.activity} onChange={setFilter("activity")} aria-label="Activity filter">
            <option value="">Any activity</option>
            {config.activities.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <select className={inputClass} value={filters.grade} onChange={setFilter("grade")} aria-label="Proof filter">
            <option value="">Any proof</option>
            <option value="strong">Strong</option>
            <option value="review">Needs review</option>
            <option value="weak">Weak / reused</option>
          </select>
          <select className={inputClass} value={filters.media} onChange={setFilter("media")} aria-label="Media filter">
            <option value="">Photos & videos</option>
            <option value="image">Photos</option>
            <option value="video">Videos</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
          {!q &&
            EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setQ(ex)} className="rounded-full bg-white px-2.5 py-1 ring-1 ring-stone-200 hover:ring-emerald-500">
                {ex}
              </button>
            ))}
          {results && (
            <span>
              {searching ? "Searching…" : `${results.items.length} result(s)`}
              {q && results.visual === true && " · Cloudinary visual search + AI tags & captions"}
              {q && results.visual === false && " · matched on Cloudinary AI tags & captions"}
            </span>
          )}
        </div>
      </section>

      {shown.length === 0 ? (
        <Empty icon={<ImageUp className="size-10" />} title={active ? "Nothing matches" : "No evidence yet"}>
          {active ? "Try other words or clear the filters." : "Upload field photos or videos. Each one is tagged, captioned, located and scored as it arrives."}
        </Empty>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <ViewToggle value={layout} onChange={setLayout} />
          </div>
          {layout === "timeline" ? (
            <EvidenceTimeline evidence={shown.map((s) => s.ev)} sites={project.sites} onOpen={openEvidence} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {shown.map(({ ev, match }) => (
                <EvidenceCard key={ev.id} ev={ev} sites={project.sites} onOpen={() => openEvidence(ev)} match={match} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
