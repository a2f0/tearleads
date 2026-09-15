declare namespace NodeJS {
  interface ProcessEnv {
    /** Backend URL; defaults to http://localhost:3001 when unset. */
    BUN_PUBLIC_API_BASE_URL?: string;
    /**
     * Build identity, stamped by scripts/lib/withBuildInfoEnv.sh and inlined by the
     * renderer defines (including unset values) declared in
     * electrobun.config.ts.
     */
    BUN_PUBLIC_APP_VERSION?: string;
    BUN_PUBLIC_GIT_SHA?: string;
    /**
     * Private error diagnostics, inlined only by the packaged release build.
     * Reporting stays off unless all four are present and well formed; see
     * docs/developer/sentry.md. The target is Hutch's build target, never read
     * from the environment.
     */
    BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT?: string;
    BUN_PUBLIC_SENTRY_ELECTROBUN_DSN?: string;
    BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT?: string;
    BUN_PUBLIC_SENTRY_ELECTROBUN_TARGET?: string;
    /** Websocket override; defaults to the events path of the backend URL. */
    BUN_PUBLIC_WS_URL?: string;
  }
}

/** Desktop window title, inlined by electrobun.config.ts. */
declare const TEARLEADS_ELECTROBUN_APP_NAME: string;

/**
 * Main-process Sentry release values, replaced at build time by
 * electrobun.config.ts (null unless a release tier). Deliberately not
 * process.env: it has no runtime fallback.
 */
declare const TEARLEADS_ELECTROBUN_MAIN_SENTRY:
  | { commit?: string; dsn?: string; environment?: string; target?: string }
  | null
  | undefined;
