import { Empty } from "../../components/ui";
import { fmtDate } from "../../lib/format";
import type { TabProps } from "../ProjectPage";

const COLORS: Record<string, string> = {
  evidence: "bg-emerald-500",
  site: "bg-sky-500",
  measurement: "bg-violet-500",
  story: "bg-amber-500",
  project: "bg-stone-500",
  share: "bg-stone-500",
};

export default function ActivityTab({ project }: TabProps) {
  if (project.audit.length === 0) return <Empty icon={null} title="No activity yet" />;
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-stone-200 sm:p-5">
      <p className="mb-4 text-sm text-stone-500">Every change is recorded here and stored with the project in Cloudinary. Evidence is never deleted, only accepted or rejected.</p>
      <ol className="space-y-3">
        {project.audit.map((a, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${COLORS[a.action.split(".")[0]] ?? "bg-stone-400"}`} />
            <div className="min-w-0">
              <div>
                <span className="font-medium">{a.action.replace(".", " ")}</span> <span className="break-all text-stone-600">{a.detail}</span>
              </div>
              <div className="text-xs text-stone-400">
                {fmtDate(a.at, true)} · {a.actor}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
