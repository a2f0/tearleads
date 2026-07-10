import { spawnSync } from "node:child_process";

interface CommitlintConfig {
  readonly rules: Record<string, unknown>;
}

interface CommitlintConfigModule {
  readonly commitHeaderMaxLength: number;
  readonly default: CommitlintConfig;
}

const branchNamePattern =
  /^(?<type>[a-z][a-z0-9-]*)\/(?<name>[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*)$/;
const exemptBranchNames = new Set(["main"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCommitlintConfig(value: unknown): value is CommitlintConfig {
  if (!isRecord(value)) {
    return false;
  }

  const { rules } = value;
  return isRecord(rules);
}

function isCommitlintConfigModule(
  value: unknown,
): value is CommitlintConfigModule {
  if (!isRecord(value)) {
    return false;
  }

  const { commitHeaderMaxLength, default: defaultConfig } = value;
  return (
    typeof commitHeaderMaxLength === "number" &&
    Number.isInteger(commitHeaderMaxLength) &&
    commitHeaderMaxLength > 0 &&
    isCommitlintConfig(defaultConfig)
  );
}

async function loadCommitlintConfigModule(): Promise<CommitlintConfigModule> {
  const module: unknown = await import(
    new URL("../commitlint.config.mts", import.meta.url).href
  );

  if (!isCommitlintConfigModule(module)) {
    throw new Error("commitlint config is not configured as expected.");
  }

  return module;
}

function listConventionalTypes(
  commitlintConfig: CommitlintConfig,
): readonly string[] {
  const typeEnumRule = commitlintConfig.rules["type-enum"];

  if (!Array.isArray(typeEnumRule) || !Array.isArray(typeEnumRule[2])) {
    throw new Error("commitlint type-enum rule is not configured as expected.");
  }

  return typeEnumRule[2].map((type) => String(type));
}

function getCurrentBranchName(): string | undefined {
  const result = spawnSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "Failed to read current branch.");
  }

  const branchName = result.stdout?.trim();
  return branchName ? branchName : undefined;
}

function formatBranchName(
  branchName: string,
  conventionalTypes: readonly string[],
): string {
  return [
    `Invalid branch name: ${branchName}`,
    `Expected: <type>/<name>, where <type> is one of ${conventionalTypes.join("|")}.`,
    "Use lowercase letters, numbers, dots, dashes, underscores, and slashes after the type.",
    "Examples: feat/add-login, perf/query-cache, cleanup/remove-dead-code",
  ].join("\n");
}

function formatBranchNameLength(branchName: string, maxLength: number): string {
  return [
    `Invalid branch name: ${branchName}`,
    `Expected: ${maxLength} characters or fewer, matching commitlint header-max-length.`,
    `Received: ${branchName.length} characters.`,
  ].join("\n");
}

function lintBranchName(
  branchName: string,
  conventionalTypes: ReadonlySet<string>,
  conventionalTypeNames: readonly string[],
  branchNameMaxLength: number,
): string | undefined {
  if (exemptBranchNames.has(branchName)) {
    return undefined;
  }

  if (branchName.length > branchNameMaxLength) {
    return formatBranchNameLength(branchName, branchNameMaxLength);
  }

  if (branchName !== branchName.toLowerCase()) {
    return formatBranchName(branchName, conventionalTypeNames);
  }

  const match = branchNamePattern.exec(branchName);
  if (!match?.groups) {
    return formatBranchName(branchName, conventionalTypeNames);
  }

  const { type } = match.groups;
  if (!type || !conventionalTypes.has(type)) {
    return formatBranchName(branchName, conventionalTypeNames);
  }

  return undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

const commitlintConfigModule = await loadCommitlintConfigModule();
const conventionalTypeNames = listConventionalTypes(
  commitlintConfigModule.default,
);
const conventionalTypes = new Set(conventionalTypeNames);
const branchNames = process.argv.slice(2);
const branchNamesToLint =
  branchNames.length > 0
    ? branchNames
    : [getCurrentBranchName()].filter(isDefined);
const errors = branchNamesToLint.flatMap((branchName) => {
  const error = lintBranchName(
    branchName,
    conventionalTypes,
    conventionalTypeNames,
    commitlintConfigModule.commitHeaderMaxLength,
  );
  return error === undefined ? [] : [error];
});

if (errors.length > 0) {
  console.error(errors.join("\n\n"));
  process.exit(1);
}
