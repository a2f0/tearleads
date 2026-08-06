import { z } from "zod";
import { loosePlainObject } from "../../schema";

export const WebSocketTicketResponseSchema = loosePlainObject({
  ticket: z.string(),
});

export type WebSocketTicketResponse = z.infer<
  typeof WebSocketTicketResponseSchema
>;

export function isWebSocketTicketResponse(
  value: unknown,
): value is WebSocketTicketResponse {
  return WebSocketTicketResponseSchema.safeParse(value).success;
}
