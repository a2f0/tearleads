import { afterEach, expect, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  getRosterProfileDocumentLocalId,
} from "@tearleads/client-sdk";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  importSnapshot,
  importUpdates,
  satisfiesVersionVector,
} from "@tearleads/loro";
import { act, waitFor } from "@testing-library/react";
import invariant from "invariant";
import { type ComponentProps, useLayoutEffect } from "react";
import { settleAppTestRuntimeInAct } from "../../../../test/helpers/appRuntimeIdle";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  DUAL_PANE_TEST_TIMEOUT_MS,
  getPaneRoot,
  renderDualPane,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  listProxiedApiRequests,
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import { cleanupPaneTestEnvironment } from "../../../../test/helpers/paneTestUtils";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";
import {
  canMoveDocumentToContainerByRules,
  createExplorerContainerRulesContext,
} from "../../../mini-apps/explorer/model/containerRules";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { useUserSystemContainers } from "../../../providers/system-bootstrap/UserSystemContainersProvider";
import { getSelfContactLocalId } from "../../../stores/contacts/contactStore";
import { loadCurrentSelfContactIdentity } from "../../../stores/contacts/currentSelfContactIdentity";
import {
  createContactsRuntimeForContainer,
  getOrCreateContactsStoreForRuntime,
} from "../../../stores/contacts/useContactsStoreForContainer";
import { useDeviceFirstContainerContents } from "../../../stores/device-first/DeviceFirstProvider";
import { deriveBuiltInSystemContainers } from "../../../stores/systemContainers";
import { usePaneSide } from "../dual-pane";
import { PaneProvider } from "../runtime/PaneProvider";

const WAIT_OPTIONS = { timeout: DUAL_PANE_TEST_TIMEOUT_MS };
afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

function InactiveRightPane(props: ComponentProps<typeof PaneProvider>) {
  return <PaneProvider {...props} autoProvisionEnabled={false} />;
}

function captureRegisteredPane() {
  type State = {
    appData: ReturnType<typeof useTearleadsRuntime>;
    sdk: ReturnType<typeof useTearleads>;
    systemContainers: ReturnType<typeof useUserSystemContainers>;
    tree: ReturnType<typeof useDeviceFirstContainerContents>["containerStore"];
  };
  let latest: State | null = null;
  function Probe() {
    const side = usePaneSide();
    const sdk = useTearleads();
    const appData = useTearleadsRuntime();
    const systemContainers = useUserSystemContainers();
    const { containerStore: tree } = useDeviceFirstContainerContents();
    useLayoutEffect(() => {
      if (side === "left") latest = { appData, sdk, systemContainers, tree };
    });
    return null;
  }
  return {
    Probe,
    get: () => {
      invariant(latest, "Registered pane was not captured");
      return latest;
    },
  };
}

async function prepareRegisteredContacts() {
  const probe = captureRegisteredPane();
  const view = renderDualPane({
    autoProvisionRight: false,
    rightPaneProvider: InactiveRightPane,
    children: <probe.Probe />,
  });
  await waitForSinglePaneProvisioning(getPaneRoot(view, "left"));
  await waitForPersonalBootstrap();
  const { appData, sdk, systemContainers, tree } = probe.get();
  const { organizationId, userId } = appData.auth;
  const fingerprint = appData.crypto.signingFingerprint;
  invariant(
    organizationId && userId && fingerprint,
    "Missing registered identity",
  );
  const selfId = getSelfContactLocalId(fingerprint);
  const profileId = getRosterProfileDocumentLocalId({ organizationId, userId });
  const self = await sdk.containerContents
    .documentQueries()
    .loadDocumentSummary(selfId);
  const profile = await sdk.containerContents
    .documentQueries()
    .loadDocumentSummary(profileId);
  invariant(
    self?.documentId && self.containerId,
    "Personal Me was not promoted",
  );
  invariant(
    profile?.documentId && profile.containerId,
    "Registration profile is missing",
  );
  expect(profile.documentId).not.toBe(self.documentId);
  const profileStore = sdk.documents.open({
    containerId: profile.containerId,
    documentId: profile.documentId,
    localId: profile.id,
  });
  expect(await profileStore.ensureInitialized()).toBe(true);
  expect(await profileStore.requestRemoteSyncAndWait()).toBe(true);
  expect(profileStore.getSnapshot().structuredFields).toMatchObject({
    isSelf: "1",
    userId,
  });
  const runtime = createContactsRuntimeForContainer(
    sdk,
    sdk.documents.workflowRuntime(self.containerId),
  );
  invariant(
    runtime.documents.apiClient.getDocumentWriterProjectionResult,
    "Missing real writer projection API",
  );
  expect(
    await runtime.documents.apiClient.getDocumentWriterProjectionResult(
      self.documentId,
      { reportErrors: false },
    ),
  ).toMatchObject({ ok: true, data: { documentId: self.documentId } });
  const contacts = getOrCreateContactsStoreForRuntime(sdk, runtime);
  expect(contacts.getSnapshot().entries.map((entry) => entry.id)).toEqual([
    selfId,
  ]);
  expect(contacts.getSnapshot().entries[0]).toMatchObject({
    firstName: "",
    lastName: "",
    isSelf: true,
    userId,
  });
  const builtInSystemContainers = await deriveBuiltInSystemContainers({
    organizationId,
  });
  const identityVersion = sdk.runtime.version;
  const selfContactIdentity = await loadCurrentSelfContactIdentity(
    appData.infra.execSql,
    fingerprint,
  );
  expect(selfContactIdentity.documentId).toBe(self.documentId);
  const rules = createExplorerContainerRulesContext({
    builtInSystemContainers,
    contactsContainerId: self.containerId,
    contactsSystemSlot:
      systemContainers.find((item) => item.kind === "contacts")?.systemSlot ??
      null,
    currentOrganizationId: organizationId,
    selfContactIdentity: {
      status: "ready",
      identity: selfContactIdentity,
      isCurrent: () => sdk.runtime.version === identityVersion,
    },
    trashSystemSlot:
      systemContainers.find((item) => item.kind === "trash")?.systemSlot ??
      null,
  });
  const nodes = tree.getSnapshot().nodes;
  // The visible-built-ins rule set admits this move; no fabricated IDs or
  // summaries bypass the current Explorer policy or registration producer.
  expect(
    canMoveDocumentToContainerByRules(
      rules,
      nodes.find((node) => node.id === profile.containerId),
      nodes.find((node) => node.id === self.containerId),
      profile,
    ),
  ).toBe(true);
  expect(
    await settleAppTestRuntimeInAct({ timeoutMs: DUAL_PANE_TEST_TIMEOUT_MS }),
  ).toBe(true);
  return {
    appData,
    contacts,
    contactsContainerId: self.containerId,
    profile,
    sdk,
    self,
    selfId,
    userId,
  };
}

type RegisteredContacts = Awaited<ReturnType<typeof prepareRegisteredContacts>>;

function listDocumentPurges() {
  return listProxiedApiRequests()
    .filter((request) => {
      const path = new URL(request.url).pathname;
      return path.startsWith("/documents/") && path.endsWith("/purge");
    })
    .map((request) => ({ method: request.method, status: request.status }));
}

interface HistoryIdentity {
  readonly endVersion: string;
  readonly operations: string | null;
}

async function readHistories(
  f: RegisteredContacts,
  baseline?: ReadonlyArray<HistoryIdentity | null>,
): Promise<Array<HistoryIdentity | null>> {
  return Promise.all(
    [f.self.id, f.profile.id].map(async (id, index) => {
      const history = await defaultDocumentsPersistence.loadHistoryRestoreState(
        f.appData.infra.execSql,
        id,
      );
      if (!history) return null;
      const document = await createDocument(`roster-history-observer-${id}`);
      try {
        importSnapshot(document, base64ToBytes(history.snapshot));
        importUpdates(
          document,
          history.tailUpdates.map((tail) => base64ToBytes(tail.updateData)),
        );
        const version = encodeVersionVector(document);
        const endVersion = baseline?.[index]?.endVersion ?? version;
        return {
          endVersion,
          operations: satisfiesVersionVector(version, endVersion)
            ? exportFullHistoryIdentity(document, endVersion)
            : null,
        };
      } finally {
        document.free();
      }
    }),
  );
}

async function moveRosterIntoContacts(f: RegisteredContacts) {
  await f.sdk.containerContents.documentLinks().moveDocumentToContainer({
    expandNode: () => undefined,
    mergeDocumentSummary: () => undefined,
    note: f.profile,
    setLinkedContainerIdsForDocument: () => undefined,
    sourceContainerId: f.profile.containerId,
    targetContainerId: f.contactsContainerId,
  });
  // A stale-return refusal is not rollback: observe the durable placement.
  expect(
    await f.sdk.containerContents
      .documentQueries()
      .loadDocumentSummary(f.profile.id),
  ).toMatchObject({ containerId: f.contactsContainerId });
  await waitFor(
    () =>
      expect(
        f.contacts
          .getSnapshot()
          .entries.some((entry) => entry.id === f.profile.id),
      ).toBe(true),
    WAIT_OPTIONS,
  );
  // Join the normal self write queue after the real placement publication.
  // Observe the selected document, not an obsolete cleanup scheduler.
  expect(
    await f.contacts.ensureSelfContact({
      localId: f.selfId,
      userId: f.userId,
      deferRemoteSync: true,
    }),
  ).toBe(f.selfId);
}

test(
  "an unaccepted roster-profile move cannot retire personal Me",
  async () => {
    const release = Promise.withResolvers<void>();
    let profileDocumentId: string | null = null;
    let heldRequests = 0;
    useTestApiAppHandlers({
      holdRequest: (request) => {
        const path = new URL(request.url).pathname;
        if (
          profileDocumentId &&
          request.method === "POST" &&
          [
            `/documents/${profileDocumentId}/link`,
            `/documents/${profileDocumentId}/unlink`,
          ].includes(path)
        ) {
          heldRequests += 1;
          return release.promise;
        }
        return undefined;
      },
    });
    try {
      const f = await prepareRegisteredContacts();
      const histories = await readHistories(f);
      expect(histories.every((history) => history !== null)).toBe(true);
      profileDocumentId = f.profile.documentId;
      await act(async () => moveRosterIntoContacts(f));
      const beforeRefusal = {
        purges: listDocumentPurges(),
        histories: await readHistories(f, histories),
      };
      console.info("[roster-move-before-refusal]", {
        purges: beforeRefusal.purges,
        historiesPresent: beforeRefusal.histories.map(
          (history) => history !== null,
        ),
      });
      // Exercise normal replay of the durable intent even if the original
      // move returned null after committing its optimistic placement.
      f.sdk.containerContents.openTree().requestSync();
      await waitFor(
        () => expect(heldRequests).toBeGreaterThan(0),
        WAIT_OPTIONS,
      );
      release.resolve();
      await waitFor(
        () =>
          expect(
            listProxiedApiRequests().some(
              (request) =>
                request.method === "POST" &&
                request.status === 409 &&
                new URL(request.url).pathname ===
                  `/documents/${profileDocumentId}/link`,
            ),
          ).toBe(true),
        WAIT_OPTIONS,
      );
      expect(
        await settleAppTestRuntimeInAct({
          timeoutMs: DUAL_PANE_TEST_TIMEOUT_MS,
        }),
      ).toBe(true);
      // Require every pre-move operation even if checkpoint encoding changes.
      expect({
        beforeRefusal,
        afterRefusal: {
          purges: listDocumentPurges(),
          histories: await readHistories(f, histories),
        },
      }).toEqual({
        beforeRefusal: { purges: [], histories },
        afterRefusal: { purges: [], histories },
      });
    } finally {
      profileDocumentId = null;
      release.resolve();
    }
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
