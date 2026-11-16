import { afterEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { setDocumentText } from "../mutations";
import type { DocumentState } from "../state";
import {
  createFreshPeerStoredDocument,
  createStoredDocument,
} from "../storedDocument";
import { openHistoryTestStore as openStore } from "./historyDurability.testFixtures";

const realNow = Date.now;
const HOUR_MILLISECONDS = 3_600_000;

afterEach(() => {
  Date.now = realNow;
});

function nowSeconds(): number {
  return Math.floor(realNow() / 1000);
}

/** Every change time the document holds, oldest first. */
function changeTimestamps(doc: DocumentState): number[] {
  return [...doc.getAllChanges().values()]
    .flat()
    .map((change) => change.timestamp)
    .sort((left, right) => left - right);
}

test("a store-authored document records when each edit was committed", async () => {
  const { close, execSql } = await createTestExecSql("history-change-times");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const before = nowSeconds();
    const first = await openStore(
      execSql,
      "timed-doc",
      sqlDocumentsPersistence,
      "born",
    );
    await setDocumentText(first, () => undefined, "born and edited");

    const reopened = await openStore(
      execSql,
      "timed-doc",
      sqlDocumentsPersistence,
    );
    if (!reopened.doc) throw new Error("expected restored doc");
    const restoredTimes = changeTimestamps(reopened.doc);
    expect(restoredTimes.length).toBeGreaterThan(0);
    expect(restoredTimes[0]).toBeGreaterThanOrEqual(before);
    expect(restoredTimes.at(-1)).toBeLessThanOrEqual(nowSeconds());

    // A restored document stamps the current time. Loro would otherwise reuse
    // the newest time it restored, back-dating every later edit to it.
    Date.now = () => realNow() + HOUR_MILLISECONDS;
    await setDocumentText(reopened, () => undefined, "edited an hour later");
    Date.now = realNow;

    const afterRestart = await openStore(
      execSql,
      "timed-doc",
      sqlDocumentsPersistence,
    );
    if (!afterRestart.doc) throw new Error("expected restored doc");
    expect(changeTimestamps(afterRestart.doc).at(-1)).toBeGreaterThanOrEqual(
      before + HOUR_MILLISECONDS / 1000,
    );
  } finally {
    close();
  }
});

test("every document the store builds stamps its changes", async () => {
  const { close, execSql } = await createTestExecSql("history-change-builders");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const state = await openStore(
      execSql,
      "builder-doc",
      sqlDocumentsPersistence,
    );
    const before = nowSeconds();
    for (const doc of [
      await createStoredDocument(state),
      // The replacement built after discarding non-durable local operations.
      await createFreshPeerStoredDocument(),
    ]) {
      doc.getText("text").insert(0, "edit");
      doc.commit();
      expect(changeTimestamps(doc).at(-1)).toBeGreaterThanOrEqual(before);
    }
  } finally {
    close();
  }
});
