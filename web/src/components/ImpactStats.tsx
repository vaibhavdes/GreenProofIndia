import { fmtDate } from "../lib/format";
import type { Project } from "../lib/types";
import { Stat } from "./ui";

/** Headline numbers; water and sapling cards appear only for projects that have that kind of site or data. */
export default function ImpactStats({ project }: { project: Project }) {
  const m = project.metrics;
  const grades = { strong: 0, review: 0, weak: 0 };
  project.evidence.forEach((e) => e.proof && e.review?.status !== "rejected" && grades[e.proof.grade]++);
  const water = project.sites.map((s) => s.metrics.water).filter((w) => !!w);
  const hasLake = project.sites.some((s) => s.kind === "lake") || water.length > 0;
  const hasPlantation = project.sites.some((s) => s.kind === "plantation") || m.survival_pct != null;

  let waterValue = "—";
  let waterHint = "Not measured yet";
  if (m.water_gain_ha != null) {
    waterValue = `${m.water_gain_ha >= 0 ? "+" : ""}${m.water_gain_ha} ha`;
    waterHint = "Change since the first observation";
  } else if (water.length) {
    const latest = water[water.length - 1]!;
    waterValue = `${latest.latest_ha} ha`;
    waterHint = `Measured ${fmtDate(latest.latest_date)}; add a later observation to see change`;
  }

  const cards = [
    <Stat key="ev" label="Evidence items" value={m.evidence} hint={`${m.sites} site(s)`} />,
    <Stat
      key="proof"
      label="Average Proof Score"
      value={m.avg_proof ?? "—"}
      hint={`${grades.strong} strong · ${grades.review} review · ${grades.weak} weak`}
      tone={grades.weak ? "red" : "emerald"}
    />,
  ];
  if (hasLake) cards.push(<Stat key="water" label="Water spread" value={waterValue} hint={waterHint} tone="sky" />);
  if (hasPlantation)
    cards.push(
      <Stat
        key="trees"
        label="Saplings alive"
        value={m.survival_pct != null ? `${m.survival_pct}%` : "—"}
        hint={m.trees_alive != null ? `${m.trees_alive.toLocaleString("en-IN")} of ${m.trees_planted!.toLocaleString("en-IN")}` : "No survival survey yet"}
        tone="emerald"
      />,
    );
  return <section className={`grid grid-cols-2 gap-3 ${cards.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>{cards}</section>;
}
