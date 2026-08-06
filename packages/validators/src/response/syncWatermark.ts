import { z } from "zod";
import { loosePlainObject } from "../schema";

export const SyncWatermarkSchema = loosePlainObject({
  id: z.string(),
  updatedAt: z.string(),
});

export type SyncWatermark = z.infer<typeof SyncWatermarkSchema>;

export function isSyncWatermark(value: unknown): value is SyncWatermark {
  return SyncWatermarkSchema.safeParse(value).success;
}
