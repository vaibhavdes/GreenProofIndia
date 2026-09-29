import { CheckCircle2, CircleAlert, ExternalLink, Fingerprint, RotateCw, Sparkles, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtBytes, fmtDate, siteName } from "../lib/format";
import type { Evidence, Project, Provenance } from "../lib/types";
import { Button, inputClass, Modal, Notice, ScoreRing } from "./ui";

const statusIcon = {
  pass: <CheckCircle2 className="size-4 text-emerald-600" />,
  warn: <CircleAlert className="size-4 text-amber-500" />,
  fail: <XCircle className="size-4 text-red-600" />,
};

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-stone-100 py-1.5 text-sm last:border-0">
      <span className="shrink-0 text-stone-500">{k}</span>
      <span className="min-w-0 break-all text-right font-medium text-stone-800">{v}</span>
    </div>
  );
}

export default function EvidenceDetail({
  ev,
  project,
  onClose,
  onChange,
  token,
}: {
  ev: Evidence;
  project: Project;
  onClose: () => void;
  onChange?: (p: Project) => void;
  token?: string;
}) {
  const [prov, setProv] = useState<Provenance | null>(null);
  const [provError, setProvError] = useState<string | null>(null);
  const [note, setNote] = useState(ev.review?.note ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = !token && !!onChange;

  useEffect(() => {
    if (ev.status !== "ready") return;
    const load = token ? api.publicProvenance(token, ev.id) : api.provenance(project.id, ev.id);
    load.then(setProv).catch((e: Error) => setProvError(e.message));
  }, [ev.id, ev.status, project.id, token]);

  async function act(label: string, body: Record<string, unknown>) {
    setBusy(label);
    setError(null);
    try {
      onChange!(await api.updateEvidence(project.id, ev.id, body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (ev.status === "error") {
    return (
      <Modal title="Upload could not be processed" onClose={onClose}>
        <Notice tone="red">{ev.error}</Notice>
        <p className="mt-3 break-all text-xs text-stone-500">{ev.public_id}</p>
        {editable && (
          <Button className="mt-4" variant="secondary" onClick={() => api.retry(project.id, ev.id).then(onClose)}>
            <RotateCw className="size-4" /> Try again
          </Button>
        )}
      </Modal>
    );
  }

  const exif = ev.exif;
  return (
    <Modal title={ev.caption ? ev.caption.charAt(0).toUpperCase() + ev.caption.slice(1) : "Evidence"} onClose={onClose} wide>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl bg-stone-900">
            {ev.resource_type === "video" && ev.views?.video ? (
              <video src={ev.views.video} poster={ev.views.large} controls className="max-h-[60vh] w-full" />
            ) : (
              <img src={ev.views?.large} alt={ev.caption ?? ""} className="max-h-[60vh] w-full object-contain" />
            )}
          </div>
          {token && <p className="text-xs text-stone-500">Faces in photos are blurred by Cloudinary in shared views; videos appear here only after the project team has accepted them. Originals are kept unchanged for verifiers.</p>}

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-stone-800">
              <Sparkles className="size-4 text-emerald-600" /> What Cloudinary AI sees
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {ev.activities?.map((a) => (
                <span key={a.name} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                  {a.name}
                  {a.confidence != null && <span className="ml-1 text-emerald-600">{Math.round(a.confidence * 100)}%</span>}
                </span>
              ))}
              {ev.tags?.slice(0, 12).map((t) => (
                <span key={t} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
                  {t}
                </span>
              ))}
            </div>
            {ev.faces ? <p className="mt-2 text-xs text-stone-500">{ev.faces} face(s) detected: blurred in every shared photo output.</p> : null}
          </section>
        </div>

        <div className="space-y-5">
          {ev.proof && (
            <section className="rounded-xl bg-stone-50 p-4 ring-1 ring-stone-200">
              <div className="mb-3 flex items-center gap-3">
                <ScoreRing score={ev.proof.score} grade={ev.proof.grade} />
                <div>
                  <div className="font-semibold">Proof Score</div>
                  <div className="text-xs text-stone-500">Location, capture time, originality across all projects, file integrity</div>
                </div>
              </div>
              <ul className="space-y-2">
                {ev.proof.checks.map((c) => (
                  <li key={c.key} className="flex gap-2 text-sm">
                    <span className="mt-0.5">{statusIcon[c.status]}</span>
                    <span className="flex-1">
                      <span className="font-medium">{c.label}</span>{" "}
                      <span className="tabular-nums text-stone-500">
                        {c.points}/{c.max}
                      </span>
                      <span className="block text-stone-600">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold text-stone-800">Capture facts</h3>
            <Row k="Site" v={`${siteName(project.sites, ev.site_id)}${ev.site_source ? ` (${ev.site_source})` : ""}`} />
            <Row k="Captured" v={exif?.taken_at ? fmtDate(exif.taken_at, true) : "not in file"} />
            <Row k="GPS" v={exif?.lat != null ? `${exif.lat.toFixed(5)}, ${exif.lng!.toFixed(5)}` : "not in file"} />
            {exif?.heading != null && <Row k="Facing" v={`${exif.heading}°`} />}
            <Row k="Camera" v={[exif?.make, exif?.model].filter(Boolean).join(" ") || "—"} />
            {exif?.software && <Row k="Software" v={exif.software} />}
            <Row k="Uploaded" v={`${fmtDate(ev.uploaded_at, true)}${ev.uploader ? ` by ${ev.uploader}` : ""}`} />
          </section>

          {editable && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-stone-800">Verification</h3>
              <select
                className={inputClass}
                value={ev.site_id ?? ""}
                onChange={(e) => act("site", { site_id: e.target.value || null })}
                aria-label="Site"
              >
                <option value="">No site</option>
                {project.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input className={inputClass} placeholder="Reviewer note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button busy={busy === "accept"} onClick={() => act("accept", { review: "accepted", note })} className="flex-1">
                  Accept
                </Button>
                <Button busy={busy === "reject"} variant="danger" onClick={() => act("reject", { review: "rejected", note })} className="flex-1">
                  Reject
                </Button>
              </div>
              <p className="text-xs text-stone-500">
                Status: <b>{ev.review?.status ?? "pending"}</b>
                {ev.review?.note ? `: ${ev.review.note}` : ""}. Evidence is never deleted; rejected items leave reports but stay in the audit trail.
                {ev.resource_type === "video" && " Accepting a video publishes it in the public report as recorded (faces in video are not blurred)."}
              </p>
              {ev.ai && Object.values(ev.ai).some((s) => s !== "ok") && (
                <Button
                  variant="secondary"
                  busy={busy === "rerun"}
                  onClick={() => {
                    setBusy("rerun");
                    api
                      .retry(project.id, ev.id)
                      .then(() => api.project(project.id))
                      .then((p) => {
                        onChange!(p); // shows it processing, which starts the page's polling
                        onClose();
                      })
                      .catch((e: Error) => setError(e.message))
                      .finally(() => setBusy(null));
                  }}
                >
                  <RotateCw className="size-4" /> Run Cloudinary AI again
                </Button>
              )}
              {error && <Notice tone="red">{error}</Notice>}
            </section>
          )}
        </div>
      </div>

      <section className="mt-6 rounded-xl bg-stone-50 p-4 ring-1 ring-stone-200">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-stone-800">
          <Fingerprint className="size-4 text-emerald-700" /> Provenance: original to every output
        </h3>
        {provError && <Notice tone="red">{provError}</Notice>}
        {!prov && !provError && <p className="text-sm text-stone-500">Loading…</p>}
        {prov && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Row k="Cloudinary public ID" v={prov.original.public_id} />
              <Row k="Version" v={prov.original.version ?? "—"} />
              <Row k="Asset ID" v={prov.original.asset_id} />
              <Row k="Size" v={`${prov.original.width ?? "?"}×${prov.original.height ?? "?"} · ${prov.original.format} · ${fmtBytes(prov.original.bytes)}`} />
              <Row k="SHA-256" v={<code className="text-xs">{prov.original.sha256 ?? "—"}</code>} />
              <Row k="MD5 (etag)" v={<code className="text-xs">{prov.original.etag_md5 ?? "—"}</code>} />
              <Row k="Perceptual hash" v={<code className="text-xs">{prov.original.phash ?? "—"}</code>} />
              {prov.original.url && (
                <a href={prov.original.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
                  Open untouched original <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <div className="mb-1 font-medium">Outputs made from it</div>
                {prov.outputs.length === 0 && <p className="text-stone-500">Not used in a story yet.</p>}
                <ul className="space-y-1">
                  {prov.outputs.map((o, i) => (
                    <li key={i}>
                      <a href={o.url} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">
                        {o.kind}
                      </a>{" "}
                      <span className="text-stone-500">· {fmtDate(o.at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {prov.cloudinary_derived.length > 0 && (
                <div>
                  <div className="mb-1 font-medium">Derived versions stored by Cloudinary</div>
                  <ul className="max-h-32 space-y-1 overflow-y-auto">
                    {prov.cloudinary_derived.map((d, i) =>
                      d.error ? (
                        <li key={i} className="text-stone-500">
                          {d.error}
                        </li>
                      ) : (
                        <li key={i} className="truncate">
                          <a href={d.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-emerald-700 hover:underline">
                            {d.transformation}
                          </a>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}
              <div>
                <div className="mb-1 font-medium">Events</div>
                <ul className="space-y-1 text-stone-600">
                  {prov.events.map((e, i) => (
                    <li key={i}>
                      {fmtDate(e.at, true)}: {e.action.replace(".", " ")} by {e.actor}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </section>
    </Modal>
  );
}
