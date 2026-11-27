import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { loadCanaryReport } from "../canaries/report";
import { stripTsComments, walkFiles } from "./fileWalk";

export interface DeclaredCanaryBudget {
  readonly file: string;
  readonly label: string;
  readonly totalCeiling: number | null;
}

export interface CanaryCeilingDrift {
  readonly canary: string;
  readonly phase: string;
  readonly measuredTotal: number;
  readonly ceilingTotal: number;
  readonly headroom: number;
  readonly measuredResponseBytes?: number;
  readonly ceilingResponseBytes?: number;
}

export interface CanaryBudgetInventory {
  readonly budgetAssertionCount: number;
  readonly declaredBudgets: readonly DeclaredCanaryBudget[];
  readonly driftSource?: string;
  readonly ceilingDrift: readonly CanaryCeilingDrift[];
}

function collectBudgetTotalConstants(source: string): Map<string, number> {
  const totals = new Map<string, number>();
  const constPattern =
    /\bconst\s+([A-Z0-9_]*BUDGET[A-Z0-9_]*)\s*(?::[^=]+)?=\s*\{([\s\S]*?)\n\s*\};/gu;
  for (const match of source.matchAll(constPattern)) {
    const name = match[1];
    const body = match[2];
    if (!name || !body) continue;
    const totalMatch = /\btotal\s*:\s*(\d+)/u.exec(body);
    if (totalMatch?.[1]) {
      totals.set(name, Number(totalMatch[1]));
    }
  }
  return totals;
}

function resolveTotalCeiling(
  budgetArg: string,
  constants: ReadonlyMap<string, number>,
): number | null {
  const directConst = constants.get(budgetArg);
  if (directConst !== undefined) return directConst;
  const inlineTotal = /\btotal\s*:\s*(\d+)/u.exec(budgetArg);
  if (inlineTotal?.[1]) return Number(inlineTotal[1]);
  const spreadConst = /\.\.\.([A-Z0-9_]*BUDGET[A-Z0-9_]*)/u.exec(budgetArg);
  return spreadConst?.[1] ? (constants.get(spreadConst[1]) ?? null) : null;
}

function parseFileBudgets(
  source: string,
  relFile: string,
): DeclaredCanaryBudget[] {
  const stripped = stripTsComments(source);
  const constants = collectBudgetTotalConstants(stripped);
  const declared: DeclaredCanaryBudget[] = [];
  const callPattern =
    /expectProxiedApiRequestBudget\s*\(\s*["']([^"']+)["']\s*,[^,]+,\s*([\s\S]*?)\)\s*;/gu;

  for (const match of stripped.matchAll(callPattern)) {
    const label = match[1];
    const budgetArg = match[2]?.trim();
    if (!label || !budgetArg) continue;
    declared.push({
      file: relFile,
      label,
      totalCeiling: resolveTotalCeiling(budgetArg, constants),
    });
  }
  if (declared.length > 0) return declared;
  return [...constants.entries()].map(([name, total]) => ({
    file: relFile,
    label: name,
    totalCeiling: total,
  }));
}

function mergePhaseDrift(
  existing: CanaryCeilingDrift | undefined,
  canary: string,
  phaseLabel: string,
  budget: NonNullable<
    Awaited<
      ReturnType<typeof loadCanaryReport>
    >["runs"][number]["phases"][number]["budget"]
  >,
): CanaryCeilingDrift {
  const measuredTotal = Math.max(
    existing?.measuredTotal ?? 0,
    budget.measuredTotal,
  );
  const measuredResp = budget.measuredBodyBytes?.response;
  const mergedMeasuredResp =
    measuredResp !== undefined
      ? Math.max(existing?.measuredResponseBytes ?? 0, measuredResp)
      : existing?.measuredResponseBytes;
  const mergedCeilingResp =
    budget.ceilingBodyBytes?.response ?? existing?.ceilingResponseBytes;
  return {
    canary,
    phase: phaseLabel,
    measuredTotal,
    ceilingTotal: budget.ceilingTotal,
    headroom: budget.ceilingTotal - measuredTotal,
    ...(mergedMeasuredResp !== undefined && mergedCeilingResp !== undefined
      ? {
          measuredResponseBytes: mergedMeasuredResp,
          ceilingResponseBytes: mergedCeilingResp,
        }
      : {}),
  };
}

async function readDriftFromCanaryReport(
  reportPath: string,
): Promise<CanaryCeilingDrift[]> {
  const report = await loadCanaryReport(reportPath);
  const byPhase = new Map<string, CanaryCeilingDrift>();
  for (const run of report.runs) {
    for (const phase of run.phases) {
      if (!phase.budget) continue;
      const key = `${run.canary}::${phase.label}`;
      byPhase.set(
        key,
        mergePhaseDrift(
          byPhase.get(key),
          run.canary,
          phase.label,
          phase.budget,
        ),
      );
    }
  }
  const drift = [...byPhase.values()].filter((item) => {
    const responseDrift =
      item.ceilingResponseBytes !== undefined &&
      item.measuredResponseBytes !== undefined &&
      item.ceilingResponseBytes > item.measuredResponseBytes;
    return item.headroom > 0 || responseDrift;
  });
  drift.sort((a, b) => b.headroom - a.headroom);
  return drift;
}

export async function auditCanaryBudgets(
  repoRoot: string,
  canariesReportPath?: string,
): Promise<CanaryBudgetInventory> {
  const appSrc = join(repoRoot, "packages/app/src");
  const files = await walkFiles(
    appSrc,
    (file) => file.endsWith(".test.ts") || file.endsWith(".test.tsx"),
  );
  const declaredBudgets: DeclaredCanaryBudget[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    if (
      !content.includes("expectProxiedApiRequestBudget") &&
      !content.includes("ProxiedApiRequestBudget")
    ) {
      continue;
    }
    declaredBudgets.push(
      ...parseFileBudgets(content, relative(repoRoot, file)),
    );
  }

  const ceilingDrift =
    canariesReportPath !== undefined
      ? await readDriftFromCanaryReport(canariesReportPath)
      : [];

  return {
    budgetAssertionCount: declaredBudgets.length,
    declaredBudgets,
    ...(canariesReportPath !== undefined
      ? { driftSource: canariesReportPath }
      : {}),
    ceilingDrift,
  };
}
