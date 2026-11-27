import { expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import type {
  ExportedKeyPackage,
  MultiUserDeviceServices,
} from "./multiUserDevice";
import { MultiUserWorld } from "./multiUserWorld";

interface FakeState {
  readonly events: string[];
  readonly pendingDocumentIds: Set<string>;
  readonly epochs: Map<string, number>;
  nextUser: number;
  nextFolder: number;
  nextDoc: number;
}

function createFakeWorldServices(state: FakeState): MultiUserDeviceServices {
  return {
    openLocalDatabase: async () => ({
      client: { exec: async () => ({ rows: [] }) },
      measurements: { calls: 0, durationMs: 0 },
      captureSqlWindow: () => ({
        finish: () => ({
          top: [],
          mutations: 0,
          maxMutationHoldMs: 0,
          maxStatementsPerMutation: 0,
        }),
      }),
      close: () => {
        state.events.push("db.close");
      },
    }),
    waitForIdle: async () => true,
    createSdkHost: (_apiBaseUrl, hostLabel) => {
      const actorPrefix = hostLabel.split("-")[0] ?? "user";
      let userId = "";
      let organizationId = "";
      let containerId = "";
      const nodes: { id: string }[] = [];
      const localDocs = new Map<
        string,
        { containerId: string | null; text: string }
      >();

      const treeStore = {
        updateRuntime: () => undefined,
        getSnapshot: () => ({ ready: true, nodes }),
        refresh: async () => true,
        createChild: async (parentId: string, name: string) => {
          state.nextFolder += 1;
          const id = `folder-${state.nextFolder}`;
          nodes.push({ id });
          state.events.push(`createChild:${parentId}:${name}->${id}`);
          return { id };
        },
        moveContainer: async (folderId: string, newParentId: string) => {
          state.events.push(`move:${folderId}->${newParentId}`);
          return true;
        },
        shareWithGroup: async (folderId: string, groupId: string) => {
          state.events.push(`shareGroup:${folderId}:${groupId}`);
          return true;
        },
        shareWithUser: async (folderId: string, targetUserId: string) => {
          state.events.push(`shareUser:${folderId}:${targetUserId}`);
          return true;
        },
      };

      const sdk = {
        identity: {
          generate: async () => undefined,
          exportKeyPackage: async () =>
            ({
              version: 1,
              userId,
              organizationId,
              containerId,
            }) as unknown as ExportedKeyPackage,
          importKeyPackage: async (pkg: unknown) => {
            const parsed = pkg as {
              userId: string;
              organizationId: string;
              containerId: string;
            };
            userId = parsed.userId;
            organizationId = parsed.organizationId;
            containerId = parsed.containerId;
          },
        },
        session: {
          get userId() {
            return userId;
          },
          get organizationId() {
            return organizationId;
          },
          get containerId() {
            return containerId;
          },
          setOrganizationId: (nextOrgId: string) => {
            organizationId = nextOrgId;
            state.events.push(`enterOrg:${userId}:${nextOrgId}`);
          },
          registerIdentity: async () => {
            state.nextUser += 1;
            userId = `user-${actorPrefix}-${state.nextUser}`;
            organizationId = `org-${actorPrefix}`;
            containerId = `root-${userId}`;
            return { challenge: "ch" };
          },
          login: async () => true,
        },
        userIdentities: {
          createLink: async (origin: string) => `link:${userId}:${origin}`,
          verifyLink: async (link: string) => {
            state.events.push(`verifyLink:${userId}:${link}`);
          },
        },
        organizations: {
          loadDirectoryAndGroups: async () => ({
            memberGroupId: "grp-members",
            groups: [
              { groupId: "grp-admins", name: "Admins", isBuiltin: true },
            ],
          }),
          loadDirectoryAndGroupsAfterMutation: async () => undefined,
          createGroup: async (name: string) => {
            state.events.push(`createGroup:${name}`);
            return { groupId: `grp-${name}` };
          },
          addUserToGroup: async (input: {
            groupId: string;
            targetUserId: string;
          }) => {
            state.events.push(
              `addGroup:${input.groupId}:${input.targetUserId}`,
            );
          },
          removeUserFromGroup: async (input: {
            groupId: string;
            removedUserId: string;
          }) => {
            state.events.push(
              `removeGroup:${input.groupId}:${input.removedUserId}`,
            );
          },
          revokeGrant: async (input: {
            containerId: string;
            subjectId: string;
            subjectType: string;
          }) => {
            state.events.push(
              `revoke:${input.containerId}:${input.subjectType}:${input.subjectId}`,
            );
          },
        },
        containerContents: {
          openTree: () => treeStore,
          workflowRuntime: () => ({
            apiClient: {
              evictContainerWriterProjection: (folderId: string) => {
                state.events.push(`evict:${folderId}`);
              },
            },
          }),
          discoverContainerDocuments: async () => [],
          documentQueries: () => ({
            listPendingWrites: async () =>
              [...state.pendingDocumentIds].map((remoteId) => ({ remoteId })),
          }),
          documentLinks: () => ({
            linkDocumentToContainer: async (input: {
              targetContainerId: string;
            }) => {
              state.events.push(`linkDoc:${input.targetContainerId}`);
              return true;
            },
            unlinkDocumentFromContainer: async (input: {
              removedContainerId: string;
            }) => {
              state.events.push(`unlinkDoc:${input.removedContainerId}`);
              return true;
            },
          }),
          loadContainerInfo: async (input: { containerId: string }) => ({
            remoteInfo: {
              security: {
                currentContainerKeyEpoch: state.epochs.get(input.containerId),
              },
            },
          }),
        },
        documents: {
          open: (input: {
            containerId: string | null;
            localId: string;
            documentId?: string;
          }) => {
            let docId = input.documentId;
            if (!docId) {
              state.nextDoc += 1;
              docId = `doc-${state.nextDoc}`;
            }
            return {
              setText: async (text: string) => {
                localDocs.set(docId, { containerId: input.containerId, text });
                state.events.push(`setText:${docId}:${text}`);
              },
              getSnapshot: () => ({
                documentId: docId,
                text: localDocs.get(docId)?.text ?? "",
              }),
              requestRemoteSyncAndWait: async () => true,
            };
          },
          findLocalIdByDocumentId: async (documentId: string) =>
            localDocs.has(documentId) ? `local-${documentId}` : null,
          list: async () => ({
            rows: [...localDocs.entries()].map(([documentId, entry]) => ({
              id: `local-${documentId}`,
              containerId: entry.containerId,
            })),
          }),
        },
        dispose: () => {
          state.events.push(`sdk.dispose:${userId}`);
        },
      };
      return sdk as unknown as Tearleads;
    },
  };
}

test("MultiUserWorld coordinates org membership, sharing, edits, epochs, and cleanup", async () => {
  const state: FakeState = {
    events: [],
    pendingDocumentIds: new Set(),
    epochs: new Map([["folder-1", 3]]),
    nextUser: 0,
    nextFolder: 0,
    nextDoc: 0,
  };
  const world = new MultiUserWorld(
    "http://127.0.0.1:4001",
    "http://127.0.0.1:4000",
    createFakeWorldServices(state),
  );

  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  // New devices for Bob should inherit Alice's working organization.
  const bobSecond = await world.newDevice(bob);
  expect(bobSecond.organizationId).toBe("org-alice");

  const admins = await world.adminsGroup(alice);
  expect(admins).toEqual({ id: "grp-admins", name: "Admins" });

  const folderId = await world.createFolder(alice, world.rootId(alice), "team");
  const archiveId = await world.createFolder(
    alice,
    world.rootId(alice),
    "archive",
  );
  const doc = await world.createDocument(alice, folderId, "hello");
  await world.editDocument(alice, doc, "updated");
  await world.linkDocument(alice, doc, archiveId);
  expect(doc.containerIds).toEqual([folderId, archiveId]);
  await world.unlinkDocument(alice, doc, archiveId);
  expect(doc.containerIds).toEqual([folderId]);

  const group = await world.createGroup(alice, "Ops");
  await world.addToGroup(alice, group, bob);
  await world.shareWithGroup(alice, folderId, group, "write");
  await world.removeFromGroup(alice, group, bob);
  await world.shareWithUser(alice, folderId, bob, "write", {
    skipLinkAdmit: true,
  });
  await world.revokeGrant(alice, folderId, { kind: "user", id: bob.userId });
  await world.moveFolder(alice, folderId, archiveId);
  expect(await world.keyEpoch(alice, folderId)).toBe(3);

  state.pendingDocumentIds.add(doc.documentId);
  await expect(world.editDocument(alice, doc, "stuck")).rejects.toThrow(
    /did not reach the API/u,
  );
  state.pendingDocumentIds.clear();

  await expect(world.keyEpoch(alice, "missing-folder")).rejects.toThrow(
    /No key epoch/u,
  );

  world.dispose();
  expect(state.events.filter((event) => event === "db.close")).toHaveLength(3);
  expect(
    state.events.filter((event) => event.startsWith("verifyLink:")),
  ).toHaveLength(2);
});
