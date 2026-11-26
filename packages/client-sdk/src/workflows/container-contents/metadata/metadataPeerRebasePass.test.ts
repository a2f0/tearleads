import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
} from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { withPrincipalPolicies } from "../../../../test/helpers/workflows/principalPolicyServiceFixture";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { RemoteDocumentService } from "../../documents/remote/remoteDocumentService";
import type { DocumentPeerRebaseOutcome } from "../../documents/sync/remoteDocumentSyncPass";
import { createPrincipalPolicyOperation } from "../../principals/principalPolicyService";
import { writeContainerMetadataValue } from "./containerMetadataDocument";
import { syncContainerMetadataState } from "./index";
import {
  createContainerRecord,
  createDocumentRecord,
  enqueuePendingContainerUpdate,
} from "./metadata.testFixtures";
import type { ContainerMetadataState } from "./metadataTypes";

const WRITER_PEER = "11";
const CONTAINER_ID = "container-1";

let execSql: ExecSql;
let close: () => void;

beforeEach(async () => {
  ({ close, execSql } = await createTestExecSql("metadata-peer-rebase-pass"));
  await sqlContainerContentsPersistence.ensureSchema(execSql);
});

afterEach(() => close());

function metadataSyncRuntime() {
  return withPrincipalPolicies({
    apiClient: createMockApiClient({}),
    auth: { deviceId: "device-1", organizationId: "org-1", userId: "user-1" },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: "signing-fingerprint-1",
      signingKeyPair: { signingPrivateKey: new Uint8Array(32) },
    },
    infra: { execSql },
    resolveTrustedUserIdentity: async () => null,
    state: { containerId: null, domainScope: {}, events: [], online: true },
    util: { log: () => undefined, reportSecurityIncident: async () => {} },
  }) as never;
}

test("the metadata pass rebases the live state, never its detached copy", async () => {
  const doc = await createDocument("metadata-writer");
  doc.setPeerId(WRITER_PEER);
  writeContainerMetadataValue(doc, { icon: null, name: "Before" });
  const committedVersion = encodeVersionVector(doc);
  writeContainerMetadataValue(doc, { name: "After" });
  const container = createContainerRecord({
    id: CONTAINER_ID,
    metadataDocumentId: "metadata-document-1",
    parentId: null,
  });
  const record = createDocumentRecord({
    documentId: "metadata-document-1",
    id: CONTAINER_ID,
    metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
  });
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    { ...container, name: "After" },
    record,
  );
  await enqueuePendingContainerUpdate(
    execSql,
    sqlContainerContentsPersistence,
    {
      containerId: CONTAINER_ID,
      update: exportUpdatesSince(doc, committedVersion),
    },
  );
  const metadataState: ContainerMetadataState = { container, doc, record };
  const committed = decodeVersionVector(committedVersion).get(WRITER_PEER) ?? 0;
  // The pass refuses on the peer-owned code and hands its frontiers to the
  // hook; this stands in for that classification.
  let outcome: DocumentPeerRebaseOutcome | undefined;
  const pass = spyOn(
    RemoteDocumentService.prototype,
    "syncRemoteDocument",
  ).mockImplementation(async (request) => {
    outcome = await request.rebaseOntoFreshPeer?.({
      kind: "peer_owned",
      peerFrontiers: [{ committedEndCounter: committed, peerId: WRITER_PEER }],
    });
    return null;
  });
  let reloads = 0;
  try {
    const synced = await syncContainerMetadataState({
      forceReadSync: true,
      isCurrent: () => true,
      metadataState,
      onDurableStateNeedsReload: () => {
        reloads += 1;
      },
      persistence: sqlContainerContentsPersistence,
      policyOperation: createPrincipalPolicyOperation(),
      resolveProjectionUserKey: async () => null,
      runtime: metadataSyncRuntime(),
      targetSecretKey: new Uint8Array(),
    });

    expect(pass).toHaveBeenCalledTimes(1);
    expect(synced).toBeNull();
  } finally {
    pass.mockRestore();
  }
  expect(outcome).toBe("rebased");
  expect(metadataState.doc).not.toBe(doc);
  expect(metadataState.doc.version().get(WRITER_PEER)).toBe(committed);
  expect(reloads).toBe(1);
});
