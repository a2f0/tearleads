declare namespace NodeJS {
  interface ProcessEnv {
    /** Backend URL; defaults to http://localhost:3001 when unset. */
    BUN_PUBLIC_API_BASE_URL?: string;
    /**
     * Build identity, stamped by scripts/withBuildInfoEnv.sh and inlined by the
     * `env: "BUN_PUBLIC_*"` passthrough the mainview declares in
     * electrobun.config.ts.
     */
    BUN_PUBLIC_APP_VERSION?: string;
    BUN_PUBLIC_GIT_SHA?: string;
    /** Websocket override; defaults to the events path of the backend URL. */
    BUN_PUBLIC_WS_URL?: string;
  }
}
