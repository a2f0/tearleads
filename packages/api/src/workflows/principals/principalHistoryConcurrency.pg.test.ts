import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "opposite-order policy reads do not deadlock on verification hints",
  async () => {
    const fixtures = await Promise.all([
      principalHistoryPreparationFixture({
        versions: 1,
        currentArtifacts: true,
      }),
      principalHistoryPreparationFixture({
        versions: 1,
        currentArtifacts: true,
      }),
    ]);
    const states = await Promise.all(
      fixtures.map(({ head }) =>
        getCurrentPrincipalState("group", head.principalId, db),
      ),
    );
    const [first, second] = states;
    if (!first || !second) throw new Error("Missing history fixtures");
    const barrier = Promise.withResolvers<void>();
    let arrived = 0;
    const outcomes = await Promise.allSettled(
      [
        [first, second],
        [second, first],
      ].map(([own, other]) =>
        db.transaction(async (tx) => {
          if (!own || !other) throw new Error("Missing transaction fixtures");
          await getVerifiedPrincipalPolicyForStateWithExecutor(tx, own);
          arrived += 1;
          if (arrived === 2) barrier.resolve();
          await barrier.promise;
          await getVerifiedPrincipalPolicyForStateWithExecutor(tx, other);
        }),
      ),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "cold verification succeeds inside a PostgreSQL read-only transaction",
  async () => {
    const { head } = await principalHistoryPreparationFixture({
      versions: 3,
      currentArtifacts: true,
    });
    const state = await getCurrentPrincipalState("group", head.principalId, db);
    if (!state) throw new Error("Missing current state");
    const verified = await db.transaction(
      (tx) => getVerifiedPrincipalPolicyForStateWithExecutor(tx, state),
      { accessMode: "read only" },
    );
    expect(verified.bundle.currentState.stateHash).toBe(head.stateHash);
  },
);
