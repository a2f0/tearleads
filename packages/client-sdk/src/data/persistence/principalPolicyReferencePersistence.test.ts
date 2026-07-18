import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
  referencedPrincipalStateFromPolicyState,
} from "../../../test/helpers/policyCacheFixtures";
import { savePrincipalPolicyBundle } from "./principalPolicyPersistence";
import { loadPrincipalPolicyBundleForReference } from "./principalPolicyReferencePersistence";

test("exact principal policy lookup loads a current head", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-current",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");

    await expect(
      loadPrincipalPolicyBundleForReference(
        execSql,
        referencedPrincipalStateFromBundle(bundle),
      ),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("exact principal policy lookup uses the newest current chain containing a historical head", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-current-history",
  );
  try {
    const { bundle } = await createSuccessorPrincipalPolicyBundle();
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("Expected a predecessor state");
    }
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");

    await expect(
      loadPrincipalPolicyBundleForReference(
        execSql,
        referencedPrincipalStateFromPolicyState(previousState),
      ),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("exact principal policy lookup loads a retained bundle when current is absent", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-retained",
  );
  try {
    const { bundle: retainedBundle } = await createPrincipalPolicyBundle();
    const { bundle: successorBundle } =
      await createSuccessorPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(
      execSql,
      retainedBundle,
      "2026-07-18T00:00:00Z",
    );
    await savePrincipalPolicyBundle(
      execSql,
      successorBundle,
      "2026-07-18T00:01:00Z",
    );
    await execSql(
      "DELETE FROM principal_policies WHERE principal_type = ? AND principal_id = ?",
      [
        retainedBundle.currentState.principalType,
        retainedBundle.currentState.principalId,
      ],
    );

    await expect(
      loadPrincipalPolicyBundleForReference(
        execSql,
        referencedPrincipalStateFromBundle(retainedBundle),
      ),
    ).resolves.toEqual(retainedBundle);
  } finally {
    close();
  }
});

test("exact principal policy lookup returns null for an honest miss", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-miss",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");

    await expect(
      loadPrincipalPolicyBundleForReference(execSql, {
        ...reference,
        stateHash: "0".repeat(64),
      }),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("exact principal policy lookup rejects corrupt and same-hash mismatched bundles", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-exact-corrupt",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);
    await savePrincipalPolicyBundle(execSql, bundle, "2026-07-18T00:00:00Z");

    await expect(
      loadPrincipalPolicyBundleForReference(execSql, {
        ...reference,
        keyFingerprint: `${reference.keyFingerprint}-wrong`,
      }),
    ).rejects.toThrow("head does not match");

    await execSql(
      `UPDATE principal_policies
       SET current_state_json = ?
       WHERE principal_type = ? AND principal_id = ?`,
      ["{}", reference.principalType, reference.principalId],
    );
    await expect(
      loadPrincipalPolicyBundleForReference(execSql, reference),
    ).rejects.toThrow("bundle is invalid");
  } finally {
    close();
  }
});
