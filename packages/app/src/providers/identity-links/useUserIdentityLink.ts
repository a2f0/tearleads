import { useEffect, useMemo, useState } from "react";
import { useIdentityLinkResolver } from "./IdentityLinkResolverProvider";

export interface UserIdentityLinkState {
  error: string | null;
  link: string | null;
  pending: boolean;
}

interface SettledLink {
  readonly error: string | null;
  readonly link: string | null;
  readonly request: object;
}

/**
 * The identity link for `userId`, resolved up front so a later click can copy
 * it synchronously inside the user gesture. Only a link-verified pin (or the
 * signed-in user's own keys) yields a link. A result is dropped once the user,
 * the signed-in identity, or the active database changes.
 */
export function useUserIdentityLink(
  userId: string | null,
): UserIdentityLinkState {
  const resolver = useIdentityLinkResolver();
  // A fresh object per input set: a settled result counts only for the exact
  // request that produced it.
  const request = useMemo(() => ({ resolver, userId }), [resolver, userId]);
  const [settled, setSettled] = useState<SettledLink | null>(null);

  useEffect(() => {
    const requestedUserId = request.userId;
    if (!requestedUserId) return;
    let current = true;
    const settle = (link: string | null, error: string | null) => {
      if (current && request.resolver.isCurrent()) {
        setSettled({ error, link, request });
      }
    };
    request.resolver.createLinkFor(requestedUserId).then(
      (link) => settle(link, null),
      (caught: unknown) =>
        settle(
          null,
          caught instanceof Error
            ? caught.message
            : "Unable to create the identity link.",
        ),
    );
    return () => {
      current = false;
    };
  }, [request]);

  const result = settled?.request === request ? settled : null;
  return {
    error: result?.error ?? null,
    link: result?.link ?? null,
    pending: userId !== null && result === null,
  };
}
