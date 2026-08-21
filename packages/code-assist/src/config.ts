import { DEFAULT_IGNORE_PATTERNS } from "./review/ignoreFilter";
import { isSeverity, type Severity } from "./severity";

export interface CodeAssistConfig {
  readonly deepseekApiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly botHandle: string;
  readonly severityThreshold: Severity;
  readonly maxComments: number;
  readonly ignorePatterns: readonly string[];
}

const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_BOT_HANDLE = "@symcrypt-code-assist";
const DEFAULT_SEVERITY_THRESHOLD: Severity = "medium";
const DEFAULT_MAX_COMMENTS = 25;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readSeverityThreshold(): Severity {
  const { CODE_ASSIST_SEVERITY_THRESHOLD: raw } = process.env;
  if (!raw) {
    return DEFAULT_SEVERITY_THRESHOLD;
  }
  if (!isSeverity(raw)) {
    throw new Error(`Invalid CODE_ASSIST_SEVERITY_THRESHOLD: ${raw}`);
  }
  return raw;
}

function readMaxComments(): number {
  const { CODE_ASSIST_MAX_COMMENTS: raw } = process.env;
  if (!raw) {
    return DEFAULT_MAX_COMMENTS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new Error(`Invalid CODE_ASSIST_MAX_COMMENTS: ${raw}`);
  }
  return parsed;
}

function readIgnorePatterns(): readonly string[] {
  const { CODE_ASSIST_IGNORE_PATTERNS: raw } = process.env;
  // Unset → defaults; an explicit (even empty) value disables filtering or
  // overrides the defaults entirely.
  if (raw === undefined) {
    return DEFAULT_IGNORE_PATTERNS;
  }
  return raw
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

export function loadConfig(): CodeAssistConfig {
  const { CODE_ASSIST_MODEL, CODE_ASSIST_BASE_URL, CODE_ASSIST_BOT_HANDLE } =
    process.env;
  return {
    deepseekApiKey: requireEnv("DEEPSEEK_API_KEY"),
    model: CODE_ASSIST_MODEL ?? DEFAULT_MODEL,
    baseUrl: CODE_ASSIST_BASE_URL ?? DEFAULT_BASE_URL,
    botHandle: CODE_ASSIST_BOT_HANDLE ?? DEFAULT_BOT_HANDLE,
    severityThreshold: readSeverityThreshold(),
    maxComments: readMaxComments(),
    ignorePatterns: readIgnorePatterns(),
  };
}
