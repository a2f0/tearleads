import { expect } from "bun:test";
import { readText } from "./documentReads";
import { trace } from "./trace";
import type { SharedDocument, World } from "./world";

/**
 * Reads `document` on every device of every user and compares each result
 * with the model: a current reader sees the latest text, and anyone else
 * sees nothing written after they lost access.
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
      const text = await readText(device, document);
      trace(`${device.label} canRead=${canRead} read=${text}`);
      if (canRead) {
        expect({ device: device.label, text }).toEqual({
          device: device.label,
          text: latest,
        });
      } else {
        expect({ device: device.label, leaked: !allowed.has(text) }).toEqual({
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
