import fs from 'node:fs';

export interface CliOptions {
  json: boolean;
  exceptionsOnly: boolean;
  configPath: string;
}

export interface ViolationLike {
  ruleName: string;
  severity: string;
}

export interface RuleExceptionCount {
  name: string;
  pathNotEntries: number;
  clientFileExceptions: number;
}

export interface DependencyCruiserSummaryResult {
  totals: {
    modulesCruised: number;
    dependenciesCruised: number;
    errors: number;
    warnings: number;
    infos: number;
    ignored: number;
    violations: number;
  };
  violationsByRule: Record<string, number>;
  violationsBySeverity: Record<string, number>;
  ruleExceptionCounts: RuleExceptionCount[];
  exceptionTotals: {
    rulesWithPathNot: number;
    totalPathNotEntries: number;
    totalClientFileExceptions: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' ? value : 0;
}

function getString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

export function parseArgs(argv: string[]): CliOptions {
  let configPath = '.dependency-cruiser.json';
  let json = false;
  let exceptionsOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') {
      json = true;
      continue;
    }
    if (token === '--exceptions-only') {
      exceptionsOnly = true;
      continue;
    }

    if (token === '--config') {
      const next = argv[i + 1];
      if (typeof next === 'string' && next.length > 0) {
        configPath = next;
        i += 1;
      }
    }
  }

  return { json, exceptionsOnly, configPath };
}

function readStdin(): string {
  return fs.readFileSync(0, 'utf8');
}

function parseJson(input: string, context: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    throw new Error(`Invalid JSON input for ${context}`);
  }
}

export function collectViolations(
  summary: Record<string, unknown>
): ViolationLike[] {
  const result: ViolationLike[] = [];
  const violations = summary.violations;
  if (!Array.isArray(violations)) {
    return result;
  }

  for (const violation of violations) {
    if (!isRecord(violation)) {
      continue;
    }

    const severity = getString(violation, 'severity');
    const rule = violation.rule;
    let ruleName = '';

    if (typeof rule === 'string') {
      ruleName = rule;
    } else if (isRecord(rule)) {
      ruleName = getString(rule, 'name');
    }

    if (ruleName.length === 0) {
      continue;
    }

    result.push({
      ruleName,
      severity: severity.length > 0 ? severity : 'unknown'
    });
  }

  return result;
}

export function countViolationsByRule(
  violations: ViolationLike[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const violation of violations) {
    counts[violation.ruleName] = (counts[violation.ruleName] ?? 0) + 1;
  }
  return counts;
}

export function countViolationsBySeverity(
  violations: ViolationLike[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const violation of violations) {
    counts[violation.severity] = (counts[violation.severity] ?? 0) + 1;
  }
  return counts;
}

export function collectRuleExceptionCountsFromConfig(
  configParsed: unknown
): RuleExceptionCount[] {
  if (!isRecord(configParsed)) {
    return [];
  }

  const forbidden = configParsed.forbidden;
  if (!Array.isArray(forbidden)) {
    return [];
  }

  const counts: RuleExceptionCount[] = [];

  for (const rule of forbidden) {
    if (!isRecord(rule)) {
      continue;
    }

    const name = getString(rule, 'name');
    if (name.length === 0) {
      continue;
    }

    let pathNotEntries = 0;
    let clientFileExceptions = 0;

    const from = rule.from;
    if (isRecord(from)) {
      const pathNot = from.pathNot;
      if (typeof pathNot === 'string' && pathNot.length > 0) {
        pathNotEntries = 1;
        if (pathNot.includes('^packages/client/')) {
          clientFileExceptions = 1;
        }
      } else if (Array.isArray(pathNot)) {
        for (const entry of pathNot) {
          if (typeof entry !== 'string') {
            continue;
          }

          pathNotEntries += 1;
          if (entry.startsWith('^packages/client/')) {
            clientFileExceptions += 1;
          }
        }
      }
    }

    counts.push({
      name,
      pathNotEntries,
      clientFileExceptions
    });
  }

  return counts;
}

export function parseDependencyCruiserSummary(
  reportParsed: unknown,
  configParsed: unknown
): DependencyCruiserSummaryResult {
  if (!isRecord(reportParsed) || !isRecord(reportParsed.summary)) {
    throw new Error(
      'Unexpected dependency-cruiser JSON format: missing summary'
    );
  }

  const summary = reportParsed.summary;
  const violations = collectViolations(summary);
  const ruleExceptionCounts = collectRuleExceptionCountsFromConfig(configParsed);

  let rulesWithPathNot = 0;
  let totalPathNotEntries = 0;
  let totalClientFileExceptions = 0;
  for (const item of ruleExceptionCounts) {
    if (item.pathNotEntries > 0) {
      rulesWithPathNot += 1;
    }
    totalPathNotEntries += item.pathNotEntries;
    totalClientFileExceptions += item.clientFileExceptions;
  }

  return {
    totals: {
      modulesCruised: getNumber(summary, 'totalCruised'),
      dependenciesCruised: getNumber(summary, 'totalDependenciesCruised'),
      errors: getNumber(summary, 'error'),
      warnings: getNumber(summary, 'warn'),
      infos: getNumber(summary, 'info'),
      ignored: getNumber(summary, 'ignore'),
      violations: violations.length
    },
    violationsByRule: countViolationsByRule(violations),
    violationsBySeverity: countViolationsBySeverity(violations),
    ruleExceptionCounts,
    exceptionTotals: {
      rulesWithPathNot,
      totalPathNotEntries,
      totalClientFileExceptions
    }
  };
}

export function renderTextSummary(
  result: DependencyCruiserSummaryResult
): string {
  const lines: string[] = [];
  lines.push('Dependency Cruiser Summary');
  lines.push(`- Modules cruised: ${result.totals.modulesCruised}`);
  lines.push(`- Dependencies cruised: ${result.totals.dependenciesCruised}`);
  lines.push(
    `- Violations: ${result.totals.violations} (errors=${result.totals.errors}, warnings=${result.totals.warnings})`
  );

  if (Object.keys(result.violationsByRule).length === 0) {
    lines.push('- Violations by rule: none');
  } else {
    lines.push('- Violations by rule:');
    for (const [ruleName, count] of Object.entries(result.violationsByRule)) {
      lines.push(`  ${ruleName}: ${count}`);
    }
  }

  lines.push('- Rule exception counts (pathNot entries):');
  lines.push(
    `- Exception totals: rulesWithPathNot=${result.exceptionTotals.rulesWithPathNot}, totalPathNotEntries=${result.exceptionTotals.totalPathNotEntries}, totalClientFileExceptions=${result.exceptionTotals.totalClientFileExceptions}`
  );
  for (const item of result.ruleExceptionCounts) {
    lines.push(
      `  ${item.name}: pathNot=${item.pathNotEntries}, clientFileExceptions=${item.clientFileExceptions}`
    );
  }

  return `${lines.join('\n')}\n`;
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  const reportRaw = readStdin();
  const reportParsed = parseJson(reportRaw, 'dependency-cruiser report');

  const configRaw = fs.readFileSync(options.configPath, 'utf8');
  const configParsed = parseJson(configRaw, options.configPath);

  const result = parseDependencyCruiserSummary(reportParsed, configParsed);

  const resultForExceptionsOnly = {
    exceptionTotals: result.exceptionTotals,
    rules: result.ruleExceptionCounts.filter((item) => item.pathNotEntries > 0)
  };

  if (options.json && options.exceptionsOnly) {
    process.stdout.write(`${JSON.stringify(resultForExceptionsOnly, null, 2)}\n`);
    return 0;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (options.exceptionsOnly) {
    process.stdout.write(`Dependency Cruiser Exception Summary\n`);
    process.stdout.write(
      `- rulesWithPathNot=${result.exceptionTotals.rulesWithPathNot}\n`
    );
    process.stdout.write(
      `- totalPathNotEntries=${result.exceptionTotals.totalPathNotEntries}\n`
    );
    process.stdout.write(
      `- totalClientFileExceptions=${result.exceptionTotals.totalClientFileExceptions}\n`
    );
    for (const item of resultForExceptionsOnly.rules) {
      process.stdout.write(
        `  ${item.name}: pathNot=${item.pathNotEntries}, clientFileExceptions=${item.clientFileExceptions}\n`
      );
    }
    return 0;
  }

  process.stdout.write(renderTextSummary(result));
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
