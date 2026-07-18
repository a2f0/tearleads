import { expect, test } from "bun:test";
import {
  classifyDocumentSyncRequestMode,
  type DocumentSyncRequestModeClassification,
} from "./documentSyncRequestMode";

type PresenceBit = 0 | 1;
type PresenceKey = `${PresenceBit}${PresenceBit}${PresenceBit}`;

const expectedByPresence = {
  "000": "read-only",
  "001": "invalid-rekeys-without-write",
  "010": "read-only",
  "011": "invalid-rekeys-without-write",
  "100": "invalid-authorizing-path-refs-absent",
  "101": "invalid-authorizing-path-refs-absent",
  "110": "write",
  "111": "write",
} satisfies Record<PresenceKey, DocumentSyncRequestModeClassification>;

function presenceBit(present: boolean): PresenceBit {
  return present ? 1 : 0;
}

test("classifies every decoded document sync request mode", () => {
  const states = [false, true] as const;
  const visited = new Set<PresenceKey>();

  for (const hasOutgoingUpdates of states) {
    for (const authorizingContainerPathRefsPresent of states) {
      for (const hasContainerRekeys of states) {
        const key = `${presenceBit(hasOutgoingUpdates)}${presenceBit(
          authorizingContainerPathRefsPresent,
        )}${presenceBit(hasContainerRekeys)}` as PresenceKey;
        visited.add(key);

        expect(
          classifyDocumentSyncRequestMode({
            authorizingContainerPathRefsPresent,
            hasContainerRekeys,
            hasOutgoingUpdates,
          }),
        ).toBe(expectedByPresence[key]);
      }
    }
  }

  expect(visited.size).toBe(8);
});
