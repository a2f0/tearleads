import { useState } from "react";

/**
 * The membership change a group panel started. Tagged with its group so
 * another group never shows it, and compared by identity so a stale
 * completion cannot clear a newer change.
 */
type GroupMemberAction =
  | { readonly kind: "add"; readonly groupId: string }
  | {
      readonly kind: "remove";
      readonly groupId: string;
      readonly userId: string;
    };

type MemberWork = () => void | Promise<void>;

interface GroupMemberActionState {
  /** The Add started for this group is still running. */
  readonly adding: boolean;
  /** The member of this group whose removal is still running. */
  readonly removingUserId: string | null;
  readonly add: (work: MemberWork) => Promise<void>;
  readonly remove: (userId: string, work: MemberWork) => Promise<void>;
}

/** Tracks the in-flight add or remove, so its button can show progress. */
export function useGroupMemberAction(groupId: string): GroupMemberActionState {
  const [action, setAction] = useState<GroupMemberAction | null>(null);
  const run = async (next: GroupMemberAction, work: MemberWork) => {
    setAction(next);
    try {
      await work();
    } finally {
      setAction((current) => (current === next ? null : current));
    }
  };
  const active = action?.groupId === groupId ? action : null;

  return {
    adding: active?.kind === "add",
    removingUserId: active?.kind === "remove" ? active.userId : null,
    add: (work) => run({ groupId, kind: "add" }, work),
    remove: (userId, work) => run({ groupId, kind: "remove", userId }, work),
  };
}
