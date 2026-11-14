// JSON and markdown output of a balance-sim run (progression-and-economy.md section 22.6, MVP subset).
import { MODEL_CONSTANTS } from "./model";
import type { MonteCarloResult } from "./monte-carlo";
import type { RunResult } from "./sim";
import type { TargetResult } from "./targets";

export interface Report {
  readonly policy: "mvp";
  readonly seed: number;
  readonly constants: typeof MODEL_CONSTANTS;
  readonly targets: readonly TargetResult[];
  readonly runs: Readonly<Record<string, RunResult>>;
  readonly monteCarlo: Readonly<Record<string, MonteCarloResult>>;
}

const fmtMin = (s: number | undefined): string => (s === undefined ? "-" : (s / 60).toFixed(1));
const fmtH = (s: number | undefined): string => (s === undefined ? "-" : (s / 3600).toFixed(2));

export function toJson(report: Report): string {
  const slim = {
    ...report,
    // Curves and purchase lists are large: keep them in the markdown/CSV views, not the machine summary.
    runs: Object.fromEntries(
      Object.entries(report.runs).map(([k, r]) => [
        k,
        {
          milestonesS: r.milestonesS,
          gapMedianS: r.gapMedianS,
          gapMaxS: r.gapMaxS,
          totalEarnedLm: r.totalEarnedLm,
          completedAtS: r.completedAtS ?? null,
          spendByCategory: r.spendByCategory,
          purchases: r.purchases,
        },
      ]),
    ),
  };
  return `${JSON.stringify(slim, null, 2)}\n`;
}

export function curvesCsv(run: RunResult): string {
  const lines = ["tS,walletLm,incomePerH,playerM2ps,robotM2ps,mode,polishedM2"];
  for (const p of run.curve) {
    lines.push([p.tS, p.walletLm, p.incomePerH, p.playerM2ps, p.robotM2ps, p.mode, p.polishedM2].join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function purchasesCsv(run: RunResult): string {
  const lines = ["tMin,id,label,category,costLm"];
  for (const p of run.purchases) lines.push([fmtMin(p.tS), p.id, p.label, p.category, p.costLm].join(","));
  return `${lines.join("\n")}\n`;
}

export function toMarkdown(report: Report): string {
  const out: string[] = [];
  out.push("# balance-sim report (policy `mvp`)", "");
  out.push(`Seed ${report.seed}. Deterministic: the same tables and seed give the same report.`, "");
  out.push("## Pacing targets (nominal efficient run)", "");
  out.push("| Row | Players | Target | Measured | Verdict | Note |", "| --- | --- | --- | --- | --- | --- |");
  for (const t of report.targets) {
    const target = `${t.min}-${t.max} ${t.unit}`;
    const measured = t.value === undefined ? "-" : `${t.value.toFixed(2)} ${t.unit}`;
    out.push(
      `| ${t.id} | ${t.players} | ${target} (tol ${(t.toleranceFrac * 100).toFixed(0)}%) | ${measured} | ${t.verdict} | ${t.note} |`,
    );
  }
  out.push("");
  for (const [key, run] of Object.entries(report.runs)) {
    out.push(`## Run ${key}`, "");
    const m = run.milestonesS;
    out.push(
      `First Stamp ${fmtMin(m["first_stamp"])} min, first sale ${fmtMin(m["first_sale"])} min, Crescent Squeegee ${fmtMin(m["first_tool_upgrade"])} min, ` +
        `first Dust Cell ${fmtMin(m["first_dust_cell"])} min, Trundle ${fmtH(m["first_vehicle"])} h, first Roost ${fmtH(m["first_roost"])} h, ` +
        `all MVP items ${fmtH(run.completedAtS)} h. Purchase gap median ${fmtMin(run.gapMedianS)} min, max ${fmtMin(run.gapMaxS)} min. ` +
        `Earned ${run.totalEarnedLm.toLocaleString("en-US")} LM.`,
      "",
    );
    out.push("| Time (min) | Purchase | Cost (LM) |", "| --- | --- | --- |");
    for (const p of run.purchases.slice(0, 14)) out.push(`| ${fmtMin(p.tS)} | ${p.label} | ${p.costLm} |`);
    out.push(
      "",
      "Spend by category: " +
        Object.entries(run.spendByCategory)
          .map(([c, v]) => `${c} ${v}`)
          .join(", "),
      "",
    );
  }
  for (const [key, mc] of Object.entries(report.monteCarlo)) {
    out.push(
      `## Monte Carlo ${key} (${mc.runs} runs, seed ${mc.seed})`,
      "",
      "| Milestone | P10 | P50 | P90 | n |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const [name, p] of Object.entries(mc.milestones)) {
      const f = name === "first_vehicle" || name === "first_roost" ? fmtH : fmtMin;
      const unit = name === "first_vehicle" || name === "first_roost" ? "h" : "min";
      out.push(`| ${name} | ${f(p.p10)} ${unit} | ${f(p.p50)} ${unit} | ${f(p.p90)} ${unit} | ${p.n} |`);
    }
    out.push("");
  }
  return `${out.join("\n")}\n`;
}
