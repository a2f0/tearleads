import { expect, test } from "bun:test";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope, type DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { requireTrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import { createContainerContentsStoreTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsStoreRuntime,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";

function createRuntime(input: {
  domainScope: DomainScope;
  online: boolean;
  resolveTrustedUserIdentity: ContainerContentsWorkflowRuntime["resolveTrustedUserIdentity"];
}): ReturnType<typeof createContainerContentsStoreTestRuntime> {
  return createContainerContentsStoreTestRuntime({
    apiClient: {} as Parameters<
      typeof createContainerContentsStoreTestRuntime
    >[0]["apiClient"],
    auth: {
      isAuthenticated: true,
      organizationId: "org-1",
      userId: "user-1",
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: "signing-fingerprint-1",
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: "idle",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: (async () => []) as ExecSql,
    },
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    state: {
      containerId: null,
      domainScope: input.domainScope,
      events: [],
      online: input.online,
    },
    util: {
      log: () => {},
    },
  });
}

test("container contents projection cache rotates only with its trust context", async () => {
  const peerUserId = "11111111-1111-4111-8111-111111111111";
  let identityLoads = 0;
  const sourceResolver = async (userId: string) => {
    identityLoads += 1;
    return createTestTrustedUserIdentity({
      encapsulationPublicKey: Uint8Array.from([1, 2, 3]),
      signingKeyFingerprint: "peer-signing-fingerprint",
      signingPublicKey: Uint8Array.from([4, 5, 6]),
      userId,
    });
  };
  const stableResolver = requireTrustedUserIdentityResolver(sourceResolver);
  const firstScope = createDomainScope();
  const initialRuntime = createRuntime({
    domainScope: firstScope,
    online: false,
    resolveTrustedUserIdentity: stableResolver,
  });
  const state = createContainerContentsStoreState(
    initialRuntime,
    defaultContainerContentsPersistence,
  );
  const unusedSyncAgent = {} as ContainerContentsStoreSyncAgent;

  const initialProjectionResolver = state.resolveProjectionUserKey;
  await state.resolveProjectionUserKey(peerUserId);
  await state.resolveProjectionUserKey(peerUserId);
  expect(identityLoads).toBe(1);

  const onlineRuntime = createRuntime({
    domainScope: firstScope,
    online: true,
    resolveTrustedUserIdentity: stableResolver,
  });
  expect(onlineRuntime.resolveTrustedUserIdentity).toBe(
    initialRuntime.resolveTrustedUserIdentity,
  );

  updateContainerContentsStoreRuntime(state, onlineRuntime, unusedSyncAgent);
  expect(state.resolveProjectionUserKey).toBe(initialProjectionResolver);
  await state.resolveProjectionUserKey(peerUserId);
  expect(identityLoads).toBe(1);

  const rotatedRuntime = createRuntime({
    domainScope: createDomainScope(),
    online: true,
    resolveTrustedUserIdentity: stableResolver,
  });
  expect(rotatedRuntime.resolveTrustedUserIdentity).toBe(
    initialRuntime.resolveTrustedUserIdentity,
  );

  updateContainerContentsStoreRuntime(state, rotatedRuntime, unusedSyncAgent);
  expect(state.resolveProjectionUserKey).not.toBe(initialProjectionResolver);
  await state.resolveProjectionUserKey(peerUserId);
  expect(identityLoads).toBe(2);
});
