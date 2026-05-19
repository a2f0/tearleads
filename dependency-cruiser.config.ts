import type { IConfiguration } from "dependency-cruiser";

type ForbiddenRules = NonNullable<IConfiguration["forbidden"]>;

const appLayer = {
  data: "^packages/app/src/data/",
  persistence: "^packages/app/src/data/persistence/",
  sqlite: "^packages/app/src/data/sqlite/",
  blobStorage: "^packages/app/src/data/blobs/",
  contactData: "^packages/app/src/data/contacts/",
  sync: "^packages/app/src/data/sync/",
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
  appLayer.sync,
];
const testFilesPattern = "\\.test\\.[tj]sx?$";
const appRootSqlProvider =
  "^packages/app/src/providers/data/AppDataProvider\\.tsx$";

const standardRules = [
  {
    name: "no-circular",
    severity: "error",
    comment:
      "Circular imports make module initialization order fragile and usually signal a boundary leak.",
    from: {},
    to: {
      circular: true,
    },
  },
  {
    name: "not-to-unresolvable",
    severity: "error",
    comment:
      "Every imported module should resolve from source or an explicitly declared package dependency.",
    from: {},
    to: {
      couldNotResolve: true,
    },
  },
  {
    name: "no-non-package-json",
    severity: "error",
    comment:
      "Runtime npm imports must be declared in the importing workspace package manifest.",
    from: {},
    to: {
      dependencyTypes: ["npm-no-pkg", "npm-unknown"],
    },
  },
  {
    name: "not-to-dev-dep",
    severity: "error",
    comment:
      "Production app and API modules must not import runtime values from devDependencies.",
    from: {
      path: "^packages/(api|app|client-sdk)/src/",
      pathNot: testFilesPattern,
    },
    to: {
      dependencyTypes: ["npm-dev"],
      dependencyTypesNot: ["type-only"],
      pathNot: "node_modules/@types/",
    },
  },
  {
    name: "no-duplicate-dep-types",
    severity: "warn",
    comment:
      "A package should not be declared through multiple dependency sections.",
    from: {},
    to: {
      moreThanOneDependencyType: true,
      dependencyTypesNot: ["type-only"],
    },
  },
  {
    name: "no-orphans",
    severity: "warn",
    comment:
      "A source module with no imports and no importers is usually dead or misplaced.",
    from: {
      orphan: true,
      pathNot: [
        "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$",
        "\\.d\\.(c|m)?ts$",
        "(^|/)tsconfig\\.json$",
        "(^|/)(?:babel|webpack)\\.config\\.(?:js|cjs|mjs|ts|json)$",
        "^packages/app/src/(data|workflows)/",
      ],
    },
    to: {},
  },
] satisfies ForbiddenRules;

const clientSdkRules = [
  {
    name: "client-sdk-does-not-depend-on-app",
    severity: "error",
    comment:
      "The client SDK is the lower-level runtime package and must not import application implementation code.",
    from: {
      path: "^packages/client-sdk/src/",
      pathNot: testFilesPattern,
    },
    to: {
      path: "^packages/app/src/",
    },
  },
] satisfies ForbiddenRules;

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
    name: "access-read-does-not-depend-on-write",
    severity: "error",
    comment:
      "Read APIs and read internals must not depend on write APIs or write internals.",
    from: {
      path: "^packages/api/src/access/read/",
      pathNot: testFilesPattern,
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
    name: "services-do-not-depend-on-routes",
    severity: "error",
    comment:
      "Services are route-facing facades below routes, so they must not depend back on route modules.",
    from: {
      path: "^packages/api/src/services/",
      pathNot: testFilesPattern,
    },
    to: {
      path: "^packages/api/src/routes/",
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
    name: "api-support-code-does-not-compose-access-directly",
    severity: "error",
    comment:
      "Production API support modules outside routes, services, workflows, and access must not compose access APIs directly; move orchestration into workflows.",
    from: {
      path: "^packages/api/src/",
      pathNot: [
        "^packages/api/src/(access|routes|services|workflows)/",
        testFilesPattern,
      ],
    },
    to: {
      path: "^packages/api/src/access/",
    },
  },
] satisfies ForbiddenRules;

const appRules = [
  {
    name: "app-data-does-not-depend-on-upper-layers",
    severity: "error",
    comment:
      "Production app data modules are low-level stores, contracts, and layer-neutral helpers; they must not depend on React runtime, presentation, or workflow modules, including type-only contracts.",
    from: {
      path: appLayer.data,
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
  forbidden: [...standardRules, ...apiRules, ...clientSdkRules, ...appRules],
  options: {
    includeOnly: "^packages/(api|app|client-sdk)/src/",
    tsPreCompilationDeps: "specify",
  },
} satisfies IConfiguration;

export default dependencyCruiserConfig;
