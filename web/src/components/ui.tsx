import { Loader2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { gradeStyle } from "../lib/format";
import type { Grade } from "../lib/types";

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  busy,
  type = "button",
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const styles = {
    primary: "bg-emerald-700 text-white hover:bg-emerald-800 shadow-sm",
    secondary: "bg-white text-stone-800 ring-1 ring-stone-300 hover:bg-stone-100",
    ghost: "text-stone-700 hover:bg-stone-200/60",
    danger: "bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50",
  }[variant];
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {busy && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function GradeChip({ grade, score }: { grade: Grade; score?: number }) {
  const g = gradeStyle[grade];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${g.chip}`}>
      {score !== undefined && <span className="tabular-nums">{score}</span>}
      {g.label}
    </span>
  );
}

export function ScoreRing({ score, grade, size = 64 }: { score: number; grade: Grade; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="shrink-0" role="img" aria-label={`Proof Score ${score} of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e5e4" strokeWidth={6} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={gradeStyle[grade].ring}
        strokeWidth={6}
        strokeDasharray={`${(score / 100) * c} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className="fill-stone-900 text-base font-bold">
        {score}
      </text>
    </svg>
  );
}

export function Stat({ label, value, hint, tone = "stone" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "stone" | "emerald" | "sky" | "red" }) {
  const toneClass = { stone: "text-stone-900", emerald: "text-emerald-700", sky: "text-sky-700", red: "text-red-700" }[tone];
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-stone-200">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-stone-900/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? "sm:max-w-5xl" : "sm:max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-stone-500 hover:bg-stone-100" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-stone-300 placeholder:text-stone-400 focus:ring-2 focus:ring-emerald-600 focus:outline-none";

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
      <div className="mb-3 text-stone-400">{icon}</div>
      <div className="font-semibold text-stone-800">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-stone-500">{children}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-stone-500">
      <Loader2 className="size-5 animate-spin" /> {label}
    </div>
  );
}

export function Notice({ tone = "amber", children }: { tone?: "amber" | "red" | "sky" | "emerald"; children: ReactNode }) {
  const t = {
    amber: "bg-amber-50 text-amber-900 ring-amber-200",
    red: "bg-red-50 text-red-900 ring-red-200",
    sky: "bg-sky-50 text-sky-900 ring-sky-200",
    emerald: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  }[tone];
  return <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${t}`}>{children}</div>;
}

export function ViewToggle({ value, onChange }: { value: "grid" | "timeline"; onChange: (v: "grid" | "timeline") => void }) {
  return (
    <div className="inline-flex rounded-lg bg-stone-200/70 p-0.5 text-xs font-medium" role="tablist">
      {(["grid", "timeline"] as const).map((v) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1.5 capitalize ${value === v ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
