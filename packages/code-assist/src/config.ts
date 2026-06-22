import { isSeverity, type Severity } from "./severity";

export interface CodeAssistConfig {
  readonly deepseekApiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly severityThreshold: Severity;
  readonly maxComments: number;
}

const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
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

export function loadConfig(): CodeAssistConfig {
  const { CODE_ASSIST_MODEL, CODE_ASSIST_BASE_URL } = process.env;
  return {
    deepseekApiKey: requireEnv("DEEPSEEK_API_KEY"),
    model: CODE_ASSIST_MODEL ?? DEFAULT_MODEL,
    baseUrl: CODE_ASSIST_BASE_URL ?? DEFAULT_BASE_URL,
    severityThreshold: readSeverityThreshold(),
    maxComments: readMaxComments(),
  };
}
