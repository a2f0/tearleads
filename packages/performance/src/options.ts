import { parseArgs } from "node:util";

export const targets = {
  staging: {
    origin: "https://api-staging.tearleads.com",
    worker: "tearleads-platform-api-staging",
  },
  production: {
    origin: "https://api.tearleads.com",
    worker: "tearleads-platform-api-prod",
  },
} as const;

export interface Options {
  environment: keyof typeof targets;
  samples: number;
  cloudflare: boolean;
}

export const usage = `Provision fresh identities through the public SDK.

bun run perf:provision --env staging|production [--samples 1..10] [--cloudflare]

One sample by default; sequential samples, one second apart; stop on failure.
Each sample creates a persistent remote account and organization. Local keys
are discarded; reports retain account IDs for operator follow-up. Login is
measured separately and its session is revoked afterwards.
--cloudflare requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
Reports are saved under .test_files/performance/ in the repository root.`;

export function parseOptions(args: string[]): Options | null {
  const { values } = parseArgs({
    args,
    options: {
      env: { type: "string" },
      samples: { type: "string", default: "1" },
      cloudflare: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return null;
  if (values.env !== "staging" && values.env !== "production") {
    throw new Error("Choose --env staging or --env production explicitly.");
  }
  if (!/^(?:[1-9]|10)$/.test(values.samples)) {
    throw new Error("--samples must be an integer from 1 to 10.");
  }
  return {
    environment: values.env,
    samples: Number(values.samples),
    cloudflare: values.cloudflare,
  };
}
