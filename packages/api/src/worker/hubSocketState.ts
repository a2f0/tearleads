import { z } from "zod";
import type { GatewaySocketSnapshot } from "../realtime/gatewayHibernation";

const identifier = z.string().min(1);
const timestamp = z.number().finite().nonnegative();
export const HubSocketAttachmentSchema = z.object({
  id: identifier,
  identity: z.object({ userId: identifier, sessionId: identifier }),
});

const SnapshotSchema = z.object({
  proofs: z.array(
    z.object({
      containerId: identifier,
      pathContainerIds: z.array(identifier),
      principalKeys: z.array(identifier),
    }),
  ),
  verifiedAt: timestamp,
  nextCheckAt: timestamp,
  session: z.object({ confirmedAt: timestamp, nextCheckAt: timestamp }),
  organization: z
    .object({ organizationId: identifier, authorized: z.boolean() })
    .nullable(),
});

/** Missing or malformed server state requires a fresh authenticated socket. */
export function parseHubSocketSnapshot(
  encoded: string,
): GatewaySocketSnapshot | null {
  try {
    const parsed = SnapshotSchema.safeParse(JSON.parse(encoded));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
