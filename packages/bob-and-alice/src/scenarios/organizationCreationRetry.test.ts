import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { World } from "../harness/world";
import {
  observeExactPlainReplay,
  observeLostOrganizationCreate,
} from "./organizationCreateResponseLoss.testUtils";

for (const restartBeforeRetry of [false, true]) {
  describe(`#2893 lost create: ${restartBeforeRetry ? "restart" : "same runtime"} retry`, () => {
    let world: World;
    let observed: Awaited<ReturnType<typeof observeLostOrganizationCreate>>;
    beforeAll(async () => {
      world = await World.create();
      observed = await observeLostOrganizationCreate(world, restartBeforeRetry);
    }, 120_000);
    afterAll(() => world?.dispose());

    test("commits before loss and discovers the original root without a create acknowledgement", () => {
      const { first, personalId } = observed;
      expect(observed.firstResult).toBeNull();
      expect(observed.initialServerIds).toEqual([personalId]);
      expect(observed.beforeLoss.map((org) => org.organizationId)).toEqual([
        personalId,
      ]);
      expect(observed.afterLoss.map((org) => org.organizationId)).toEqual([
        personalId,
      ]);
      expect(observed.afterCommitServerIds.sort()).toEqual(
        [personalId, first.organizationId].sort(),
      );
      for (const organizations of [observed.hydrated, observed.beforeRetry]) {
        expect(
          organizations.find(
            (org) => org.organizationId === first.organizationId,
          ),
        ).toMatchObject({
          organizationId: first.organizationId,
          rootContainerId: first.containerId,
        });
      }
      expectNoSecurityIncidents(world);
    });

    test("records both plain POSTs and retains every discovered identity on runtime restart", () => {
      expect(observed.statuses).toEqual([200, 200]);
      expect(observed.submitted).toEqual([observed.first, observed.retry]);
      const serverIds = [
        ...new Set([
          observed.personalId,
          observed.first.organizationId,
          observed.retry.organizationId,
        ]),
      ].sort();
      expect(observed.afterRetryServerIds.sort()).toEqual(serverIds);
      expect(observed.afterRestartServerIds.sort()).toEqual(serverIds);
      for (const organizations of [
        observed.afterRetry,
        observed.afterRestart,
      ]) {
        expect(organizations.map((org) => org.organizationId).sort()).toEqual(
          serverIds,
        );
        for (const identity of [observed.first, observed.retry]) {
          expect(
            organizations.find(
              (org) => org.organizationId === identity.organizationId,
            ),
          ).toMatchObject({
            organizationId: identity.organizationId,
            rootContainerId: identity.containerId,
          });
        }
      }
      expectNoSecurityIncidents(world);
    });

    // The same response-loss regression now passes on both API backends.
    test("#2893 retry adopts one committed organization on server and device", () => {
      expect({
        retry: observed.retry,
        server: observed.afterRetryServerIds.filter(
          (id) => id !== observed.personalId,
        ),
        local: observed.afterRestart
          .filter((org) => org.organizationId !== observed.personalId)
          .map((org) => ({
            organizationId: org.organizationId,
            containerId: org.rootContainerId,
          })),
      }).toEqual({
        retry: observed.first,
        server: [observed.first.organizationId],
        local: [observed.first],
      });
    });
  });
}

describe("#2893 exact plain request replay", () => {
  let world: World;
  let observed: Awaited<ReturnType<typeof observeExactPlainReplay>>;
  beforeAll(async () => {
    world = await World.create();
    observed = await observeExactPlainReplay(world);
  }, 120_000);
  afterAll(() => world?.dispose());

  test("an exact signed replay does not insert another server organization", () => {
    expect(observed.status).toBe(200);
    expect(observed.submitted).toEqual(observed.created);
    expect(observed.afterReplayServerIds.sort()).toEqual(
      [...observed.initialServerIds, observed.created.organizationId].sort(),
    );
    expectNoSecurityIncidents(world);
  });

  test("#2893 accepts an exact plain create replay", () => {
    expect({ status: observed.status, body: observed.body }).toMatchObject({
      status: 200,
      body: {
        organizationId: observed.created.organizationId,
        rootContainerId: observed.created.containerId,
      },
    });
  });
});
