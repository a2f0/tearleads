/** Best-effort evidence hygiene; native agents still have host-file access. */
export function redactText(value: string): string {
  return value
    .replace(
      /\bsk-(?:ant-[a-z0-9]+-|proj-|svcacct-)?[a-z0-9_-]{16,}\b/gi,
      "[REDACTED]",
    )
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, "[REDACTED]")
    .replace(
      /(["']?(?:[a-z0-9_]*(?:token|password|secret|api[_-]?key|private[_-]?key)|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:Bearer|Basic)\s+[^\s,;}\]]+|[^\s,;}\]]+)/gi,
      "$1[REDACTED]",
    );
}

export function redactEvidence(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /(?:token|password|secret|authorization|api[_-]?key|private[_-]?key)$/i.test(
          key,
        )
          ? "[REDACTED]"
          : redactEvidence(item),
      ]),
    );
  return value;
}

export function evidenceJson(value: unknown): string {
  return JSON.stringify(redactEvidence(value), null, 2);
}
