import type { IConfiguration } from "dependency-cruiser";

type ForbiddenRules = NonNullable<IConfiguration["forbidden"]>;

const testFilesPattern = "\\.test\\.[tj]sx?$";

const sourceRoot = {
  apiClient: "^packages/api-client/src/",
  apiCli: "^packages/api-cli/src/",
  apiShared: "^packages/api-shared/src/",
  api: "^packages/api/src/",
  appElectrobun: "^packages/app-electrobun/src/",
  appWeb: "^packages/app-web/src/",
  app: "^packages/app/src/",
  bobAndAlice: "^packages/bob-and-alice/src/",
  clientSdk: "^packages/client-sdk/src/",
  crypto: "^packages/crypto/src/",
  encoding: "^packages/encoding/src/",
  loro: "^packages/loro/src/",
  sqliteInstance: "^packages/sqlite-instance/src/",
  sqliteWorker: "^packages/sqlite-worker/src/",
  testUtils: "^packages/test-utils/src/",
  ui: "^packages/ui/src/",
  validators: "^packages/validators/src/",
  website: "^packages/website/src/",
} as const;

const allPackageSourceRoots = Object.values(sourceRoot);
const deploymentTargetSourceRoots = [
  sourceRoot.appElectrobun,
  sourceRoot.appWeb,
  sourceRoot.website,
];

const appLayer = {
  data: `${sourceRoot.app}data/`,
  persistence: `${sourceRoot.app}data/persistence/`,
  sqlite: `${sourceRoot.app}data/sqlite/`,
  blobStorage: `${sourceRoot.app}data/blobs/`,
  contactData: `${sourceRoot.app}data/contacts/`,
  sync: `${sourceRoot.app}data/sync/`,
  workflows: `${sourceRoot.app}workflows/`,
  stores: `${sourceRoot.app}stores/`,
  shellProviders: `${sourceRoot.app}providers/`,
  sharedHelpers: `${sourceRoot.app}data/(containers|documents)(/blob)?/shared/`,
} as const;

const appPresentation = [
  `${sourceRoot.app}components/`,
  `${sourceRoot.app}document-types/`,
  `${sourceRoot.app}mini-apps/`,
];
const appReactRuntime = [
  `${sourceRoot.app}identity/`,
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
const appRootSqlProvider =
  "^packages/app/src/providers/data/AppDataProvider\\.tsx$";

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
      path: "^packages/(api|api-cli|api-shared|app|client-sdk)/src/",
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
    severity: "error",
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
    severity: "error",
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
        "^packages/api-cli/src/index\\.ts$",
        "^packages/api-shared/src/index\\.ts$",
        "^packages/app-electrobun/src/(bun/index|renderer/(databaseWorker|index))\\.tsx?$",
        "^packages/app-web/src/index\\.tsx$",
        "^packages/app/src/test/",
        "^packages/sqlite-instance/src/(assets|index)\\.ts$",
        "^packages/sqlite-worker/src/assets\\.ts$",
        "^packages/website/src/",
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
      path: [apiLayer.routes, apiLayer.services, apiLayer.workflows],
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

const apiPackageBoundaryRules = [
  {
    name: "api-cli-does-not-depend-on-api",
    severity: "error",
    comment:
      "The API CLI is a separate deployable entry package; shared server infrastructure belongs in api-shared.",
    from: {
      path: sourceRoot.apiCli,
      pathNot: testFilesPattern,
    },
    to: {
      path: sourceRoot.api,
    },
  },
  {
    name: "api-does-not-depend-on-api-cli",
    severity: "error",
    comment:
      "The API server must not depend on CLI implementation code; shared server infrastructure belongs in api-shared.",
    from: {
      path: sourceRoot.api,
      pathNot: testFilesPattern,
    },
    to: {
      path: sourceRoot.apiCli,
    },
  },
  {
    name: "api-shared-does-not-depend-on-api-or-cli",
    severity: "error",
    comment:
      "API shared source must stay below the API server and CLI packages.",
    from: {
      path: sourceRoot.apiShared,
      pathNot: testFilesPattern,
    },
    to: {
      path: [sourceRoot.api, sourceRoot.apiCli],
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

const corePackageRules = [
  {
    name: "validators-stays-leaf",
    severity: "error",
    comment:
      "Validators define wire contracts and low-level shape checks; they must not depend on other source packages.",
    from: {
      path: sourceRoot.validators,
      pathNot: testFilesPattern,
    },
    to: {
      path: allPackageSourceRoots.filter(
        (root) => root !== sourceRoot.validators,
      ),
    },
  },
  {
    name: "encoding-stays-leaf",
    severity: "error",
    comment:
      "Encoding helpers are leaf-level primitives and must not depend on other source packages.",
    from: {
      path: sourceRoot.encoding,
      pathNot: testFilesPattern,
    },
    to: {
      path: allPackageSourceRoots.filter(
        (root) => root !== sourceRoot.encoding,
      ),
    },
  },
  {
    name: "sqlite-instance-stays-leaf",
    severity: "error",
    comment:
      "The SQLite instance package only wraps the wasm distribution and must not depend on higher-level source packages.",
    from: {
      path: sourceRoot.sqliteInstance,
      pathNot: testFilesPattern,
    },
    to: {
      path: allPackageSourceRoots.filter(
        (root) => root !== sourceRoot.sqliteInstance,
      ),
    },
  },
  {
    name: "crypto-does-not-depend-on-app-api-or-sdk-implementations",
    severity: "error",
    comment:
      "Crypto is a lower-level protocol package and must not import application, API, or client SDK implementation code.",
    from: {
      path: sourceRoot.crypto,
      pathNot: testFilesPattern,
    },
    to: {
      path: [
        sourceRoot.api,
        sourceRoot.apiClient,
        sourceRoot.apiCli,
        sourceRoot.apiShared,
        sourceRoot.app,
        sourceRoot.appElectrobun,
        sourceRoot.appWeb,
        sourceRoot.clientSdk,
        sourceRoot.ui,
        sourceRoot.website,
      ],
    },
  },
  {
    name: "loro-does-not-depend-on-app-api-or-sdk-implementations",
    severity: "error",
    comment:
      "Loro is a lower-level support package and must not import application, API, or client SDK implementation code.",
    from: {
      path: sourceRoot.loro,
      pathNot: testFilesPattern,
    },
    to: {
      path: [
        sourceRoot.api,
        sourceRoot.apiClient,
        sourceRoot.apiCli,
        sourceRoot.apiShared,
        sourceRoot.app,
        sourceRoot.appElectrobun,
        sourceRoot.appWeb,
        sourceRoot.clientSdk,
        sourceRoot.ui,
        sourceRoot.website,
      ],
    },
  },
  {
    name: "api-client-does-not-depend-on-runtime-implementations",
    severity: "error",
    comment:
      "API client source may share protocol contracts but must not import server, app, SDK, UI, or deployment implementation code.",
    from: {
      path: sourceRoot.apiClient,
      pathNot: testFilesPattern,
    },
    to: {
      path: [
        sourceRoot.api,
        sourceRoot.apiCli,
        sourceRoot.apiShared,
        sourceRoot.app,
        sourceRoot.appElectrobun,
        sourceRoot.appWeb,
        sourceRoot.clientSdk,
        sourceRoot.ui,
        sourceRoot.website,
      ],
    },
  },
  {
    name: "sqlite-worker-depends-only-on-sqlite-instance",
    severity: "error",
    comment:
      "SQLite worker source should stay storage-runtime focused and only depend on the SQLite instance package.",
    from: {
      path: sourceRoot.sqliteWorker,
      pathNot: testFilesPattern,
    },
    to: {
      path: allPackageSourceRoots.filter(
        (root) =>
          root !== sourceRoot.sqliteWorker &&
          root !== sourceRoot.sqliteInstance,
      ),
    },
  },
  {
    name: "production-source-does-not-import-test-support-packages",
    severity: "error",
    comment:
      "Test support packages are dev-only helpers and must not be imported by production source files.",
    from: {
      path: allPackageSourceRoots.filter(
        (root) =>
          root !== sourceRoot.bobAndAlice && root !== sourceRoot.testUtils,
      ),
      pathNot: testFilesPattern,
    },
    to: {
      path: [sourceRoot.bobAndAlice, sourceRoot.testUtils],
    },
  },
  {
    name: "test-utils-does-not-depend-on-product-or-server-implementations",
    severity: "error",
    comment:
      "Shared test utilities should compose protocol/client/storage helpers, not product shells or server internals.",
    from: {
      path: sourceRoot.testUtils,
    },
    to: {
      path: [
        sourceRoot.api,
        sourceRoot.apiCli,
        sourceRoot.apiShared,
        sourceRoot.app,
        sourceRoot.appElectrobun,
        sourceRoot.appWeb,
        sourceRoot.clientSdk,
        sourceRoot.ui,
        sourceRoot.website,
      ],
    },
  },
  {
    name: "deployment-targets-are-not-reusable-libraries",
    severity: "error",
    comment:
      "Deployment target packages should consume shared packages and app facades, not become dependencies of reusable source packages.",
    from: {
      path: allPackageSourceRoots.filter(
        (root) => !deploymentTargetSourceRoots.includes(root),
      ),
      pathNot: testFilesPattern,
    },
    to: {
      path: deploymentTargetSourceRoots,
    },
  },
  {
    name: "app-web-does-not-import-other-deployment-targets",
    severity: "error",
    comment:
      "Deployment targets should stay independently launchable and must not import one another.",
    from: {
      path: sourceRoot.appWeb,
      pathNot: testFilesPattern,
    },
    to: {
      path: [sourceRoot.appElectrobun, sourceRoot.website],
    },
  },
  {
    name: "app-electrobun-does-not-import-other-deployment-targets",
    severity: "error",
    comment:
      "Deployment targets should stay independently launchable and must not import one another.",
    from: {
      path: sourceRoot.appElectrobun,
      pathNot: testFilesPattern,
    },
    to: {
      path: [sourceRoot.appWeb, sourceRoot.website],
    },
  },
  {
    name: "website-does-not-import-other-deployment-targets",
    severity: "error",
    comment:
      "Deployment targets should stay independently launchable and must not import one another.",
    from: {
      path: sourceRoot.website,
      pathNot: testFilesPattern,
    },
    to: {
      path: [sourceRoot.appElectrobun, sourceRoot.appWeb],
    },
  },
] satisfies ForbiddenRules;

const uiRules = [
  {
    name: "ui-does-not-depend-on-app-or-website",
    severity: "error",
    comment:
      "Shared UI must stay product-shell neutral and must not import deployment target implementation code.",
    from: {
      path: sourceRoot.ui,
      pathNot: testFilesPattern,
    },
    to: {
      path: [sourceRoot.app, sourceRoot.website],
    },
  },
] satisfies ForbiddenRules;

const websiteRules = [
  {
    name: "website-does-not-depend-on-app",
    severity: "error",
    comment:
      "The website may share UI through @tearleads/ui, but it must not import the application implementation package.",
    from: {
      path: sourceRoot.website,
      pathNot: testFilesPattern,
    },
    to: {
      path: sourceRoot.app,
    },
  },
] satisfies ForbiddenRules;

const dependencyCruiserConfig = {
  forbidden: [
    ...standardRules,
    ...apiRules,
    ...apiPackageBoundaryRules,
    ...appRules,
    ...clientSdkRules,
    ...corePackageRules,
    ...uiRules,
    ...websiteRules,
  ],
  options: {
    // Bun workspace subpath exports are checked separately in lintArchitecture.
    // Keep dependency-cruiser focused on source files whose paths it can resolve.
    includeOnly:
      "^packages/(api|api-client|api-cli|api-shared|app|app-electrobun|app-web|bob-and-alice|client-sdk|crypto|encoding|loro|sqlite-instance|sqlite-worker|test-utils|ui|validators|website)/src/",
    tsPreCompilationDeps: "specify",
  },
} satisfies IConfiguration;

export default dependencyCruiserConfig;
