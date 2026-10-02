import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createReservedGroupAdvance } from "../../../test/helpers/reservedGroupAdvance";
import { MetadataRootBehindDirectoryError } from "./groupMetadataErrors";

// The metadata root and the signed directory are separate reads. A reserved-
// group commit between them leaves the root citing that group's previous head.

test.each(["Admins", "Members"] as const)(
  "a root read before an %s commit is a stale read, not tampering",
  async (advancing) => {
    const { close, execSql } = await createTestExecSql(
      `metadata-root-behind-${advancing}`,
    );
    try {
      const { state, verifier } = await createReservedGroupAdvance(advancing);
      const behind = verifier(execSql)(state);

      await expect(behind).rejects.toBeInstanceOf(
        MetadataRootBehindDirectoryError,
      );
      await expect(behind).rejects.not.toBeInstanceOf(KeyingVerificationError);
    } finally {
      close();
    }
  },
);

test("a root citing a head outside the directory's chain is still tampering", async () => {
  const { close, execSql } = await createTestExecSql("metadata-root-forged");
  try {
    const { members, state, verifier } =
      await createReservedGroupAdvance("Members");
    const forged = verifier(execSql)({
      ...state,
      referencedPrincipalHeads: state.referencedPrincipalHeads.map((head) =>
        head.principalId === members.currentState.principalId
          ? { ...head, stateHash: "never-committed" }
          : head,
      ),
    });

    await expect(forged).rejects.toBeInstanceOf(KeyingVerificationError);
    await expect(forged).rejects.toThrow("reserved group grants");
  } finally {
    close();
  }
});

test("one honestly behind head does not excuse a forged one in the same root", async () => {
  const { close, execSql } = await createTestExecSql("metadata-root-mixed");
  try {
    // Admins advanced, so the root's Admins head is an honest predecessor;
    // its Members head was never committed at all.
    const { members, state, verifier } =
      await createReservedGroupAdvance("Admins");
    const mixed = verifier(execSql)({
      ...state,
      referencedPrincipalHeads: state.referencedPrincipalHeads.map((head) =>
        head.principalId === members.currentState.principalId
          ? { ...head, stateHash: "never-committed" }
          : head,
      ),
    });

    await expect(mixed).rejects.toBeInstanceOf(KeyingVerificationError);
    await expect(mixed).rejects.toThrow("reserved group grants");
  } finally {
    close();
  }
});
