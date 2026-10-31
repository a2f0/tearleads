import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  containers,
  documents,
  organizationBilling,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerOrganization } from "../../../test/helpers/organizationPurge";
import { purgeClaimedOrganizationRemoteData } from "../../workflows/billing/organizationPurge";
import { claimOrganizationForPurge } from "../../workflows/billing/organizationPurgeCandidates";

async function countOrganizationPurge(extraDocuments: number) {
  const organizationId = await registerOrganization();
  const now = new Date("2099-08-30T12:00:00.000Z");
  const [root] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.organizationId, organizationId));
  invariant(root, "expected organization root");
  for (let index = 0; index < extraDocuments; index += 1) {
    const containerId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    await db.insert(containers).values({
      depth: 1,
      id: containerId,
      organizationId,
      parentId: root.id,
    });
    await db
      .insert(documents)
      .values({ id: documentId, createdByFingerprint: "purge-budget" });
    await db
      .insert(containerMetadataDocuments)
      .values({ containerId, documentId });
  }
  await db
    .update(organizationBilling)
    .set({ purgeAfter: new Date(now.getTime() - 1), status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const claim = await claimOrganizationForPurge(db, organizationId, now);
  invariant(claim, "expected purge claim");
  const counter = { statements: 0 };
  const purged = await withDatabaseStatementCounter(counter, () =>
    purgeClaimedOrganizationRemoteData({ claim, db, now }),
  );
  invariant(purged, "expected purge to run");
  return counter.statements;
}

test("organization purge statements do not grow with its documents", async () => {
  const one = await countOrganizationPurge(1);
  const three = await countOrganizationPurge(3);
  expect(three).toBe(one);
  // Budget: the highest count across PGlite, SQLite and PostgreSQL, which
  // count the transaction's BEGIN and COMMIT. 61 / 63 / 63 before the
  // document-baseline, principal epoch-key, and built-in grant tables were
  // retired; 57 / 59 / 59 after. Locking the organization and its two
  // groups before deleting their principal states adds three advisory locks
  // where PGlite and Postgres take them: 60 / 59 / 62.
  expect(one).toBeLessThanOrEqual(62);
});
