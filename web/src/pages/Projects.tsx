import { Droplets, FolderPlus, ImageIcon, MapPinned, ShieldCheck, Sprout, Trees } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Header, { EditorKeyDialog } from "../components/Header";
import { Button, Empty, Field, inputClass, Modal, Notice, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import type { ProjectSummary } from "../lib/types";

function NewProject({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", kind: "lake", org: "", funder: "", start_date: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needKey, setNeedKey] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || null]));
      const project = await api.createProject(body);
      navigate(`/p/${project.id}?tab=overview`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNeedKey(true);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New restoration project" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Project name">
          <input className={inputClass} value={form.name} onChange={set("name")} placeholder="e.g. Wagholi Lake Revival 2025" required minLength={2} autoFocus />
        </Field>
        <Field label="Type">
          <select className={inputClass} value={form.kind} onChange={set("kind")}>
            <option value="lake">Lake / pond revival</option>
            <option value="plantation">Plantation</option>
            <option value="mixed">Both</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Implementing NGO">
            <input className={inputClass} value={form.org} onChange={set("org")} placeholder="Who does the work" />
          </Field>
          <Field label="Funder">
            <input className={inputClass} value={form.funder} onChange={set("funder")} placeholder="CSR / programme" />
          </Field>
        </div>
        <Field label="Work started on" hint="Photos much older than this are flagged as possibly reused.">
          <input className={inputClass} type="date" value={form.start_date} onChange={set("start_date")} />
        </Field>
        <Field label="What is being done">
          <textarea className={inputClass} rows={2} value={form.description} onChange={set("description")} placeholder="Desilting, bund repair, 5,000 native saplings…" />
        </Field>
        {error && <Notice tone="red">{error}</Notice>}
        <Button type="submit" busy={busy}>
          Create project
        </Button>
      </form>
      {needKey && <EditorKeyDialog onClose={() => setNeedKey(false)} />}
    </Modal>
  );
}

export default function Projects() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [needKey, setNeedKey] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const load = () =>
      api
        .projects()
        .then((p) => {
          setProjects(p);
          setError(null);
        })
        .catch((e: ApiError) => {
          setError(e.message);
          if (e.status === 503) timer = window.setTimeout(load, 2500);
          if (e.status === 401) setNeedKey(true);
        });
    load();
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen">
      <Header />
      <section className="border-b border-stone-200 bg-gradient-to-br from-emerald-900 via-emerald-800 to-sky-900 text-white">
        <div className="mx-auto max-w-7xl px-4 py-12">
          <p className="text-sm font-medium uppercase tracking-wider text-emerald-200">Evidence for lake revival and plantation projects</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight sm:text-4xl">Did the lake fill up? Are the saplings alive? Show proof funders can trust.</h1>
          <p className="mt-3 max-w-2xl text-emerald-100">
            Lake revivals, CSR plantations and green credits are paid for on photo evidence that is easy to reuse and hard to check. GreenProof keeps every field photo
            and video in Cloudinary, where its AI describes what each one shows, then checks where and when it was taken, flags photos reused across projects, and turns
            the evidence into before/after comparisons, impact numbers and a report funders can trust.
          </p>
          <div className="mt-6 grid max-w-3xl grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              [ImageIcon, "AI tags & captions"],
              [ShieldCheck, "Proof Score & reuse check"],
              [MapPinned, "GPS matched to site"],
              [Sprout, "Before/after & impact reel"],
            ].map(([Icon, label]) => {
              const I = Icon as typeof ImageIcon;
              return (
                <div key={label as string} className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2">
                  <I className="size-4 shrink-0 text-emerald-200" /> {label as string}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects</h2>
          <Button onClick={() => setCreating(true)}>
            <FolderPlus className="size-4" /> New project
          </Button>
        </div>
        {error && <Notice tone={error.includes("Starting") ? "sky" : "red"}>{error}</Notice>}
        {!projects && !error && <Spinner label="Loading projects from Cloudinary…" />}
        {projects && projects.length === 0 && (
          <Empty icon={<Droplets className="size-10" />} title="No projects yet">
            Create a project, draw its site on the map and upload field photos. Cloudinary analyses them as they arrive.
          </Empty>
        )}
        {projects && projects.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link key={p.id} to={`/p/${p.id}`} className="group overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200 transition hover:shadow-lg hover:ring-emerald-500">
                <div className="aspect-[16/9] bg-gradient-to-br from-emerald-100 to-sky-100">
                  {p.cover ? (
                    <img src={p.cover} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid size-full place-items-center text-emerald-700/40">
                      {p.kind === "plantation" ? <Trees className="size-12" /> : <Droplets className="size-12" />}
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="font-semibold group-hover:text-emerald-800">{p.name}</div>
                  <div className="mt-0.5 text-sm text-stone-500">{[p.org, p.funder && `funded by ${p.funder}`].filter(Boolean).join(" · ") || p.kind}</div>
                  <div className="mt-3 flex gap-4 text-xs text-stone-600">
                    <span>{p.sites} sites</span>
                    <span>{p.evidence} evidence items</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-500">
        Built on{" "}
        <a href="https://cloudinary.com/" target="_blank" rel="noreferrer" className="font-medium text-stone-700 hover:underline">
          Cloudinary
        </a>{" "}
        (upload, AI Vision, AI Content Analysis, Google Auto Tagging, transformations) · Evidence, not certification
      </footer>
      {creating && <NewProject onClose={() => setCreating(false)} />}
      {needKey && <EditorKeyDialog onClose={() => setNeedKey(false)} />}
    </div>
  );
}
