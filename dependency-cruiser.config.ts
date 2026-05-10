import type { IConfiguration } from "dependency-cruiser";

type ForbiddenRules = NonNullable<IConfiguration["forbidden"]>;

const appLayer = {
  persistence: "^packages/app/src/data/persistence/",
  sqlite: "^packages/app/src/data/sqlite/",
  blobStorage: "^packages/app/src/data/blobs/",
  contactData: "^packages/app/src/data/contacts/",
  workflows: "^packages/app/src/workflows/",
  stores: "^packages/app/src/stores/",
  shellProviders: "^packages/app/src/providers/",
  sharedHelpers:
    "^packages/app/src/data/(containers|documents)(/blob)?/shared/",
};

// Keep app layer definitions broad and directory-shaped. If a rule needs a
// one-off file path, move that code into a directory that exposes the layer.
const appPresentation = [
  "^packages/app/src/components/",
  "^packages/app/src/document-types/",
  "^packages/app/src/mini-apps/",
];
const appReactRuntime = [
  "^packages/app/src/identity/",
  appLayer.shellProviders,
  appLayer.stores,
];
const appUpperLayers = [...appPresentation, ...appReactRuntime];
const appStorageInternals = [
  appLayer.persistence,
  appLayer.sqlite,
  appLayer.blobStorage,
  appLayer.contactData,
];
const testFilesPattern = "\\.test\\.[tj]sx?$";
const appRootSqlProvider =
  "^packages/app/src/providers/data/AppDataProvider\\.tsx$";

const apiRules = [
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
    comment: "Read internals must not depend on write APIs or write internals.",
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
] satisfies ForbiddenRules;

const appRules = [
  {
    name: "app-storage-does-not-depend-on-upper-layers",
    severity: "error",
    comment:
      "App persistence modules, SQLite internals, blob storage internals, and contact data internals are low-level stores/helpers and must not depend on React runtime, presentation, or workflow modules, including type-only contracts.",
    from: {
      path: appStorageInternals,
      pathNot: testFilesPattern,
    },
    to: {
      path: [...appUpperLayers, appLayer.workflows],
    },
  },
  {
    name: "app-workflows-do-not-depend-on-react-runtime",
    severity: "error",
    comment:
      "App workflows own multi-step local/remote orchestration below stores and providers, so they must not depend back on React runtime or presentation modules, including type-only contracts.",
    from: {
      path: appLayer.workflows,
      pathNot: testFilesPattern,
    },
    to: {
      path: appUpperLayers,
    },
  },
  {
    name: "app-shared-helpers-stay-layer-neutral",
    severity: "error",
    comment:
      "Document and container shared helpers are used by workflows and stores, so they must not depend on workflows, providers, hooks, or UI, including type-only contracts.",
    from: {
      path: appLayer.sharedHelpers,
      pathNot: testFilesPattern,
    },
    to: {
      path: [...appUpperLayers, appLayer.workflows],
    },
  },
  {
    name: "app-presentation-does-not-import-workflows-directly",
    severity: "error",
    comment:
      "Production app presentation should go through stores or providers so workflow orchestration and workflow-owned contracts stay outside components and hooks, including type-only contracts.",
    from: {
      path: appPresentation,
      pathNot: testFilesPattern,
    },
    to: {
      path: appLayer.workflows,
    },
  },
  {
    name: "app-presentation-does-not-import-storage-directly",
    severity: "error",
    comment:
      "Production app presentation should go through stores or providers instead of importing persistence stores, SQLite internals, blob storage internals, or contact data internals directly, including type-only contracts.",
    from: {
      path: appPresentation,
      pathNot: testFilesPattern,
    },
    to: {
      path: appStorageInternals,
    },
  },
  {
    name: "app-presentation-does-not-import-domain-shared-helpers",
    severity: "error",
    comment:
      "Production app presentation should use stores/providers or neutral data contracts instead of importing document/container shared helper internals directly, including type-only contracts.",
    from: {
      path: appPresentation,
      pathNot: testFilesPattern,
    },
    to: {
      path: appLayer.sharedHelpers,
    },
  },
  {
    name: "app-react-runtime-does-not-import-persistence-directly",
    severity: "error",
    comment:
      "Production app providers, identity runtime, and stores should consume domain workflow facades instead of importing low-level persistence stores directly, including type-only contracts.",
    from: {
      path: appReactRuntime,
      pathNot: testFilesPattern,
    },
    to: {
      path: appLayer.persistence,
    },
  },
  {
    name: "app-react-runtime-does-not-import-sqlite-directly",
    severity: "error",
    comment:
      "Production app providers, identity runtime, and stores should not import SQLite internals directly; the root app data provider owns executor construction.",
    from: {
      path: appReactRuntime,
      pathNot: `${testFilesPattern}|${appRootSqlProvider}`,
    },
    to: {
      path: appLayer.sqlite,
    },
  },
  {
    name: "app-react-runtime-does-not-import-blob-storage-directly",
    severity: "error",
    comment:
      "Production app providers, identity runtime, and stores should consume the blob workflow facade instead of importing blob storage internals directly.",
    from: {
      path: appReactRuntime,
      pathNot: testFilesPattern,
    },
    to: {
      path: appLayer.blobStorage,
    },
  },
  {
    name: "app-react-runtime-does-not-import-contact-data-directly",
    severity: "error",
    comment:
      "Production app providers, identity runtime, and stores should consume the contacts workflow facade instead of importing contact data internals directly.",
    from: {
      path: appReactRuntime,
      pathNot: testFilesPattern,
    },
    to: {
      path: appLayer.contactData,
    },
  },
] satisfies ForbiddenRules;

const dependencyCruiserConfig = {
  forbidden: [...apiRules, ...appRules],
  options: {
    includeOnly: "^packages/(api|app)/src/",
    tsPreCompilationDeps: "specify",
  },
} satisfies IConfiguration;

export default dependencyCruiserConfig;
