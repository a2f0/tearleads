import type { IConfiguration } from "dependency-cruiser";

type ForbiddenRules = NonNullable<IConfiguration["forbidden"]>;

const testFilesPattern = "\\.test\\.[tj]sx?$";

const sourceRoot = {
  api: "^packages/api/src/",
  app: "^packages/app/src/",
  clientSdk: "^packages/client-sdk/src/",
} as const;

const apiLayer = {
  access: `${sourceRoot.api}access/`,
  accessInternals: `${sourceRoot.api}access/(shared|read/internal|write/internal)/`,
  accessRead: `${sourceRoot.api}access/read/`,
  accessReadOrWrite: `${sourceRoot.api}access/(read|write)/`,
  accessSharedInternal: `${sourceRoot.api}access/shared/internal/`,
  accessWrite: `${sourceRoot.api}access/write/`,
  routes: `${sourceRoot.api}routes/`,
  services: `${sourceRoot.api}services/`,
  workflows: `${sourceRoot.api}workflows/`,
} as const;

const clientSdkLayer = {
  app: sourceRoot.app,
  client: `${sourceRoot.clientSdk}client/`,
  data: `${sourceRoot.clientSdk}data/`,
  dataInternals: [
    `${sourceRoot.clientSdk}data/persistence/`,
    `${sourceRoot.clientSdk}data/sqlite/`,
    `${sourceRoot.clientSdk}data/blobs/`,
    `${sourceRoot.clientSdk}data/contacts/`,
    `${sourceRoot.clientSdk}data/sync/`,
  ] as string[],
  stores: `${sourceRoot.clientSdk}stores/`,
  workflows: `${sourceRoot.clientSdk}workflows/`,
} as const;

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
      "Cruised local source imports should resolve. Workspace package/export contracts are checked by scripts/lintArchitecture.ts.",
    from: {},
    to: {
      couldNotResolve: true,
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
        testFilesPattern,
        "(^|/)tsconfig\\.json$",
        "(^|/)(?:babel|webpack)\\.config\\.(?:js|cjs|mjs|ts|json)$",
        "^packages/app/src/test/",
      ],
    },
    to: {},
  },
] satisfies ForbiddenRules;

const apiRules = [
  {
    name: "access-shared-internal-is-layer-neutral",
    severity: "error",
    comment:
      "Access shared internals are consumed by read and write APIs, so they must not depend back on either side.",
    from: {
      path: apiLayer.accessSharedInternal,
    },
    to: {
      path: apiLayer.accessReadOrWrite,
    },
  },
  {
    name: "access-read-does-not-depend-on-write",
    severity: "error",
    comment:
      "Read APIs and read internals must not depend on write APIs or write internals.",
    from: {
      path: apiLayer.accessRead,
      pathNot: testFilesPattern,
    },
    to: {
      path: apiLayer.accessWrite,
    },
  },
  {
    name: "access-does-not-depend-on-services-or-workflows",
    severity: "error",
    comment:
      "Access APIs are low-level stores/resolvers and must not call routes, route-facing services, or transaction workflows.",
    from: {
      path: apiLayer.access,
    },
    to: {
      path: [`${sourceRoot.api}routes/`, apiLayer.services, apiLayer.workflows],
    },
  },
  {
    name: "non-access-code-uses-public-access-apis",
    severity: "error",
    comment:
      "Code outside access/ should import the public access/read and access/write modules, not implementation internals.",
    from: {
      path: sourceRoot.api,
      pathNot: apiLayer.access,
    },
    to: {
      path: apiLayer.accessInternals,
    },
  },
  {
    name: "routes-do-not-compose-access-directly",
    severity: "error",
    comment:
      "Production routes should call services instead of composing access read/write modules directly.",
    from: {
      path: apiLayer.routes,
      pathNot: "\\.test\\.ts$",
    },
    to: {
      path: apiLayer.access,
    },
  },
  {
    name: "routes-do-not-call-workflows-directly",
    severity: "error",
    comment:
      "Production routes should call service facades; services own runtime concerns and delegate transaction orchestration to workflows.",
    from: {
      path: apiLayer.routes,
      pathNot: "\\.test\\.ts$",
    },
    to: {
      path: apiLayer.workflows,
    },
  },
  {
    name: "services-do-not-compose-access-directly",
    severity: "error",
    comment:
      "Production services should delegate access-plane reads and writes to workflows instead of importing access modules directly.",
    from: {
      path: apiLayer.services,
      pathNot: "\\.test\\.ts$",
    },
    to: {
      path: apiLayer.access,
    },
  },
  {
    name: "services-do-not-depend-on-routes",
    severity: "error",
    comment:
      "Services are route-facing facades below routes, so they must not depend back on route modules.",
    from: {
      path: apiLayer.services,
      pathNot: testFilesPattern,
    },
    to: {
      path: apiLayer.routes,
    },
  },
  {
    name: "workflows-do-not-depend-on-routes-or-services",
    severity: "error",
    comment:
      "Workflows own transaction-scoped orchestration below services and must not depend back on routes or services.",
    from: {
      path: apiLayer.workflows,
    },
    to: {
      path: [apiLayer.routes, apiLayer.services],
    },
  },
  {
    name: "api-support-code-does-not-compose-access-directly",
    severity: "error",
    comment:
      "Production API support modules outside routes, services, workflows, and access must not compose access APIs directly; move orchestration into workflows.",
    from: {
      path: sourceRoot.api,
      pathNot: [
        `${sourceRoot.api}(access|routes|services|workflows)/`,
        testFilesPattern,
      ],
    },
    to: {
      path: apiLayer.access,
    },
  },
] satisfies ForbiddenRules;

const clientSdkRules = [
  {
    name: "client-sdk-does-not-depend-on-app",
    severity: "error",
    comment:
      "The client SDK is the lower-level runtime package and must not import application implementation code.",
    from: {
      path: sourceRoot.clientSdk,
      pathNot: testFilesPattern,
    },
    to: {
      path: clientSdkLayer.app,
    },
  },
  {
    name: "client-sdk-data-does-not-depend-on-upper-layers",
    severity: "error",
    comment:
      "SDK data modules are low-level stores, contracts, and layer-neutral helpers; they must not depend on client, store, or workflow modules.",
    from: {
      path: clientSdkLayer.data,
      pathNot: testFilesPattern,
    },
    to: {
      path: [
        clientSdkLayer.client,
        clientSdkLayer.stores,
        clientSdkLayer.workflows,
      ],
    },
  },
  {
    name: "client-sdk-workflows-do-not-depend-on-stores-or-client-facade",
    severity: "error",
    comment:
      "SDK workflows own domain orchestration below stores and the high-level client facade.",
    from: {
      path: clientSdkLayer.workflows,
      pathNot: testFilesPattern,
    },
    to: {
      path: [clientSdkLayer.client, clientSdkLayer.stores],
    },
  },
  {
    name: "client-sdk-stores-use-workflow-facades-not-data-internals",
    severity: "error",
    comment:
      "SDK stores should compose public workflow facades instead of importing low-level persistence, SQLite, blob, contact, or sync internals directly.",
    from: {
      path: clientSdkLayer.stores,
      pathNot: testFilesPattern,
    },
    to: {
      path: clientSdkLayer.dataInternals,
    },
  },
] satisfies ForbiddenRules;

const dependencyCruiserConfig = {
  forbidden: [...standardRules, ...apiRules, ...clientSdkRules],
  options: {
    // Bun workspace subpath exports are checked separately in lintArchitecture.
    // Keep dependency-cruiser focused on source files whose paths it can resolve.
    includeOnly: "^packages/(api|app|client-sdk)/src/",
    tsPreCompilationDeps: "specify",
  },
} satisfies IConfiguration;

export default dependencyCruiserConfig;
