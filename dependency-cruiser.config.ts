import type { IConfiguration } from "dependency-cruiser";

const appPersistence = "^packages/app/src/data/persistence/";
const appWorkflows = "^packages/app/src/workflows/";
const appSharedHelpers =
  "^packages/app/src/data/(containers|documents)(/blob)?/shared/";
const appUiAndProviders = [
  "^packages/app/src/components/",
  "^packages/app/src/data/documents/DocumentsProvider\\.tsx$",
  "^packages/app/src/document-types/",
  "^packages/app/src/identity/",
  "^packages/app/src/mini-apps/[^/]+/(context-menu|detail|hooks|modal|providers)/",
  "^packages/app/src/mini-apps/[^/]+/[^/]+(?:App)?\\.tsx$",
  "^packages/app/src/providers/",
];
const appUiWithoutStores = [
  "^packages/app/src/components/",
  "^packages/app/src/document-types/",
  "^packages/app/src/mini-apps/[^/]+/(context-menu|detail|hooks|modal)/",
  "^packages/app/src/mini-apps/[^/]+/[^/]+(?:App)?\\.tsx$",
];
const appSqliteInternals =
  "^packages/app/src/data/persistence/(appDatabaseRuntime|documentPersistence|schema|sqlSchema)";

const dependencyCruiserConfig = {
  forbidden: [
    {
      name: "access-shared-internal-is-layer-neutral",
      severity: "error",
      comment:
        "Access shared internals are consumed by read and write APIs, so they must not depend back on either side.",
      from: {
        path: "^packages/api/src/access/shared/internal/",
      },
      to: {
        path: "^packages/api/src/access/(read|write)/",
      },
    },
    {
      name: "access-read-internal-does-not-depend-on-write",
      severity: "error",
      comment:
        "Read internals must not depend on write APIs or write internals.",
      from: {
        path: "^packages/api/src/access/read/internal/",
      },
      to: {
        path: "^packages/api/src/access/write/",
      },
    },
    {
      name: "access-does-not-depend-on-services-or-workflows",
      severity: "error",
      comment:
        "Access APIs are low-level stores/resolvers and must not call routes, route-facing services, or transaction workflows.",
      from: {
        path: "^packages/api/src/access/",
      },
      to: {
        path: "^packages/api/src/(routes|services|workflows)/",
      },
    },
    {
      name: "non-access-code-uses-public-access-apis",
      severity: "error",
      comment:
        "Code outside access/ should import the public access/read and access/write modules, not implementation internals.",
      from: {
        path: "^packages/api/src/",
        pathNot: "^packages/api/src/access/",
      },
      to: {
        path: "^packages/api/src/access/(shared|read/internal|write/internal)/",
      },
    },
    {
      name: "routes-do-not-compose-access-directly",
      severity: "error",
      comment:
        "Production routes should call services instead of composing access read/write modules directly.",
      from: {
        path: "^packages/api/src/routes/",
        pathNot: "\\.test\\.ts$",
      },
      to: {
        path: "^packages/api/src/access/",
      },
    },
    {
      name: "routes-do-not-call-workflows-directly",
      severity: "error",
      comment:
        "Production routes should call service facades; services own runtime concerns and delegate transaction orchestration to workflows.",
      from: {
        path: "^packages/api/src/routes/",
        pathNot: "\\.test\\.ts$",
      },
      to: {
        path: "^packages/api/src/workflows/",
      },
    },
    {
      name: "services-do-not-compose-access-directly",
      severity: "error",
      comment:
        "Production services should delegate access-plane reads and writes to workflows instead of importing access modules directly.",
      from: {
        path: "^packages/api/src/services/",
        pathNot: "\\.test\\.ts$",
      },
      to: {
        path: "^packages/api/src/access/",
      },
    },
    {
      name: "workflows-do-not-depend-on-routes-or-services",
      severity: "error",
      comment:
        "Workflows own transaction-scoped orchestration below services and must not depend back on routes or services.",
      from: {
        path: "^packages/api/src/workflows/",
      },
      to: {
        path: "^packages/api/src/(routes|services)/",
      },
    },
    {
      name: "app-persistence-does-not-depend-on-ui-or-workflows",
      severity: "error",
      comment:
        "App persistence modules are low-level SQLite stores and must not depend on React, providers, hooks, UI, or workflow modules.",
      from: {
        path: appPersistence,
        pathNot: "\\.test\\.[tj]sx?$",
      },
      to: {
        path: [...appUiAndProviders, appWorkflows],
        preCompilationOnly: false,
      },
    },
    {
      name: "app-workflows-do-not-depend-on-ui-or-providers",
      severity: "error",
      comment:
        "App workflows own multi-step local/remote orchestration below providers and must not depend back on React UI or provider modules.",
      from: {
        path: appWorkflows,
        pathNot: "\\.test\\.[tj]sx?$",
      },
      to: {
        path: appUiAndProviders,
        preCompilationOnly: false,
      },
    },
    {
      name: "app-shared-helpers-stay-layer-neutral",
      severity: "error",
      comment:
        "Document and container shared helpers are used by workflows and stores, so they must not depend on workflows, providers, hooks, or UI.",
      from: {
        path: appSharedHelpers,
        pathNot: "\\.test\\.[tj]sx?$",
      },
      to: {
        path: [...appUiAndProviders, appWorkflows],
        preCompilationOnly: false,
      },
    },
    {
      name: "app-ui-does-not-import-sqlite-internals",
      severity: "error",
      comment:
        "Production app UI and mini-app hooks should not import core SQLite runtime/schema internals directly.",
      from: {
        path: appUiWithoutStores,
        pathNot: "\\.test\\.[tj]sx?$",
      },
      to: {
        path: appSqliteInternals,
        preCompilationOnly: false,
      },
    },
  ],
  options: {
    includeOnly: "^packages/(api|app)/src/",
    tsPreCompilationDeps: "specify",
  },
} satisfies IConfiguration;

export default dependencyCruiserConfig;
