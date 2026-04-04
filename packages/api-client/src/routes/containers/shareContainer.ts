import { isShareContainerResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function shareContainer(
  request: RequestFn,
  containerId: string,
  subjectType: "user" | "group" | "organization",
  subjectId: string,
  accessLevel: "read" | "write" | "admin",
) {
  return request(
    `/containers/${containerId}/share`,
    isShareContainerResponse,
    "POST",
    JSON.stringify({
      accessLevel,
      subjectId,
      subjectType,
    }),
  );
}
