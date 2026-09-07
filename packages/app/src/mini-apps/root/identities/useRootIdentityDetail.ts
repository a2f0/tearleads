import type {
  RootIdentityDetail,
  RootIdentityOrganization,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { describeRootFailure, describeThrown } from "./rootDisplay";

interface RootIdentityDetailState {
  readonly detail: RootIdentityDetail | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly organizations: ReadonlyArray<RootIdentityOrganization> | null;
}

const EMPTY_STATE: RootIdentityDetailState = {
  detail: null,
  error: null,
  loading: false,
  organizations: null,
};

/** Loads an identity's detail and organizations together; stale replies are dropped. */
export function useRootIdentityDetail(userId: string) {
  const tearleads = useTearleads();
  const [state, setState] = useState<RootIdentityDetailState>(EMPTY_STATE);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setState({ ...EMPTY_STATE, loading: true });
    let detail: Awaited<ReturnType<typeof tearleads.root.loadIdentity>>;
    let organizations: Awaited<
      ReturnType<typeof tearleads.root.listIdentityOrganizations>
    >;
    try {
      [detail, organizations] = await Promise.all([
        tearleads.root.loadIdentity(userId),
        tearleads.root.listIdentityOrganizations(userId),
      ]);
    } catch (error) {
      // A malformed id in the URL fails client-side validation before any
      // request is sent; report it like a server failure instead of leaving
      // the view loading forever.
      const failure = {
        message: describeThrown(error),
        ok: false as const,
        status: null,
      };
      detail = failure;
      organizations = failure;
    }
    if (sequence !== requestSequence.current) {
      return;
    }
    const failure = !detail.ok
      ? detail
      : !organizations.ok
        ? organizations
        : null;
    setState({
      detail: detail.ok ? detail.data : null,
      error: failure ? describeRootFailure(failure) : null,
      loading: false,
      organizations: organizations.ok ? organizations.data : null,
    });
  }, [tearleads, userId]);

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const refresh = useCallback(() => void load(), [load]);

  return { ...state, refresh };
}
