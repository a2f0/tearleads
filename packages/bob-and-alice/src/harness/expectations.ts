import { expect } from "bun:test";
import { readText } from "./documentReads";
import { trace } from "./trace";
import type { SharedDocument, World } from "./world";

/**
 * Reads `document` on every device of every user and compares each result
 * with the model: a current reader sees the latest text, and anyone else
 * sees nothing written after they lost access. Either may instead show an
 * edit of its own that the API refused, which only that device holds.
 */
export async function expectAccess(
  world: World,
  document: SharedDocument,
): Promise<void> {
  const latest = world.model.latestText(document.documentId);
  for (const user of world.allUsers) {
    const canRead = world.model.canRead(user.userId, document.documentId);
    const allowed = new Set<string | null>([
      null,
      ...world.model.textsVisibleWithoutAccess(
        user.userId,
        document.documentId,
      ),
    ]);
    for (const device of user.devices) {
      const text = await readText(device, world.documentRef(document));
      trace(`${device.label} canRead=${canRead} read=${text}`);
      const own = text !== null && world.refusedEditsOn(device).has(text);
      if (canRead) {
        expect({ device: device.label, text }).toEqual({
          device: device.label,
          text: own ? text : latest,
        });
      } else {
        const leaked = !allowed.has(text) && !own;
        expect({ device: device.label, leaked }).toEqual({
          device: device.label,
          leaked: false,
        });
      }
    }
  }
}

/** An honest API must never trip a device's trust-boundary checks. */
export function expectNoSecurityIncidents(world: World): void {
  for (const user of world.allUsers) {
    for (const device of user.devices) {
      expect({ device: device.label, incidents: device.incidents }).toEqual({
        device: device.label,
        incidents: [],
      });
    }
  }
}
