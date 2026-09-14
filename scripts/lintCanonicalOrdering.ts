import {
  canonicalOrderingRoots,
  scanCanonicalOrdering,
} from "./checks/canonicalOrdering";

const violations = scanCanonicalOrdering(process.cwd());

if (violations.length > 0) {
  console.error(
    `error canonical-ordering: hash-adjacent code (${canonicalOrderingRoots.join(", ")}) must sort with code-unit order (compareCanonicalStrings), not localeCompare without a locale or Intl.Collator.`,
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.filePath}:${violation.line}:${violation.column} ${violation.text}`,
    );
  }
  process.exit(1);
}
