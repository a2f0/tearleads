import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../../../../test/helpers/authenticate";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../../test/helpers/registerUser";
import { assertVerifiedContainerGrantReferencesValid } from "./groupReferences";

test("locked container grants require their referenced group state to be current", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const manifest = asVerifiedContainerManifest(root.bundle);
  expect(manifest.state.referencedPrincipalHeads.length).toBeGreaterThan(0);
  await expect(
    db.transaction((executor) =>
      assertVerifiedContainerGrantReferencesValid({ executor, manifest }),
    ),
  ).resolves.toBeUndefined();
  await expect(
    db.transaction((executor) =>
      assertVerifiedContainerGrantReferencesValid({
        executor,
        manifest: {
          ...manifest,
          state: {
            ...manifest.state,
            referencedPrincipalHeads:
              manifest.state.referencedPrincipalHeads.map((head) => ({
                ...head,
                stateHash: "0".repeat(64),
              })),
          },
        },
      }),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
