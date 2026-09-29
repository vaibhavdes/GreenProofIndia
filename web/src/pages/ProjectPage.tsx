import { Activity, ArrowLeftRight, BarChart3, Check, Copy, Images, Map as MapIcon, Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import EvidenceDetail from "../components/EvidenceDetail";
import Header, { EditorKeyDialog } from "../components/Header";
import { Button, Notice, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import type { AppConfig, Evidence, Project } from "../lib/types";
import ActivityTab from "./tabs/ActivityTab";
import CompareTab from "./tabs/CompareTab";
import EvidenceTab from "./tabs/EvidenceTab";
import ImpactTab from "./tabs/ImpactTab";
import OverviewTab from "./tabs/OverviewTab";

export interface TabProps {
  project: Project;
  config: AppConfig;
  setProject: (p: Project) => void;
  reload: () => Promise<void>;
  openEvidence: (ev: Evidence) => void;
  onError: (e: unknown) => void;
}

function NextSteps({ project, go }: { project: Project; go: (tab: string, extra?: Record<string, string>) => void }) {
  const ready = project.evidence.filter((e) => e.status === "ready");
  const flagged = ready.filter((e) => e.proof?.grade === "weak" && (e.review?.status ?? "pending") === "pending").length;
  const steps = [
    { done: project.sites.some((s) => s.boundary.length >= 3), label: "Outline the site", tab: "overview" },
    { done: ready.length > 0, label: "Upload field photos", tab: "evidence" },
    { done: ready.length > 0 && flagged === 0, label: flagged ? `Review ${flagged} flagged` : "Review flagged items", tab: "evidence", extra: { grade: "weak" } },
    { done: project.measurements.length > 0, label: "Record water spread or survival", tab: "impact" },
    { done: project.stories.some((s) => s.status === "ready"), label: "Generate and share the story", tab: "impact" },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <ol className="mt-4 flex gap-2 overflow-x-auto pb-1 text-xs">
      {steps.map((s, i) => (
        <li key={s.label} className="shrink-0">
          <button
            onClick={() => go(s.tab, s.extra)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 ring-1 ${s.done ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-white text-stone-700 ring-stone-300 hover:ring-emerald-500"}`}
          >
            <span className={`grid size-4 place-items-center rounded-full text-[10px] font-bold ${s.done ? "bg-emerald-600 text-white" : "bg-stone-200 text-stone-600"}`}>{s.done ? "✓" : i + 1}</span>
            {s.label}
          </button>
        </li>
      ))}
    </ol>
  );
}

const TABS = [
  { id: "overview", label: "Sites", icon: MapIcon },
  { id: "evidence", label: "Evidence", icon: Images },
  { id: "compare", label: "Before / after", icon: ArrowLeftRight },
  { id: "impact", label: "Impact & report", icon: BarChart3 },
  { id: "activity", label: "Audit log", icon: Activity },
] as const;

export default function ProjectPage() {
  const { pid = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const [project, setProject] = useState<Project | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needKey, setNeedKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    try {
      setProject(await api.project(pid));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedKey(true);
      setError((e as Error).message);
    }
  }, [pid]);

  const onError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) setNeedKey(true);
    setError(e instanceof Error ? e.message : String(e));
  }, []);

  useEffect(() => {
    api.config().then(setConfig).catch(onError);
    reload();
  }, [reload, onError]);

  // Keep polling while Cloudinary is analysing uploads or building a story.
  const busy = !!project && (project.evidence.some((e) => e.status === "processing") || project.stories.some((s) => s.status === "processing"));
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(reload, 2500);
    return () => window.clearInterval(t);
  }, [busy, reload]);

  if (!project || !config) {
    return (
      <div className="min-h-screen">
        <Header showKey={!!config?.editor_key_required} />
        {error ? (
          <div className="mx-auto max-w-3xl p-6">
            <Notice tone="red">{error}</Notice>
          </div>
        ) : (
          <Spinner label="Loading project…" />
        )}
        {needKey && <EditorKeyDialog onClose={() => setNeedKey(false)} />}
      </div>
    );
  }

  const shareUrl = project.share_token ? `${window.location.origin}/r/${project.share_token}` : "";
  // ?item=<id> opens an evidence item, so a link can point a reviewer straight at it.
  const openId = params.get("item");
  const setOpenId = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("item", id);
      else next.delete("item");
      return next;
    });
  const opened = project.evidence.find((e) => e.id === openId) ?? null;
  const props: TabProps = { project, config, setProject, reload, openEvidence: (ev) => setOpenId(ev.id), onError };

  return (
    <div className="min-h-screen pb-16">
      <Header showKey={config.editor_key_required}>
        <div className="truncate text-sm text-stone-500">
          / <span className="font-medium text-stone-800">{project.name}</span>
        </div>
      </Header>

      <div className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">{project.name}</h1>
              <p className="mt-0.5 text-sm text-stone-500">
                {[project.org, project.funder && `funded by ${project.funder}`, project.start_date && `started ${project.start_date}`].filter(Boolean).join(" · ")}
              </p>
              {project.description && <p className="mt-1.5 max-w-3xl text-sm text-stone-600 line-clamp-2" title={project.description}>{project.description}</p>}
            </div>
            {shareUrl && (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(shareUrl);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy report link
                </Button>
                <a href={shareUrl} target="_blank" rel="noreferrer">
                  <Button>
                    <Share2 className="size-4" /> Public report
                  </Button>
                </a>
              </div>
            )}
          </div>
          <NextSteps project={project} go={(t, extra) => setParams({ tab: t, ...extra })} />
          <nav className="-mb-px mt-4 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setParams({ tab: t.id })}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  tab === t.id ? "border-emerald-700 text-emerald-800" : "border-transparent text-stone-500 hover:text-stone-800"
                }`}
              >
                <t.icon className="size-4" /> {t.label}
                {t.id === "evidence" && <span className="rounded-full bg-stone-100 px-1.5 text-xs text-stone-600">{project.evidence.length}</span>}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {!config.ready && config.error && (
          <div className="mb-4">
            <Notice tone="red">Server: {config.error}</Notice>
          </div>
        )}
        {error && (
          <div className="mb-4">
            <Notice tone="red">
              {error}{" "}
              <button className="underline" onClick={() => setError(null)}>
                dismiss
              </button>
            </Notice>
          </div>
        )}
        {tab === "overview" && <OverviewTab {...props} />}
        {tab === "evidence" && <EvidenceTab {...props} />}
        {tab === "compare" && <CompareTab {...props} />}
        {tab === "impact" && <ImpactTab {...props} />}
        {tab === "activity" && <ActivityTab {...props} />}
      </main>

      {opened && <EvidenceDetail ev={opened} project={project} onClose={() => setOpenId(null)} onChange={setProject} />}
      {needKey && <EditorKeyDialog onClose={() => setNeedKey(false)} />}
    </div>
  );
}
