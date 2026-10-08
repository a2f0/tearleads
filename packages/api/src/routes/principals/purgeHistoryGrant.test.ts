import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { DocumentPurgeProofResponseSchema } from "@tearleads/validators/response";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { routeApp } from "../../routeApp";
import {
  issueProjectionPolicyHistoryGrant,
  readProjectionPolicyHistoryGrant,
} from "../../workflows/principals/projectionPolicyHistoryGrant";

test("terminal history grants bind the purge, organization and original reader", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticate(owner, outsider);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const purged = await postDocumentPurge({
    owner,
    root,
    documentId: document.id,
    documentManifestHash: document.accessManifest.manifestHash,
  });
  expect(purged.status, await purged.clone().text()).toBe(200);
  const proof = DocumentPurgeProofResponseSchema.parse(await purged.json());
  const source = proof.policyEvidence.groups[0];
  if (!source) throw new Error("Missing terminal group source");
  const scope = readProjectionPolicyHistoryGrant(source.grant, owner.userId);
  expect(scope.objectKind).toBe("document-purge");
  const request = (grant: string, actor = owner) =>
    requestPreparedPrincipalPolicy(
      `/principals/history?${new URLSearchParams({ grant })}`,
      {
        headers: { Authorization: `Bearer ${actor.token}` },
      },
    );
  expect((await request(source.grant)).status).toBe(200);
  expect((await request(source.grant, outsider)).status).toBe(403);
  expect(
    (
      await request(
        issueProjectionPolicyHistoryGrant({
          ...scope,
          userId: outsider.userId,
        }),
        outsider,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        issueProjectionPolicyHistoryGrant({
          ...scope,
          organizationId: crypto.randomUUID(),
        }),
      )
    ).status,
  ).toBe(403);
  expect((await request(`${source.grant}x`)).status).toBe(403);
  const live = await createDocument({ owner, root });
  expect(
    (
      await request(
        issueProjectionPolicyHistoryGrant({ ...scope, objectId: live.id }),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await routeApp.request(
        `/principals/history?${new URLSearchParams({ grant: source.grant })}`,
      )
    ).status,
  ).toBe(401);
}, 15_000);
