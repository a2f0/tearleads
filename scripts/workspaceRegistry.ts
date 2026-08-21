export type WorkspaceRole =
  | "application"
  | "client-runtime"
  | "deployment-target"
  | "server"
  | "shared-library"
  | "test-support"
  | "tooling";

interface WorkspaceDefinition {
  readonly directory: string;
  readonly key: string;
  readonly packageName: string;
  readonly role: WorkspaceRole;
}

export const workspaceRegistry = [
  {
    directory: "agent-tool",
    key: "agentTool",
    packageName: "@symcrypt/agent-tool",
    role: "tooling",
  },
  {
    directory: "api",
    key: "api",
    packageName: "@symcrypt/api",
    role: "server",
  },
  {
    directory: "api-client",
    key: "apiClient",
    packageName: "@symcrypt/api-client",
    role: "shared-library",
  },
  {
    directory: "api-cli",
    key: "apiCli",
    packageName: "@symcrypt/api-cli",
    role: "server",
  },
  {
    directory: "api-shared",
    key: "apiShared",
    packageName: "@symcrypt/api-shared",
    role: "shared-library",
  },
  {
    directory: "app",
    key: "app",
    packageName: "app",
    role: "application",
  },
  {
    directory: "app-web",
    key: "appWeb",
    packageName: "app-web",
    role: "deployment-target",
  },
  {
    directory: "app-capacitor",
    key: "appCapacitor",
    packageName: "app-capacitor",
    role: "deployment-target",
  },
  {
    directory: "app-electrobun",
    key: "appElectrobun",
    packageName: "app-electrobun",
    role: "deployment-target",
  },
  {
    directory: "bob-and-alice",
    key: "bobAndAlice",
    packageName: "@symcrypt/bob-and-alice",
    role: "test-support",
  },
  {
    directory: "client-sdk",
    key: "clientSdk",
    packageName: "@symcrypt/client-sdk",
    role: "client-runtime",
  },
  {
    directory: "code-assist",
    key: "codeAssist",
    packageName: "@symcrypt/code-assist",
    role: "tooling",
  },
  {
    directory: "crypto",
    key: "crypto",
    packageName: "@symcrypt/crypto",
    role: "shared-library",
  },
  {
    directory: "encoding",
    key: "encoding",
    packageName: "@symcrypt/encoding",
    role: "shared-library",
  },
  {
    directory: "loro",
    key: "loro",
    packageName: "@symcrypt/loro",
    role: "shared-library",
  },
  {
    directory: "sqlite-instance",
    key: "sqliteInstance",
    packageName: "@symcrypt/sqlite-instance",
    role: "shared-library",
  },
  {
    directory: "sqlite-worker",
    key: "sqliteWorker",
    packageName: "@symcrypt/sqlite-worker",
    role: "shared-library",
  },
  {
    directory: "test-utils",
    key: "testUtils",
    packageName: "@symcrypt/test-utils",
    role: "test-support",
  },
  {
    directory: "ui",
    key: "ui",
    packageName: "@symcrypt/ui",
    role: "shared-library",
  },
  {
    directory: "validators",
    key: "validators",
    packageName: "@symcrypt/validators",
    role: "shared-library",
  },
  {
    directory: "website",
    key: "website",
    packageName: "website",
    role: "deployment-target",
  },
] as const satisfies readonly WorkspaceDefinition[];

export type WorkspaceKey = (typeof workspaceRegistry)[number]["key"];

export const workspaceDirectories = workspaceRegistry.map(
  (workspace) => workspace.directory,
);

export const workspacePaths = workspaceRegistry.map(
  (workspace) => `packages/${workspace.directory}`,
);

export const workspaceSourcePaths = Object.fromEntries(
  workspaceRegistry.map((workspace) => [
    workspace.key,
    `packages/${workspace.directory}/src`,
  ]),
) as Readonly<Record<WorkspaceKey, string>>;

export const deploymentTargetDirectories = workspaceRegistry
  .filter((workspace) => workspace.role === "deployment-target")
  .map((workspace) => workspace.directory);
