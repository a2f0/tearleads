import type { IConfiguration } from "dependency-cruiser";
import {
  baselinedFilePatterns,
  type ClientSdkTestTierBaseline,
} from "./clientSdkTestTierBaseline";
import testTierBaselineJson from "./clientSdkTestTierBaseline.json";
import { packageSourceRoot, testFilePattern } from "./dependencySourceRoots";

type ForbiddenRule = NonNullable<IConfiguration["forbidden"]>[number];

const sdkSourceRoot = packageSourceRoot.clientSdk;
const sdkHelperRoot = sdkSourceRoot.replace(/src\/$/, "test/helpers/");
const testFiles = testFilePattern.source;
const testSupportFiles = [testFiles, "\\.(testFixtures|testUtils)\\.[tj]sx?$"];
const testTierBaseline: ClientSdkTestTierBaseline = testTierBaselineJson;

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
  reconciliation: `${sdkSourceRoot}sync/reconciliation/`,
  stores: `${sdkSourceRoot}stores/`,
  sync: `${sdkSourceRoot}sync/`,
  syncCoordinator: `${sdkSourceRoot}data/sync/(syncC|c)oordinator`,
  workflows: `${sdkSourceRoot}workflows/`,
};

// Test helpers sort into folders by the highest tier they load at run time.
const sdkHelperTier = {
  data: `${sdkHelperRoot}data/`,
  workflows: `${sdkHelperRoot}workflows/`,
};

function testTierRule(input: {
  readonly name: string;
  readonly comment: string;
  readonly from: string;
  readonly allowed: string[];
}) {
  const exempt = baselinedFilePatterns(testTierBaseline, input.name);
  return {
    name: input.name,
    severity: "error",
    comment: input.comment,
    from:
      exempt.length > 0
        ? { path: input.from, pathNot: exempt }
        : { path: input.from },
    to: {
      path: [sdkSourceRoot, sdkHelperRoot],
      pathNot: input.allowed,
      dependencyTypesNot: ["type-only"],
    },
  } satisfies ForbiddenRule & { readonly from: { readonly path: string } };
}

const dataTierModules = [clientSdkLayer.data, sdkHelperTier.data];
const workflowTierModules = [
  ...dataTierModules,
  clientSdkLayer.workflows,
  sdkHelperTier.workflows,
];

// A test loads only its own tier and the tiers below it, through source or
// helpers, so a change above that tier never reruns it. Each rule binds a
// tier's modules, tests, and test support, and the helpers of that tier, by
// induction over runtime imports; type-only imports stay allowed.
// clientSdkTestTierBaseline.json lists the files still exempt.
export const clientSdkTestTierRules = [
  testTierRule({
    name: "client-sdk-data-tests-load-only-the-data-tier",
    comment:
      "src/data tests and test support load only src/data and test/helpers/data at run time; a test that needs a workflow belongs beside that workflow.",
    from: clientSdkLayer.data,
    allowed: dataTierModules,
  }),
  testTierRule({
    name: "client-sdk-data-test-helpers-load-only-the-data-tier",
    comment:
      "test/helpers/data loads only src/data and other data helpers at run time; a helper that needs more sorts into a higher helper tier.",
    from: sdkHelperTier.data,
    allowed: dataTierModules,
  }),
  testTierRule({
    name: "client-sdk-workflow-tests-load-only-data-and-workflows",
    comment:
      "src/workflows tests and test support load only the data and workflow tiers and their helpers at run time.",
    from: clientSdkLayer.workflows,
    allowed: workflowTierModules,
  }),
  testTierRule({
    name: "client-sdk-workflow-test-helpers-load-only-data-and-workflows",
    comment:
      "test/helpers/workflows loads only the data and workflow tiers and their helpers at run time.",
    from: sdkHelperTier.workflows,
    allowed: workflowTierModules,
  }),
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
  ...clientSdkTestTierRules,
] satisfies NonNullable<IConfiguration["forbidden"]>;
