import { useDualPane } from "./useDualPane";
import { usePaneSide } from "./usePaneSide";

export function usePeerUserId(): string | null {
  const { leftUserId, rightUserId } = useDualPane();
  const side = usePaneSide();
  return side === "left" ? rightUserId : leftUserId;
}
