import { afterEach, expect, spyOn, test } from "bun:test";
import { defaultDocumentsPersistence } from "@tearleads/client-sdk";
import { versionVectorsEqual } from "@tearleads/loro";
import { act, waitFor } from "@testing-library/react";
import invariant from "invariant";
import { type ComponentProps, useLayoutEffect, useState } from "react";
import { settleAppTestRuntimeInAct } from "../../../../test/helpers/appRuntimeIdle";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  DUAL_PANE_TEST_TIMEOUT_MS,
  generatePaneKeyPairFromMenu,
  getPaneRoot,
  renderDualPane,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  downloadPaneRecoveryKey,
  restorePaneRecoveryKey,
} from "../../../../test/helpers/dual-pane/dualPaneRecoveryKit";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import { cleanupPaneTestEnvironment } from "../../../../test/helpers/paneTestUtils";
import { waitForPersonalBootstrap } from "../../../../test/helpers/waitForPersonalBootstrap";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../../providers/sdk/useTearleadsSubscription";
import { useSystemBootstrap } from "../../../providers/system-bootstrap/SystemBootstrapProvider";
import { useUserSystemContainers } from "../../../providers/system-bootstrap/UserSystemContainersProvider";
import { loadProjectedContacts } from "../../../stores/contacts/contactProjection";
import { getSelfContactLocalId } from "../../../stores/contacts/contactStore";
import {
  createContactsRuntimeForContainer,
  getOrCreateContactsStoreForRuntime,
} from "../../../stores/contacts/useContactsStoreForContainer";
import { useDeviceFirstContainerContents } from "../../../stores/device-first/DeviceFirstProvider";
import { findExplorerSystemNode } from "../../../stores/explorer/ExplorerSystemContainers";
import { type PaneSide, usePaneSide } from "../dual-pane";
import { PaneProvider } from "../runtime/PaneProvider";

const WAIT_OPTIONS = { timeout: DUAL_PANE_TEST_TIMEOUT_MS };
afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

type Tree = ReturnType<
  typeof useDeviceFirstContainerContents
>["containerStore"];
interface CapturedBootstrap {
  readonly appData: ReturnType<typeof useTearleadsRuntime>;
  readonly bootstrap: ReturnType<typeof useSystemBootstrap>;
  readonly runtimeVersion: number;
  readonly systemContainers: ReturnType<typeof useUserSystemContainers>;
  readonly tearleads: ReturnType<typeof useTearleads>;
  readonly tree: Tree;
  readonly treeSnapshot: ReturnType<Tree["getSnapshot"]>;
}

function findSystemNode(state: CapturedBootstrap, kind: "contacts" | "trash") {
  const spec = state.systemContainers.find((item) => item.kind === kind);
  return spec
    ? findExplorerSystemNode(
        state.treeSnapshot.nodes,
        spec.systemSlot,
        state.appData.auth.organizationId,
        state.appData.state.containerId,
      )
    : null;
}

function createBootstrapProbe() {
  const snapshots = new Map<PaneSide, CapturedBootstrap>();
  let activate: (() => void) | null = null;
  function ReceiverProvider(props: ComponentProps<typeof PaneProvider>) {
    const [enabled, setEnabled] = useState(false);
    useLayoutEffect(() => {
      activate = () => setEnabled(true);
      return () => {
        activate = null;
      };
    }, []);
    return <PaneProvider {...props} autoProvisionEnabled={enabled} />;
  }
  function Probe() {
    const side = usePaneSide();
    const tearleads = useTearleads();
    const appData = useTearleadsRuntime();
    const bootstrap = useSystemBootstrap();
    const systemContainers = useUserSystemContainers();
    const { containerStore: tree } = useDeviceFirstContainerContents();
    const treeSnapshot = useTearleadsExternalStoreSnapshot(tree);
    useLayoutEffect(() => {
      snapshots.set(side, {
        appData,
        bootstrap,
        systemContainers,
        tearleads,
        tree,
        treeSnapshot,
        runtimeVersion: tearleads.runtime.version,
      });
    });
    return null;
  }
  return {
    Probe,
    ReceiverProvider,
    activateReceiver: () => {
      invariant(activate, "Receiver was not mounted");
      activate();
    },
    get: (side: PaneSide) => {
      const value = snapshots.get(side);
      invariant(value, `No committed ${side} bootstrap probe`);
      return value;
    },
  };
}

test(
  "discovery-first Me hydration completes mounted bootstrap without a manual retry",
  async () => {
    const hydration = Promise.withResolvers<void>();
    let heldDocumentId: string | null = null;
    let heldRequests = 0;
    useTestApiAppHandlers({
      holdRequest: (request) => {
        if (
          heldDocumentId &&
          request.method === "POST" &&
          new URL(request.url).pathname === `/documents/${heldDocumentId}/sync`
        ) {
          heldRequests += 1;
          return hydration.promise;
        }
        return undefined;
      },
    });
    const probe = createBootstrapProbe();
    const view = renderDualPane({
      autoProvisionRight: false,
      rightPaneProvider: probe.ReceiverProvider,
      children: <probe.Probe />,
    });
    const primary = getPaneRoot(view, "left");
    const recovered = getPaneRoot(view, "right");
    let restoreObserver = () => {};
    let unsubscribe = () => {};
    try {
      await waitForSinglePaneProvisioning(primary);
      await waitForPersonalBootstrap();
      const source = probe.get("left");
      invariant(
        source.appData.crypto.signingFingerprint,
        "Source has no fingerprint",
      );
      const canonicalId = getSelfContactLocalId(
        source.appData.crypto.signingFingerprint,
      );
      const sourceContainer = findSystemNode(source, "contacts");
      invariant(sourceContainer, "Source Contacts was not provisioned");
      // The database-wide contact list also covers other containers. Assert
      // the personal self projection, not a global count of contact documents.
      const sourceContacts = await loadProjectedContacts(
        source.appData.infra.execSql,
        sourceContainer.id,
      );
      const sourceSelf = sourceContacts.filter((entry) => entry.isSelf);
      expect(sourceSelf.map((entry) => entry.id)).toEqual([canonicalId]);
      expect(sourceSelf[0]?.userId).toBe(source.appData.auth.userId);
      const sourceContact = await defaultDocumentsPersistence.loadDocument(
        source.appData.infra.execSql,
        canonicalId,
      );
      invariant(sourceContact?.documentId, "Source Me was not promoted");
      expect(sourceContact.containerId).toBe(sourceContainer.id);
      const documentId = sourceContact.documentId;
      const recoveryKey = await downloadPaneRecoveryKey(primary);
      heldDocumentId = documentId;
      await generatePaneKeyPairFromMenu(recovered);
      await restorePaneRecoveryKey(recovered, recoveryKey);

      // Inactive workspaces keep DeviceFirst mounted but disable bootstrap.
      // Wait for actual discovery; never fabricate a server response or row.
      await waitFor(async () => {
        const receiver = probe.get("right");
        expect(receiver.bootstrap.status).toBe("idle");
        expect(receiver.appData.auth.isAuthenticated).toBe(true);
        expect(receiver.appData.auth.userId).toBe(source.appData.auth.userId);
        expect(receiver.appData.auth.defaultOrganizationId).toBeTruthy();
        expect(receiver.appData.auth.organizationId).toBe(
          receiver.appData.auth.defaultOrganizationId ?? null,
        );
        expect(receiver.appData.state.containerId).toBeTruthy();
        expect(receiver.treeSnapshot.ready).toBe(true);
        expect(receiver.systemContainers.length).toBeGreaterThan(0);
        for (const spec of receiver.systemContainers) {
          const node = findSystemNode(receiver, spec.kind);
          expect(node).not.toBeNull();
          expect(node?.syncState.status).toBe("synced");
          if (!spec.provisionedAtOrganizationCreation) {
            expect(node?.icon ?? null).toBe(spec.icon);
          }
        }
        const shell = await defaultDocumentsPersistence.loadDocument(
          receiver.appData.infra.execSql,
          documentId,
        );
        expect(shell).toMatchObject({
          id: documentId,
          documentId,
          containerId: findSystemNode(receiver, "contacts")?.id,
        });
        // An opened shell can encode an empty frontier instead of storing "".
        expect(versionVectorsEqual(shell?.snapshotEndVersion, "")).toBe(true);
        expect(
          await defaultDocumentsPersistence.loadDocument(
            receiver.appData.infra.execSql,
            canonicalId,
          ),
        ).toBeNull();
        expect(heldRequests).toBeGreaterThan(0);
      }, WAIT_OPTIONS);

      const receiver = probe.get("right");
      const contactsNode = findSystemNode(receiver, "contacts");
      invariant(contactsNode, "Receiver Contacts was not discovered");
      const runtime = createContactsRuntimeForContainer(
        receiver.tearleads,
        receiver.tearleads.documents.workflowRuntime(contactsNode.id),
      );
      const contacts = getOrCreateContactsStoreForRuntime(
        receiver.tearleads,
        runtime,
      );
      const originalEnsure = contacts.ensureSelfContact.bind(contacts);
      let refusals = 0;
      const observer = spyOn(contacts, "ensureSelfContact").mockImplementation(
        async (input) => {
          const result = await originalEnsure(input);
          if (result === null) refusals += 1;
          return result;
        },
      );
      restoreObserver = () => observer.mockRestore();
      let persistedContacts = 0;
      unsubscribe = receiver.tearleads.documents.subscribe(
        (document) => {
          if (
            document.id === documentId &&
            document.documentKind === "contact" &&
            document.containerId === contactsNode.id
          )
            persistedContacts += 1;
        },
        { containerId: contactsNode.id },
      );
      act(() => probe.activateReceiver());
      await waitFor(() => {
        expect(refusals).toBeGreaterThan(0);
        expect(probe.get("right").bootstrap.status).toBe("waiting");
      }, WAIT_OPTIONS);
      const before = probe.get("right");

      // No explicit ensureBootstrapped, opening mini-apps, network toggle,
      // remount or second activation. Resume the original real HTTP requests.
      hydration.resolve();
      await waitFor(() => {
        expect(persistedContacts).toBeGreaterThan(0);
        expect(
          contacts
            .getSnapshot()
            .entries.some((entry) => entry.id === documentId && entry.isSelf),
        ).toBe(true);
      }, WAIT_OPTIONS);
      expect(
        await settleAppTestRuntimeInAct({
          timeoutMs: DUAL_PANE_TEST_TIMEOUT_MS,
        }),
      ).toBe(true);
      const after = probe.get("right");
      const dependencies = {
        runtime: after.appData === before.appData,
        runtimeVersion: after.runtimeVersion === before.runtimeVersion,
        contactsNode:
          findSystemNode(after, "contacts") ===
          findSystemNode(before, "contacts"),
        systemContainers: after.systemContainers === before.systemContainers,
        sdk: after.tearleads === before.tearleads,
        tree: after.tree === before.tree,
        ensureCallback:
          after.bootstrap.ensureBootstrapped ===
          before.bootstrap.ensureBootstrapped,
      };
      console.info(
        "[discovery-first-bootstrap]",
        JSON.stringify({
          before: before.bootstrap.status,
          after: after.bootstrap.status,
          refusals,
          heldRequests,
          persistedContacts,
          dependencies,
        }),
      );
      expect(Object.values(dependencies).every(Boolean)).toBe(true);
      expect(
        contacts
          .getSnapshot()
          .entries.filter((entry) => entry.isSelf)
          .map((entry) => entry.id),
      ).toEqual([documentId]);
      expect(
        await defaultDocumentsPersistence.loadDocument(
          after.appData.infra.execSql,
          canonicalId,
        ),
      ).toBeNull();
      expect(after.bootstrap.status).toBe("ready");
    } finally {
      heldDocumentId = null;
      hydration.resolve();
      restoreObserver();
      unsubscribe();
    }
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
