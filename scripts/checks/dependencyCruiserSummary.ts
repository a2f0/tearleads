import fs from 'node:fs';

interface CliOptions {
  json: boolean;
}

interface ViolationLike {
  ruleName: string;
  severity: string;
}

interface RuleExceptionCount {
  name: string;
  pathNotEntries: number;
  clientFileExceptions: number;
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

function parseArgs(argv: string[]): CliOptions {
  return {
    json: argv.includes('--json')
  };
}

function readStdin(): string {
  return fs.readFileSync(0, 'utf8');
}

function collectViolations(summary: Record<string, unknown>): ViolationLike[] {
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

function countViolationsByRule(
  violations: ViolationLike[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const violation of violations) {
    counts[violation.ruleName] = (counts[violation.ruleName] ?? 0) + 1;
  }
  return counts;
}

function countViolationsBySeverity(
  violations: ViolationLike[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const violation of violations) {
    counts[violation.severity] = (counts[violation.severity] ?? 0) + 1;
  }
  return counts;
}

function collectRuleExceptionCounts(configPath: string): RuleExceptionCount[] {
  const configRaw = fs.readFileSync(configPath, 'utf8');
  const configParsed: unknown = JSON.parse(configRaw);
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const rawInput = readStdin();
  const parsed: unknown = JSON.parse(rawInput);

  if (!isRecord(parsed) || !isRecord(parsed.summary)) {
    throw new Error(
      'Unexpected dependency-cruiser JSON format: missing summary'
    );
  }

  const summary = parsed.summary;
  const violations = collectViolations(summary);
  const violationCountByRule = countViolationsByRule(violations);
  const violationCountBySeverity = countViolationsBySeverity(violations);
  const ruleExceptionCounts = collectRuleExceptionCounts(
    '.dependency-cruiser.json'
  );

  const result = {
    totals: {
      modulesCruised: getNumber(summary, 'totalCruised'),
      dependenciesCruised: getNumber(summary, 'totalDependenciesCruised'),
      errors: getNumber(summary, 'error'),
      warnings: getNumber(summary, 'warn'),
      infos: getNumber(summary, 'info'),
      ignored: getNumber(summary, 'ignore'),
      violations: violations.length
    },
    violationsByRule: violationCountByRule,
    violationsBySeverity: violationCountBySeverity,
    ruleExceptionCounts
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write('Dependency Cruiser Summary\n');
  process.stdout.write(
    `- Modules cruised: ${result.totals.modulesCruised}\n- Dependencies cruised: ${result.totals.dependenciesCruised}\n- Violations: ${result.totals.violations} (errors=${result.totals.errors}, warnings=${result.totals.warnings})\n`
  );

  if (Object.keys(result.violationsByRule).length === 0) {
    process.stdout.write('- Violations by rule: none\n');
  } else {
    process.stdout.write('- Violations by rule:\n');
    for (const [ruleName, count] of Object.entries(result.violationsByRule)) {
      process.stdout.write(`  ${ruleName}: ${count}\n`);
    }
  }

  process.stdout.write('- Rule exception counts (pathNot entries):\n');
  for (const item of result.ruleExceptionCounts) {
    process.stdout.write(
      `  ${item.name}: pathNot=${item.pathNotEntries}, clientFileExceptions=${item.clientFileExceptions}\n`
    );
  }
}

main();
