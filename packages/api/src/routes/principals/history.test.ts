import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { PrincipalPolicySnapshotPageResponseSchema } from "@tearleads/validators/response";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import {
  getPolicy,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { routeApp } from "../../routeApp";
import {
  issueProjectionPolicyHistoryGrant,
  type ProjectionPolicyHistoryGrant,
} from "../../workflows/principals/projectionPolicyHistoryGrant";

test.each(["container", "document"] as const)(
  "%s-scoped public history checks the reader on every pinned page",
  async (objectKind) => {
    const owner = createTestUser();
    const outsider = createTestUser();
    await registerAndAuthenticate(owner, outsider);
    const root = await bootstrapRoot(owner);
    const objectId =
      objectKind === "container"
        ? root.kekState.containerId
        : (await createDocument({ owner, root })).id;
    const history = await principalHistoryPreparationFixture({ versions: 66 });
    expect(
      (await getPolicy(owner, "group", history.head.principalId)).status,
    ).toBe(403);
    // Exercise a server-issued public read scope with no live group, secret
    // payload or member envelope. Production issuance checks directory binding.
    const scope: ProjectionPolicyHistoryGrant = {
      organizationId: await getDefaultOrganizationId(owner.userId),
      objectKind,
      objectId,
      userId: owner.userId,
      head: history.head,
    };
    const grant = issueProjectionPolicyHistoryGrant(scope);
    const request = (token = grant, afterVersion = 0, actor = owner) =>
      requestPreparedPrincipalPolicy(
        `/principals/history?${new URLSearchParams({ grant: token, afterVersion: String(afterVersion) })}`,
        { headers: { Authorization: `Bearer ${actor.token}` } },
      );
    for (const after of [0, 32, 64, 65]) {
      const response = await request(grant, after);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const raw = await response.json();
      const page = PrincipalPolicySnapshotPageResponseSchema.parse(raw);
      expect(page.currentState.stateHash).toBe(history.head.stateHash);
      expect(page.previousStates.map(({ state }) => state.version)).toEqual(
        Array.from(
          { length: Math.min(32, 65 - after) },
          (_, index) => after + index + 1,
        ),
      );
      expect(raw).not.toHaveProperty("currentPayload");
      expect(raw).not.toHaveProperty("currentMemberEnvelopes");
    }
    expect((await request(grant, 32, outsider)).status).toBe(403);
    // A correctly signed scope is insufficient once its user lacks current
    // access; pinning an old head must not freeze authorization.
    const inaccessible = issueProjectionPolicyHistoryGrant({
      ...scope,
      userId: outsider.userId,
    });
    expect((await request(inaccessible, 32, outsider)).status).toBe(403);
    const foreignOrganization = issueProjectionPolicyHistoryGrant({
      ...scope,
      organizationId: crypto.randomUUID(),
    });
    expect((await request(foreignOrganization, 32)).status).toBe(403);
    const wrongVersion = issueProjectionPolicyHistoryGrant({
      ...scope,
      head: { ...scope.head, version: 67 },
    });
    expect((await request(wrongVersion)).status).toBe(409);
    expect((await request(grant, 66)).status).toBe(400);
    expect((await request(grant, -1)).status).toBe(400);
    expect((await request(`${grant}x`)).status).toBe(403);
    expect(
      (await routeApp.request(`/principals/history?grant=${grant}`)).status,
    ).toBe(401);
  },
  20_000,
);
