import { expect, test } from "bun:test";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "./metadataStateIsolation";

test("detached metadata state does not mutate its live source before install", async () => {
  const container = createContainerRecord({
    id: "metadata-isolation-container",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, { icon: null, name: "Live name" });
  const live = {
    container,
    doc,
    record: createDocumentRecord({ id: container.id }),
    rekeyOnlyPassCount: 2,
  };

  const candidate = await createDetachedContainerMetadataState(live);
  candidate.container = { ...candidate.container, name: "Candidate name" };
  candidate.record = { ...candidate.record, lastCommitLsn: "0/2" };
  candidate.rekeyOnlyPassCount = 3;
  writeContainerMetadataValue(candidate.doc, {
    icon: "archive",
    name: "Candidate name",
  });

  expect(live.container.name).not.toBe("Candidate name");
  expect(live.record.lastCommitLsn).not.toBe("0/2");
  expect(readContainerMetadataValue(live.doc, "fallback")).toEqual({
    icon: null,
    name: "Live name",
  });

  installDetachedContainerMetadataState(live, candidate);
  expect(live.container.name).toBe("Candidate name");
  expect(live.record.lastCommitLsn).toBe("0/2");
  expect(live.rekeyOnlyPassCount).toBe(3);
  expect(readContainerMetadataValue(live.doc, "fallback")).toEqual({
    icon: "archive",
    name: "Candidate name",
  });
});
