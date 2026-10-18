import type { IConfiguration } from "dependency-cruiser";
import { packageSourceRoot, testFilePattern } from "./dependencySourceRoots";

const sdkSourceRoot = packageSourceRoot.clientSdk;
const testFiles = testFilePattern.source;
const testSupportFiles = [testFiles, "\\.(testFixtures|testUtils)\\.[tj]sx?$"];

// Directional tiers, lowest first: data -> workflows -> stores -> sync
// (background reconciliation) -> client (the facade and composition root).
const clientSdkLayer = {
  // The Tearleads composition root sits at the package root, beside its barrel.
  client: `${sdkSourceRoot}(client/|Tearleads\\.ts$)`,
  data: `${sdkSourceRoot}data/`,
  dataInternals: [
    `${sdkSourceRoot}data/persistence/`,
    `${sdkSourceRoot}data/sqlite/`,
    `${sdkSourceRoot}data/blobs/`,
    `${sdkSourceRoot}data/contacts/`,
    `${sdkSourceRoot}data/sync/`,
  ],
  principals: `${sdkSourceRoot}workflows/principals/`,
  reconciliation: `${sdkSourceRoot}sync/reconciliation/`,
  stores: `${sdkSourceRoot}stores/`,
  sync: `${sdkSourceRoot}sync/`,
  syncCoordinator: `${sdkSourceRoot}data/sync/(syncC|c)oordinator`,
  workflows: `${sdkSourceRoot}workflows/`,
};

// The modules of workflows/principals the rest of the SDK may import. Its
// index is the public package facade, so the internal surface is listed by
// module rather than re-exported through an index.
const principalsSurface = [
  "acknowledgedPrincipalCurrents",
  "acknowledgedPrincipalPredecessor",
  "currentPrincipalPolicyReader",
  "externalAdminPolicy",
  "index",
  "loadRecoveredPrincipalHistoryPage",
  "policyRepair",
  "policyRepairBudget",
  "policyVerification",
  "principalAcknowledgementChecks",
  "principalCurrentRecoveryBatch",
  "principalPolicyHistoryReader",
  "runtimePolicyRecovery",
  "runtimePolicyWarmer",
  "runtimeProjectionPolicyRecovery",
];

export const clientSdkDependencyRules = [
  {
    name: "client-sdk-does-not-depend-on-app",
    severity: "error",
    comment:
      "The client SDK is the lower-level runtime package and must not import application implementation code.",
    from: {
      path: sdkSourceRoot,
      pathNot: testFiles,
    },
    to: {
      path: packageSourceRoot.app,
    },
  },
  {
    name: "client-sdk-data-does-not-depend-on-upper-layers",
    severity: "error",
    comment:
      "SDK data modules are low-level stores, contracts, and layer-neutral helpers; they must not depend on client, store, reconciliation, or workflow modules.",
    from: {
      path: clientSdkLayer.data,
      pathNot: testFiles,
    },
    to: {
      path: [
        clientSdkLayer.client,
        clientSdkLayer.stores,
        clientSdkLayer.sync,
        clientSdkLayer.workflows,
      ],
    },
  },
  {
    name: "client-sdk-workflows-do-not-depend-on-stores-or-client-facade",
    severity: "error",
    comment:
      "SDK workflows own domain orchestration below stores, background reconciliation, and the high-level client facade.",
    from: {
      path: clientSdkLayer.workflows,
      pathNot: testFiles,
    },
    to: {
      path: [clientSdkLayer.client, clientSdkLayer.stores, clientSdkLayer.sync],
    },
  },
  {
    name: "client-sdk-stores-use-workflow-facades-not-data-internals",
    severity: "error",
    comment:
      "SDK stores should compose public workflow facades instead of importing low-level persistence, SQLite, blob, contact, or sync internals directly.",
    from: {
      path: clientSdkLayer.stores,
      pathNot: testFiles,
    },
    to: {
      path: clientSdkLayer.dataInternals,
    },
  },
  {
    name: "client-sdk-stores-sit-below-reconciliation-and-client",
    severity: "error",
    comment:
      "SDK stores are headless state that background reconciliation (sync/) and the client facade compose; a store must not reach back up into either.",
    from: {
      path: clientSdkLayer.stores,
      pathNot: testFiles,
    },
    to: {
      path: [clientSdkLayer.client, clientSdkLayer.sync],
    },
  },
  {
    name: "client-sdk-reconciliation-is-entered-through-its-index",
    severity: "error",
    comment:
      "Code outside sync/reconciliation uses it only through its index, so the reconciler's internals can change without touching its callers.",
    from: {
      path: sdkSourceRoot,
      pathNot: [testFiles, clientSdkLayer.reconciliation],
    },
    to: {
      path: clientSdkLayer.reconciliation,
      pathNot: `${clientSdkLayer.reconciliation}index\\.ts$`,
    },
  },
  {
    name: "client-sdk-principals-is-used-through-its-surface",
    severity: "error",
    comment:
      "Code outside workflows/principals imports only the modules in principalsSurface, so recovery's verification context, history selection, and stored stage and prefix formats stay private to it.",
    from: {
      path: sdkSourceRoot,
      pathNot: [...testSupportFiles, clientSdkLayer.principals],
    },
    to: {
      path: clientSdkLayer.principals,
      pathNot: `${clientSdkLayer.principals}(${principalsSurface.join("|")})\\.ts$`,
    },
  },
  {
    name: "client-sdk-reconciliation-gets-runtime-from-its-host",
    severity: "error",
    comment:
      "The reconciler receives its sync lane, clock, and every store or workflow operation through ReconciliationHost. It may import their types, but no client, store, workflow, or sync coordinator code.",
    from: {
      path: clientSdkLayer.reconciliation,
      pathNot: testSupportFiles,
    },
    to: {
      path: [
        clientSdkLayer.client,
        clientSdkLayer.stores,
        clientSdkLayer.syncCoordinator,
        clientSdkLayer.workflows,
      ],
      dependencyTypesNot: ["type-only"],
    },
  },
] satisfies NonNullable<IConfiguration["forbidden"]>;
