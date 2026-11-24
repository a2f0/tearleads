import { expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  isDocumentLinkSetMutationResponse,
} from "@tearleads/validators/response";
import { withDocumentMutationArtifacts } from "../../../test/helpers/documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../../test/helpers/documentLinkMutation";
import {
  committedUpdateIds,
  peerSpan,
  sharedWriterDocument,
  syncPeerSpans,
} from "../../../test/helpers/documentPeerOwnership";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import { routeApp } from "../../routeApp";

const writerPeer = "1000";

function postJson(token: string, path: string, body: unknown) {
  return routeApp.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// An unlink commits its rotation baseline through the same append as a sync,
// so the baseline may re-assert another user's peer but not extend it.
test("an unlink's rotation baseline cannot extend another user's peer", async () => {
  const fixture = await sharedWriterDocument();
  const { created, owner, root, writer } = fixture;
  expect(
    (await syncPeerSpans(fixture, writer, [peerSpan(writerPeer, 0, 3)]))
      .response.status,
  ).toBe(200);
  const child = await createChildContainer({ parent: root, signer: owner });
  const link = await buildDocumentLinkRequest({
    child,
    createdDocument: created,
    owner,
    root,
  });
  const linked = await postJson(
    owner.token,
    `/documents/${created.id}/link`,
    link,
  );
  expect(linked.status).toBe(200);
  const linkedDocument = withDocumentMutationArtifacts(
    link,
    await linked.json(),
  );
  const unlink = (end: number) =>
    buildDocumentUnlinkRequest({
      child,
      linkedDocument,
      owner,
      root,
      rotationBaselineSourceVersionVector: encodeVersionVectorCounters({
        [writerPeer]: end,
      }),
    });

  const extending = await unlink(5);
  const refused = await postJson(
    owner.token,
    `/documents/${created.id}/unlink`,
    extending,
  );
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({
    code: DOCUMENT_SYNC_ERROR_CODES.peerOwned,
  });
  const refusedBaselineId = extending.rotationBaseline?.id;
  if (!refusedBaselineId) throw new Error("Expected a rotation baseline");
  expect(await committedUpdateIds([refusedBaselineId])).toEqual([]);

  const covering = await postJson(
    owner.token,
    `/documents/${created.id}/unlink`,
    await unlink(3),
  );
  expect(covering.status).toBe(200);
  expect(isDocumentLinkSetMutationResponse(await covering.json())).toBe(true);
}, 30_000);
