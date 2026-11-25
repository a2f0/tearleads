import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import {
  purgeAndRecover,
  purgeOrganization,
  replacePurgedOrganization,
  reservationsOf,
  storedContainerOrganization,
  storedDocumentOrganization,
} from "../../../test/helpers/purgedOrganizationRecovery";
import { routeApp } from "../../routeApp";
import { runStartOrganizationTrialWorkflow } from "../../workflows/billing/organizationBilling";

test("the owner's recovery consumes its reservations, and the head guards the ids after", async () => {
  const mallory = createTestUser();
  await registerAndAuthenticateUsers(mallory);
  const malloryRoot = await bootstrapRoot(mallory);
  let reservedBeforeRecovery: string[] = [];
  await purgeAndRecover(
    async ({ documentId, folderId }) => {
      reservedBeforeRecovery = await reservationsOf([folderId, documentId]);
    },
    async (recovery) => {
      const { documentId, folderId, owner, purgedOrganizationId } = recovery;
      // The folder, its metadata document (named after it), and the document.
      expect(reservedBeforeRecovery).toEqual(
        [
          `container:${folderId} ${owner.userId} ${purgedOrganizationId}`,
          `document:${folderId} ${owner.userId} ${purgedOrganizationId}`,
          `document:${documentId} ${owner.userId} ${purgedOrganizationId}`,
        ].sort(),
      );

      expect(await recovery.device.recreateFolder()).not.toBeNull();
      expect(await reservationsOf([folderId, documentId])).toEqual([
        `document:${documentId} ${owner.userId} ${purgedOrganizationId}`,
      ]);
      expect((await recovery.device.attempt())?.documentId).toBe(documentId);
      expect(await reservationsOf([folderId, documentId])).toEqual([]);

      const squat = await routeApp.request("/documents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mallory.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          await createDocumentRequest({
            documentId,
            owner: mallory,
            root: malloryRoot,
          }),
        ),
      });
      expect(squat.status).toBe(409);
      expect(await squat.json()).toEqual({
        code: "document_manifest_already_exists",
        error: "Document manifest already exists",
      });
      expect(await storedDocumentOrganization(documentId)).toBe(
        recovery.organization.organizationId,
      );
    },
  );
}, 180_000);

test("another owner device adopts what the first device recovered", async () => {
  await purgeAndRecover(
    async () => undefined,
    async (recovery) => {
      expect(await recovery.device.recreateFolder()).not.toBeNull();
      expect((await recovery.device.attempt())?.documentId).toBe(
        recovery.documentId,
      );

      // A second device still holds the same document under the same recovery
      // id; the create conflict is the adoptable one, and adoption succeeds.
      const second = await recovery.openDevice(recovery.organization);
      expect((await second.attempt())?.documentId).toBe(recovery.documentId);
      const lines = recovery.responses.filter(
        (line) =>
          line.startsWith("POST /documents ") ||
          line.startsWith(`GET /documents/${recovery.documentId}/`),
      );
      expect(lines[0]).toBe(
        `POST /documents 409 {"code":"document_manifest_already_exists","error":"Document manifest already exists"}`,
      );
      expect(lines[1]).toStartWith(
        `GET /documents/${recovery.documentId}/writer-projection 200 `,
      );
      expect(second.terminalFailures).toEqual([]);
      expect(await storedDocumentOrganization(recovery.documentId)).toBe(
        recovery.organization.organizationId,
      );
    },
  );
}, 180_000);

test("a purge of the replacement keeps unrecovered ids reserved and reserves recovered ones again", async () => {
  await purgeAndRecover(
    async () => undefined,
    async (recovery) => {
      const { documentId, folderId, owner, purgedOrganizationId } = recovery;
      // Only the folder comes back before the replacement lapses too.
      expect(await recovery.device.recreateFolder()).not.toBeNull();
      const firstReplacement = recovery.organization.organizationId;
      await purgeOrganization(firstReplacement);
      expect(await reservationsOf([folderId, documentId])).toEqual(
        [
          `container:${folderId} ${owner.userId} ${firstReplacement}`,
          `document:${folderId} ${owner.userId} ${firstReplacement}`,
          `document:${documentId} ${owner.userId} ${purgedOrganizationId}`,
        ].sort(),
      );

      const secondReplacement = await replacePurgedOrganization(
        owner,
        firstReplacement,
      );
      const device = await recovery.openDevice(secondReplacement);
      expect(await device.recreateFolder()).not.toBeNull();
      expect((await device.attempt())?.documentId).toBe(documentId);
      expect(await storedContainerOrganization(folderId)).toBe(
        secondReplacement.organizationId,
      );
      expect(await storedDocumentOrganization(documentId)).toBe(
        secondReplacement.organizationId,
      );
      expect(await reservationsOf([folderId, documentId])).toEqual([]);
    },
  );
}, 240_000);

test("a shared organization's purge reserves nothing", async () => {
  const founder = createTestUser();
  await registerAndAuthenticateUsers(founder);
  const request = await createOrganizationRequestBody(founder);
  expect((await submitCreateOrganization(founder, request)).status).toBe(200);
  await runStartOrganizationTrialWorkflow(
    db,
    request.organizationId,
    founder.userId,
  );
  await purgeOrganization(request.organizationId);
  expect(await storedContainerOrganization(request.rootContainerId)).toBeNull();
  expect(await reservationsOf([request.rootContainerId])).toEqual([]);
}, 60_000);

test("a personal organization's purge reserves its root for the owner", async () => {
  const owner = createTestUser();
  await registerAndAuthenticateUsers(owner);
  const root = await bootstrapRoot(owner);
  const { organizationId, containerId } = asVerifiedContainerManifest(
    root.bundle,
  ).state;
  await purgeOrganization(organizationId);
  expect(await reservationsOf([containerId])).toEqual([
    `container:${containerId} ${owner.userId} ${organizationId}`,
  ]);
}, 60_000);
