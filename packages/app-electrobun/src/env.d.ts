declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * Build identity, stamped by scripts/withBuildInfoEnv.sh and inlined by the
     * `env: "BUN_PUBLIC_*"` passthrough the mainview declares in
     * electrobun.config.ts.
     */
    BUN_PUBLIC_APP_VERSION?: string;
    BUN_PUBLIC_GIT_SHA?: string;
  }
}
