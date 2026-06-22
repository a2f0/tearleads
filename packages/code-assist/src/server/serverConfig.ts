import { type CodeAssistConfig, loadConfig } from "../config";

export interface GithubAppConfig {
  readonly appId: number;
  readonly privateKey: string;
  readonly webhookSecret: string;
}

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly app: GithubAppConfig;
  readonly review: CodeAssistConfig;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3939;

function readAppId(): number {
  const { CODE_ASSIST_GITHUB_APP_ID } = process.env;
  if (!CODE_ASSIST_GITHUB_APP_ID) {
    throw new Error(
      "Missing required environment variable: CODE_ASSIST_GITHUB_APP_ID",
    );
  }
  const appId = Number.parseInt(CODE_ASSIST_GITHUB_APP_ID, 10);
  if (Number.isNaN(appId)) {
    throw new Error(
      `Invalid CODE_ASSIST_GITHUB_APP_ID: ${CODE_ASSIST_GITHUB_APP_ID}`,
    );
  }
  return appId;
}

async function readPrivateKey(): Promise<string> {
  const {
    CODE_ASSIST_GITHUB_PRIVATE_KEY_PATH,
    CODE_ASSIST_GITHUB_PRIVATE_KEY,
  } = process.env;
  if (CODE_ASSIST_GITHUB_PRIVATE_KEY_PATH) {
    const text = await Bun.file(CODE_ASSIST_GITHUB_PRIVATE_KEY_PATH).text();
    if (!text.trim()) {
      throw new Error(
        `Private key file is empty: ${CODE_ASSIST_GITHUB_PRIVATE_KEY_PATH}`,
      );
    }
    return text;
  }
  if (CODE_ASSIST_GITHUB_PRIVATE_KEY) {
    // Allow a PEM stored with escaped newlines on a single env line.
    return CODE_ASSIST_GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  throw new Error(
    "Set CODE_ASSIST_GITHUB_PRIVATE_KEY_PATH or CODE_ASSIST_GITHUB_PRIVATE_KEY",
  );
}

function readWebhookSecret(): string {
  const { CODE_ASSIST_GITHUB_WEBHOOK_SECRET } = process.env;
  if (!CODE_ASSIST_GITHUB_WEBHOOK_SECRET) {
    throw new Error(
      "Missing required environment variable: CODE_ASSIST_GITHUB_WEBHOOK_SECRET",
    );
  }
  return CODE_ASSIST_GITHUB_WEBHOOK_SECRET;
}

function readPort(): number {
  const { CODE_ASSIST_PORT } = process.env;
  if (!CODE_ASSIST_PORT) {
    return DEFAULT_PORT;
  }
  const port = Number.parseInt(CODE_ASSIST_PORT, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid CODE_ASSIST_PORT: ${CODE_ASSIST_PORT}`);
  }
  return port;
}

function readHost(): string {
  const { CODE_ASSIST_HOST } = process.env;
  return CODE_ASSIST_HOST && CODE_ASSIST_HOST.length > 0
    ? CODE_ASSIST_HOST
    : DEFAULT_HOST;
}

export async function loadServerConfig(): Promise<ServerConfig> {
  return {
    host: readHost(),
    port: readPort(),
    app: {
      appId: readAppId(),
      privateKey: await readPrivateKey(),
      webhookSecret: readWebhookSecret(),
    },
    review: loadConfig(),
  };
}
