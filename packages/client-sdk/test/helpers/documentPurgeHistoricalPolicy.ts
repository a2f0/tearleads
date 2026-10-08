import {
  computeAccessEventBodyHash,
  computeAccessEventHash,
  signAccessEvent,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  type VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import {
  createContainerManifestFixture,
  createDocumentLinkSetManifestFixture,
  createVerifiedDocumentAccessEvent,
} from "@tearleads/crypto/test-fixtures";
import type {
  AccessManifestBundleWireResponse,
  DocumentPurgeProofResponse,
} from "@tearleads/validators/response";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";
import { createExternallyAuthorizedPrincipalPolicySnapshots } from "./principalPolicySnapshots";
import { createProjectionPolicyEvidence } from "./projectionPolicyEvidence";
import { projectionPolicyWarmer } from "./projectionPolicyHistory";

type Policies = Awaited<
  ReturnType<typeof createExternallyAuthorizedPrincipalPolicySnapshots>
>;

function wire(
  value: VerifiedContainerAccessManifest | VerifiedDocumentLinkSetManifest,
): AccessManifestBundleWireResponse {
  return structuredClone(value) as unknown as AccessManifestBundleWireResponse;
}

async function documentHistory(
  policies: Policies,
  containers: readonly VerifiedContainerAccessManifest[],
  organizationId: string,
) {
  const [home, oldGroup, later] = containers;
  if (!home || !oldGroup || !later)
    throw new Error("Missing fixture containers");
  const history: VerifiedDocumentLinkSetManifest[] = [];
  let linked: VerifiedContainerAccessManifest[] = [];
  for (const [operation, target] of [
    ["link", home],
    ["link", oldGroup],
    ["unlink", oldGroup],
    ["link", later],
    ["unlink", later],
  ] as const) {
    const previousManifestHash = history.at(-1)?.manifestHash ?? null;
    const event = await createVerifiedDocumentAccessEvent({
      body: {
        eventType: operation === "link" ? "document.link" : "document.unlink",
        blobRewraps: [],
        containerId: target.state.containerId,
        containerManifestHash: target.manifestHash,
      },
      dependencyManifestHashes: [
        ...new Set([...linked, target].map((value) => value.manifestHash)),
      ],
      objectId: "historical-policy-document",
      organizationId,
      previousManifestHash,
      signer: policies.signingKeyPair,
      signerUserId: policies.signerUserId,
    });
    linked =
      operation === "link"
        ? [...linked, target]
        : linked.filter((value) => value !== target);
    history.push(
      await createDocumentLinkSetManifestFixture({
        documentId: "historical-policy-document",
        event,
        linkedContainerIds: linked.map((value) => value.state.containerId),
        organizationId,
        previousManifestHash,
        epoch: history.length + 1,
      }),
    );
  }
  return history;
}

async function purgeEvent(
  policies: Policies,
  home: VerifiedContainerAccessManifest,
  head: VerifiedDocumentLinkSetManifest,
): Promise<DocumentPurgeProofResponse["purgeEvent"]> {
  const body = {
    eventType: "document.purge",
    authorizingContainerManifestHashes: [home.manifestHash],
    containerId: home.state.containerId,
    containerManifestHash: home.manifestHash,
    documentManifestHash: head.manifestHash,
  };
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: "document.purge",
      objectKind: "document",
      objectId: head.state.documentId,
      organizationId: head.state.organizationId,
      previousManifestHash: head.manifestHash,
      dependencyManifestHashes: [home.manifestHash],
      bodyHash: await computeAccessEventBodyHash(body),
      signerUserId: policies.signerUserId,
      signerDeviceId: "device-1",
      signerKeyFingerprint: await toFingerprint(
        policies.signingKeyPair.signingPublicKey,
      ),
      signedAt: "2026-09-28T00:00:00.000Z",
    },
    policies.signingKeyPair.signingPrivateKey,
  );
  return {
    body,
    event: { ...event },
    eventHash: await computeAccessEventHash(event),
  };
}

export async function createHistoricalPolicyPurgeFixture(
  newerAdmins = false,
  organizationId = "organization-1",
) {
  const policies = await createExternallyAuthorizedPrincipalPolicySnapshots();
  const head = principalPolicyHead(policies.subjectBundle);
  if (head.principalType !== "group") throw new Error("Expected group policy");
  const groupHead = { ...head, principalType: "group" as const };
  const containers = await Promise.all(
    ["home", "old-group", "later"].map((containerId) =>
      createContainerManifestFixture({
        containerId,
        organizationId,
        signer: policies.signingKeyPair,
        signerUserId: policies.signerUserId,
        directGrants: [
          ...(containerId === "old-group"
            ? [
                {
                  subjectType: "group" as const,
                  subjectId: policies.subject.currentState.principalId,
                  accessLevel: "read" as const,
                },
              ]
            : []),
          {
            subjectType: "user",
            subjectId: policies.signerUserId,
            accessLevel: "admin",
          },
        ],
        referencedPrincipalHeads:
          containerId === "old-group" ? [groupHead] : [],
      }),
    ),
  );
  const history = await documentHistory(policies, containers, organizationId);
  const home = containers[0];
  const documentHead = history.at(-1);
  if (!home || !documentHead) throw new Error("Missing purge fixture head");
  const initialAdmins = policies.adminBundle;
  const admins = newerAdmins
    ? await signedPrincipalPolicyBundle({
        signing: {
          ...initialAdmins.currentState,
          version: 2,
          prevStateHash: initialAdmins.currentState.stateHash,
          signedAt: "2026-09-27T00:00:00.000Z",
          grants: initialAdmins.currentGrants,
        },
        signingPrivateKey: policies.signingKeyPair.signingPrivateKey,
        payloadCiphertext: initialAdmins.currentPayload.ciphertext,
        memberEnvelopes: initialAdmins.currentMemberEnvelopes.envelopes,
        projection: initialAdmins.currentProjection,
        previousStates: [
          {
            state: initialAdmins.currentState,
            projection: initialAdmins.currentProjection,
            grants: initialAdmins.currentGrants,
          },
        ],
      })
    : initialAdmins;
  const evidence = await createProjectionPolicyEvidence({
    author: {
      organizationId,
      signerUserId: policies.signerUserId,
      signerDeviceId: "device-1",
      signerKeyFingerprint: await toFingerprint(
        policies.signingKeyPair.signingPublicKey,
      ),
      signerPrivateKey: policies.signingKeyPair.signingPrivateKey,
    },
    group: policies.subjectBundle,
    admins,
    signingPublicKey: policies.signingKeyPair.signingPublicKey,
    encapsulationKeyPair: policies.encapsulationKeyPair,
  });
  const proof: DocumentPurgeProofResponse = {
    authorizingContainerPath: [wire(home)],
    documentContainerManifestHistory: [],
    documentId: documentHead.state.documentId,
    documentManifest: wire(documentHead),
    documentManifestContainerPaths: containers.map((value) => [wire(value)]),
    documentManifestPredecessors: history.slice(0, -1).reverse().map(wire),
    policyEvidence: evidence.policyEvidence,
    purgeEvent: await purgeEvent(policies, home, documentHead),
    purgedAt: "2026-09-28T00:00:00.000Z",
  };
  return {
    proof,
    bundles: evidence.bundles,
    signingPrivateKey: policies.signingKeyPair.signingPrivateKey,
    resolveUserKey: policies.resolveUserKey,
    warmer: (execSql: ExecSql) =>
      projectionPolicyWarmer({
        execSql,
        bundles: evidence.bundles,
        resolveUserKey: policies.resolveUserKey,
      }),
  };
}
