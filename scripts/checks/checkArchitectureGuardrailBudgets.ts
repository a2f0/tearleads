#!/usr/bin/env -S pnpm exec tsx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectRuleExceptionCountsFromConfig } from './dependencyCruiserSummary.ts';

interface DependencyCruiserExceptionTotals {
  rulesWithPathNot: number;
  totalPathNotEntries: number;
  totalClientFileExceptions: number;
}

interface RuleExceptionBudget {
  pathNotEntries: number;
  clientFileExceptions: number;
}

interface KnipSuppressionTotals {
  ignoreIssueFiles: number;
  ignoreIssueEntries: number;
  ignoreBinaries: number;
  workspaceIgnoreDependencyGroups: number;
  workspaceIgnoreDependencyEntries: number;
}

interface BudgetViolation {
  key: string;
  current: number;
  maxAllowed: number;
}

export interface GuardrailBudgetResult {
  dependencyCruiser: DependencyCruiserExceptionTotals;
  dependencyCruiserRuleCounts: Record<string, RuleExceptionBudget>;
  knip: KnipSuppressionTotals;
  knipIgnoreIssueFileCounts: Record<string, number>;
  knipWorkspaceIgnoreDependencyCounts: Record<string, number>;
  violations: BudgetViolation[];
}

const DEPENDENCY_CRUISER_BUDGET: DependencyCruiserExceptionTotals = {
  rulesWithPathNot: 0,
  totalPathNotEntries: 0,
  totalClientFileExceptions: 0
};

const DEPENDENCY_CRUISER_RULE_BUDGET: Record<string, RuleExceptionBudget> = {
  'no-circular': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-api-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-client-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-client-local-cross-package-src-imports': {
    pathNotEntries: 0,
    clientFileExceptions: 0
  },
  'no-cross-package-non-entrypoint-imports': {
    pathNotEntries: 0,
    clientFileExceptions: 0
  },
  'no-cross-package-src-entrypoint-imports': {
    pathNotEntries: 0,
    clientFileExceptions: 0
  },
  'no-local-app-builder-vite-plugin-imports': {
    pathNotEntries: 0,
    clientFileExceptions: 0
  },
  'no-prod-to-test-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-local-cross-package-app-src-imports': {
    pathNotEntries: 0,
    clientFileExceptions: 0
  },
  'no-website-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-chrome-extension-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-smtp-listener-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-classic-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-cli-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-tee-api-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-tee-client-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-bob-and-alice-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-analytics-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-health-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-client-only-ui-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-console-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-ai-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-businesses-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-calendar-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-mls-chat-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-search-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-settings-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-terminal-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-vfs-explorer-imports': { pathNotEntries: 0, clientFileExceptions: 0 },
  'no-window-manager-imports': { pathNotEntries: 0, clientFileExceptions: 0 }
};

const KNIP_BUDGET: KnipSuppressionTotals = {
  ignoreIssueFiles: 18,
  ignoreIssueEntries: 18,
  ignoreBinaries: 3,
  workspaceIgnoreDependencyGroups: 4,
  workspaceIgnoreDependencyEntries: 10
};

const KNIP_IGNORE_ISSUE_FILE_BUDGET: Record<string, number> = {
  'packages/api-client/src/vfsBlobNetworkFlusher.ts': 1,
  'packages/api-client/src/vfsNetworkFlusher.ts': 1,
  'packages/api-client/src/vfsWriteOrchestrator.ts': 1,
  'packages/bob-and-alice/src/harness/actorHarness.ts': 1,
  'packages/bob-and-alice/src/harness/apiScenarioHarness.ts': 1,
  'packages/bob-and-alice/src/harness/scenarioHarness.ts': 1,
  'packages/bob-and-alice/src/harness/serverHarness.ts': 1,
  'packages/client/src/components/ui/ErrorBoundary.tsx': 1,
  'packages/client/src/db/adapters/web.adapter.ts': 1,
  'packages/mls-core/src/mls.ts': 1,
  'packages/mls-core/src/storage.ts': 1,
  'packages/vfs-explorer/src/hooks/useVfsAllItems.ts': 1,
  'packages/vfs-sync/src/vfs/access/sync-access-harness.ts': 1,
  'packages/vfs-sync/src/vfs/blob/sync-blob-commit.ts': 1,
  'packages/vfs-sync/src/vfs/blob/sync-blob-isolation.ts': 1,
  'packages/vfs-sync/src/vfs/client/sync-client-utils.ts': 1,
  'packages/vfs-sync/src/vfs/client/sync-client.ts': 1,
  'packages/vfs-sync/src/vfs/protocol/sync-crdt-types.ts': 1
};

const KNIP_WORKSPACE_IGNORE_DEPENDENCY_BUDGET: Record<string, number> = {
  '.': 3,
  'packages/client': 5,
  'packages/shared': 1,
  'packages/website': 1
};

const DEPENDENCY_CRUISER_TOTAL_KEYS: ReadonlyArray<
  keyof DependencyCruiserExceptionTotals
> = ['rulesWithPathNot', 'totalPathNotEntries', 'totalClientFileExceptions'];

const KNIP_TOTAL_KEYS: ReadonlyArray<keyof KnipSuppressionTotals> = [
  'ignoreIssueFiles',
  'ignoreIssueEntries',
  'ignoreBinaries',
  'workspaceIgnoreDependencyGroups',
  'workspaceIgnoreDependencyEntries'
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function pushNumberBudgetViolation(
  violations: BudgetViolation[],
  key: string,
  current: number,
  maxAllowed: number
): void {
  if (current > maxAllowed) {
    violations.push({ key, current, maxAllowed });
  }
}

function countRuleExceptions(
  dependencyCruiserConfig: unknown
): Record<string, RuleExceptionBudget> {
  const rules = collectRuleExceptionCountsFromConfig(dependencyCruiserConfig);
  const counts: Record<string, RuleExceptionBudget> = {};
  for (const rule of rules) {
    counts[rule.name] = {
      pathNotEntries: rule.pathNotEntries,
      clientFileExceptions: rule.clientFileExceptions
    };
  }
  return counts;
}

export function parseDependencyCruiserExceptionTotals(
  dependencyCruiserConfig: unknown
): DependencyCruiserExceptionTotals {
  const ruleCounts = countRuleExceptions(dependencyCruiserConfig);
  let rulesWithPathNot = 0;
  let totalPathNotEntries = 0;
  let totalClientFileExceptions = 0;

  for (const count of Object.values(ruleCounts)) {
    if (count.pathNotEntries > 0) {
      rulesWithPathNot += 1;
    }
    totalPathNotEntries += count.pathNotEntries;
    totalClientFileExceptions += count.clientFileExceptions;
  }

  return { rulesWithPathNot, totalPathNotEntries, totalClientFileExceptions };
}

export function parseDependencyCruiserRuleCounts(
  dependencyCruiserConfig: unknown
): Record<string, RuleExceptionBudget> {
  return countRuleExceptions(dependencyCruiserConfig);
}

function getIgnoreIssueObject(knipConfig: unknown): Record<string, unknown> {
  if (!isRecord(knipConfig) || !isRecord(knipConfig.ignoreIssues)) {
    return {};
  }
  return knipConfig.ignoreIssues;
}

function getWorkspaceObject(knipConfig: unknown): Record<string, unknown> {
  if (!isRecord(knipConfig) || !isRecord(knipConfig.workspaces)) {
    return {};
  }
  return knipConfig.workspaces;
}

export function parseKnipIgnoreIssueFileCounts(
  knipConfig: unknown
): Record<string, number> {
  const ignoreIssues = getIgnoreIssueObject(knipConfig);
  const counts: Record<string, number> = {};
  for (const [filePath, value] of Object.entries(ignoreIssues)) {
    counts[filePath] = Array.isArray(value) ? value.length : 0;
  }
  return counts;
}

export function parseKnipWorkspaceIgnoreDependencyCounts(
  knipConfig: unknown
): Record<string, number> {
  const workspaces = getWorkspaceObject(knipConfig);
  const counts: Record<string, number> = {};
  for (const [workspaceName, workspaceValue] of Object.entries(workspaces)) {
    if (
      !isRecord(workspaceValue) ||
      !Array.isArray(workspaceValue.ignoreDependencies)
    ) {
      continue;
    }
    if (workspaceValue.ignoreDependencies.length === 0) {
      continue;
    }
    counts[workspaceName] = workspaceValue.ignoreDependencies.length;
  }
  return counts;
}

export function parseKnipSuppressionTotals(
  knipConfig: unknown
): KnipSuppressionTotals {
  const ignoreIssueFileCounts = parseKnipIgnoreIssueFileCounts(knipConfig);
  let ignoreIssueEntries = 0;
  for (const value of Object.values(ignoreIssueFileCounts)) {
    ignoreIssueEntries += value;
  }

  const ignoreBinaries =
    isRecord(knipConfig) && Array.isArray(knipConfig.ignoreBinaries)
      ? knipConfig.ignoreBinaries.length
      : 0;

  const workspaceIgnoreDependencyCounts =
    parseKnipWorkspaceIgnoreDependencyCounts(knipConfig);
  let workspaceIgnoreDependencyEntries = 0;
  for (const value of Object.values(workspaceIgnoreDependencyCounts)) {
    workspaceIgnoreDependencyEntries += value;
  }

  return {
    ignoreIssueFiles: Object.keys(ignoreIssueFileCounts).length,
    ignoreIssueEntries,
    ignoreBinaries,
    workspaceIgnoreDependencyGroups: Object.keys(
      workspaceIgnoreDependencyCounts
    ).length,
    workspaceIgnoreDependencyEntries
  };
}

function collectTotalsBudgetViolations(
  dependencyCruiserTotals: DependencyCruiserExceptionTotals,
  knipTotals: KnipSuppressionTotals
): BudgetViolation[] {
  const violations: BudgetViolation[] = [];

  for (const key of DEPENDENCY_CRUISER_TOTAL_KEYS) {
    pushNumberBudgetViolation(
      violations,
      `dependencyCruiser.${key}`,
      dependencyCruiserTotals[key],
      DEPENDENCY_CRUISER_BUDGET[key]
    );
  }

  for (const key of KNIP_TOTAL_KEYS) {
    pushNumberBudgetViolation(
      violations,
      `knip.${key}`,
      knipTotals[key],
      KNIP_BUDGET[key]
    );
  }

  return violations;
}

function collectRuleBudgetViolations(
  ruleCounts: Record<string, RuleExceptionBudget>
): BudgetViolation[] {
  const violations: BudgetViolation[] = [];
  for (const [ruleName, count] of Object.entries(ruleCounts)) {
    const budget = DEPENDENCY_CRUISER_RULE_BUDGET[ruleName];
    const maxPathNotEntries = toNumber(budget?.pathNotEntries);
    const maxClientFileExceptions = toNumber(budget?.clientFileExceptions);

    pushNumberBudgetViolation(
      violations,
      `dependencyCruiser.rules.${ruleName}.pathNotEntries`,
      count.pathNotEntries,
      maxPathNotEntries
    );
    pushNumberBudgetViolation(
      violations,
      `dependencyCruiser.rules.${ruleName}.clientFileExceptions`,
      count.clientFileExceptions,
      maxClientFileExceptions
    );
  }
  return violations;
}

function collectKnipMapBudgetViolations(
  ignoreIssueFileCounts: Record<string, number>,
  workspaceIgnoreDependencyCounts: Record<string, number>
): BudgetViolation[] {
  const violations: BudgetViolation[] = [];

  for (const [filePath, count] of Object.entries(ignoreIssueFileCounts)) {
    const maxAllowed = toNumber(KNIP_IGNORE_ISSUE_FILE_BUDGET[filePath]);
    pushNumberBudgetViolation(
      violations,
      `knip.ignoreIssues.${filePath}`,
      count,
      maxAllowed
    );
  }

  for (const [workspaceName, count] of Object.entries(
    workspaceIgnoreDependencyCounts
  )) {
    const maxAllowed = toNumber(
      KNIP_WORKSPACE_IGNORE_DEPENDENCY_BUDGET[workspaceName]
    );
    pushNumberBudgetViolation(
      violations,
      `knip.workspaces.${workspaceName}.ignoreDependencies`,
      count,
      maxAllowed
    );
  }

  return violations;
}

export function evaluateGuardrailBudgets(
  dependencyCruiserTotals: DependencyCruiserExceptionTotals,
  dependencyCruiserRuleCounts: Record<string, RuleExceptionBudget>,
  knipTotals: KnipSuppressionTotals,
  knipIgnoreIssueFileCounts: Record<string, number>,
  knipWorkspaceIgnoreDependencyCounts: Record<string, number>
): GuardrailBudgetResult {
  const violations = [
    ...collectTotalsBudgetViolations(dependencyCruiserTotals, knipTotals),
    ...collectRuleBudgetViolations(dependencyCruiserRuleCounts),
    ...collectKnipMapBudgetViolations(
      knipIgnoreIssueFileCounts,
      knipWorkspaceIgnoreDependencyCounts
    )
  ];

  return {
    dependencyCruiser: dependencyCruiserTotals,
    dependencyCruiserRuleCounts,
    knip: knipTotals,
    knipIgnoreIssueFileCounts,
    knipWorkspaceIgnoreDependencyCounts,
    violations
  };
}

export function renderGuardrailBudgetSummary(
  result: GuardrailBudgetResult
): string {
  const lines: string[] = [];
  lines.push('Architecture Guardrail Budget Check');
  lines.push(
    `- dependencyCruiser.rulesWithPathNot: ${result.dependencyCruiser.rulesWithPathNot}/${DEPENDENCY_CRUISER_BUDGET.rulesWithPathNot}`
  );
  lines.push(
    `- dependencyCruiser.totalPathNotEntries: ${result.dependencyCruiser.totalPathNotEntries}/${DEPENDENCY_CRUISER_BUDGET.totalPathNotEntries}`
  );
  lines.push(
    `- dependencyCruiser.totalClientFileExceptions: ${result.dependencyCruiser.totalClientFileExceptions}/${DEPENDENCY_CRUISER_BUDGET.totalClientFileExceptions}`
  );
  lines.push(
    `- knip.ignoreIssueFiles: ${result.knip.ignoreIssueFiles}/${KNIP_BUDGET.ignoreIssueFiles}`
  );
  lines.push(
    `- knip.ignoreIssueEntries: ${result.knip.ignoreIssueEntries}/${KNIP_BUDGET.ignoreIssueEntries}`
  );
  lines.push(
    `- knip.ignoreBinaries: ${result.knip.ignoreBinaries}/${KNIP_BUDGET.ignoreBinaries}`
  );
  lines.push(
    `- knip.workspaceIgnoreDependencyGroups: ${result.knip.workspaceIgnoreDependencyGroups}/${KNIP_BUDGET.workspaceIgnoreDependencyGroups}`
  );
  lines.push(
    `- knip.workspaceIgnoreDependencyEntries: ${result.knip.workspaceIgnoreDependencyEntries}/${KNIP_BUDGET.workspaceIgnoreDependencyEntries}`
  );

  if (result.violations.length === 0) {
    lines.push('- Status: pass (no budget regressions)');
    return `${lines.join('\n')}\n`;
  }

  lines.push('- Status: fail (budget regressions detected)');
  lines.push('- Regressions:');
  for (const violation of result.violations) {
    lines.push(
      `  ${violation.key}: current=${violation.current}, maxAllowed=${violation.maxAllowed}`
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function runBudgetCheck(
  repoRoot: string
): Promise<GuardrailBudgetResult> {
  const dependencyCruiserConfigPath = path.join(
    repoRoot,
    '.dependency-cruiser.json'
  );
  const dependencyCruiserConfig = JSON.parse(
    fs.readFileSync(dependencyCruiserConfigPath, 'utf8')
  );
  const dependencyCruiserTotals = parseDependencyCruiserExceptionTotals(
    dependencyCruiserConfig
  );
  const dependencyCruiserRuleCounts = parseDependencyCruiserRuleCounts(
    dependencyCruiserConfig
  );

  const knipPath = path.join(repoRoot, 'knip.ts');
  const knipModule = await import(pathToFileURL(knipPath).href);
  const knipConfig = knipModule.default;
  const knipTotals = parseKnipSuppressionTotals(knipConfig);
  const knipIgnoreIssueFileCounts = parseKnipIgnoreIssueFileCounts(knipConfig);
  const knipWorkspaceIgnoreDependencyCounts =
    parseKnipWorkspaceIgnoreDependencyCounts(knipConfig);

  return evaluateGuardrailBudgets(
    dependencyCruiserTotals,
    dependencyCruiserRuleCounts,
    knipTotals,
    knipIgnoreIssueFileCounts,
    knipWorkspaceIgnoreDependencyCounts
  );
}

async function main(): Promise<number> {
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(thisFile), '..', '..');
  const result = await runBudgetCheck(repoRoot);
  process.stdout.write(renderGuardrailBudgetSummary(result));
  return result.violations.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
