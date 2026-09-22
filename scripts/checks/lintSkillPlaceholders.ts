import { scanSkillPlaceholders, skillRoots } from "./skillPlaceholders";

const violations = scanSkillPlaceholders(process.cwd());

if (violations.length > 0) {
  console.error(
    `error skill-placeholders: skill documents (${skillRoots.join(", ")}) must not contain $0-$9 or $ARGUMENTS. Invoking a skill with arguments substitutes them into the text the agent reads, so a snippet such as awk '{ print $1 }' arrives corrupted while the file on disk still looks correct. Use cut, sed, or named variables.`,
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.filePath}:${violation.line}:${violation.column} ${violation.text}`,
    );
  }
  process.exit(1);
}
