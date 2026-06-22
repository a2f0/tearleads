export const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export type Severity = (typeof SEVERITIES)[number];

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function isSeverity(value: string): value is Severity {
  return SEVERITIES.some((severity) => severity === value);
}

export function meetsThreshold(
  severity: Severity,
  threshold: Severity,
): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}

export function compareSeverityDesc(a: Severity, b: Severity): number {
  return SEVERITY_RANK[b] - SEVERITY_RANK[a];
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "🟥 **Critical**",
  high: "🟧 **High**",
  medium: "🟨 **Medium**",
  low: "🟦 **Low**",
};

export function severityLabel(severity: Severity): string {
  return SEVERITY_LABEL[severity];
}
