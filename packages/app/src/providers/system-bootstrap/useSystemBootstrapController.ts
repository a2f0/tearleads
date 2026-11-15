import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  hasSystemBootstrapCompleted,
  initialSystemBootstrapState,
  type SystemBootstrapEvent,
  type SystemBootstrapState,
  type SystemBootstrapStatus,
  transitionSystemBootstrap,
} from "./systemBootstrapMachine";
import type {
  SystemBootstrapResult,
  SystemBootstrapRunInput,
} from "./systemBootstrapRun";

export interface SystemBootstrapContextValue {
  readonly ensureBootstrapped: () => Promise<SystemBootstrapResult>;
  readonly error: unknown;
  readonly isBootstrapping: boolean;
  readonly status: SystemBootstrapStatus;
}

interface SystemBootstrapControllerInput {
  readonly bootstrapInput: SystemBootstrapRunInput | null;
  readonly contactsContainerId?: string | null;
  readonly enabled: boolean;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly runBootstrap: (input: SystemBootstrapRunInput) => Promise<boolean>;
}

interface BootstrapOwner {
  readonly input: SystemBootstrapRunInput;
  readonly contactsContainerId: string | null;
}

interface BootstrapFlight {
  readonly owner: BootstrapOwner;
  readonly run: object;
  readonly promise: Promise<SystemBootstrapResult>;
}

type BootstrapMachinePort = Pick<
  ReturnType<typeof useBootstrapMachine>,
  "dispatch" | "stateRef"
>;

export function useSystemBootstrapController(
  input: SystemBootstrapControllerInput,
): SystemBootstrapContextValue {
  const { state, stateRef, dispatch } = useBootstrapMachine(input.enabled);
  const authority = useBootstrapAuthority(input);
  const { ensureBootstrapped, completedInputRef, inFlightRef } =
    useBootstrapRunner(input, authority, { dispatch, stateRef });

  useContactsPersistenceWakeup(input, authority, { dispatch, stateRef });

  useEffect(() => {
    if (!input.enabled) {
      completedInputRef.current = null;
      dispatch({ type: "disable" });
      return;
    }
    if (!input.bootstrapInput) {
      if (!inFlightRef.current) {
        dispatch({ type: "input-missing" });
      }
      return;
    }
    if (
      matchesCompletedBootstrap(completedInputRef.current, input.bootstrapInput)
    ) {
      dispatch({ type: "target-complete" });
      return;
    }

    void ensureBootstrapped();
  }, [
    completedInputRef,
    dispatch,
    ensureBootstrapped,
    inFlightRef,
    input.bootstrapInput,
    input.enabled,
  ]);

  useEffect(() => {
    if (
      state !== stateRef.current ||
      state.status !== "waiting" ||
      !state.attempt?.wakePending ||
      !runBelongsToOwner(state.attempt.run, authority.latestRef.current)
    )
      return;
    const next = dispatch({ run: state.attempt.run, type: "wake-consumed" });
    if (next !== state) void ensureBootstrapped();
  }, [authority, dispatch, ensureBootstrapped, state, stateRef]);

  return useMemo(
    () => toContextValue(state, ensureBootstrapped),
    [ensureBootstrapped, state],
  );
}

function useContactsPersistenceWakeup(
  input: SystemBootstrapControllerInput,
  authority: ReturnType<typeof useBootstrapAuthority>,
  {
    dispatch,
    stateRef,
  }: Pick<ReturnType<typeof useBootstrapMachine>, "dispatch" | "stateRef">,
) {
  useEffect(() => {
    const source = input.bootstrapInput;
    const containerId = input.contactsContainerId;
    const owner = authority.latestRef.current;
    if (!input.enabled || !source?.bootstrapContacts || !containerId || !owner)
      return;
    let active = true;
    const unsubscribe = source.tearleads.documents.subscribe(
      (document) => {
        if (
          !active ||
          !authority.isCurrent(owner) ||
          document.documentKind !== "contact" ||
          document.containerId !== containerId
        )
          return;
        const current = stateRef.current;
        const run =
          current.status === "running"
            ? current.run
            : current.status === "waiting"
              ? current.attempt?.run
              : null;
        if (run && runBelongsToOwner(run, owner))
          dispatch({ run, type: "contacts-persisted" });
      },
      { containerId },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    dispatch,
    input.bootstrapInput,
    input.contactsContainerId,
    input.enabled,
    authority,
    stateRef,
  ]);
}

function useBootstrapAuthority(input: SystemBootstrapControllerInput) {
  const latestRef = useRef<BootstrapOwner | null>(null);
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    mountedRef.current = true;
    const source = input.enabled ? input.bootstrapInput : null;
    const contactsContainerId = input.contactsContainerId ?? null;
    if (!source) latestRef.current = null;
    else if (
      latestRef.current?.input !== source ||
      latestRef.current.contactsContainerId !== contactsContainerId
    ) {
      latestRef.current = { input: source, contactsContainerId };
    }
    // Strict Mode may immediately reattach the same owner. Explicit disable
    // clears it above, so re-enabling an identical input has a fresh lifetime.
    return () => {
      mountedRef.current = false;
    };
  }, [input.bootstrapInput, input.contactsContainerId, input.enabled]);
  const isCurrent = useCallback(
    (owner: BootstrapOwner) =>
      mountedRef.current && latestRef.current === owner,
    [],
  );
  return useMemo(() => ({ latestRef, mountedRef, isCurrent }), [isCurrent]);
}

function runBelongsToOwner(run: object, owner: BootstrapOwner | null): boolean {
  return owner !== null && "owner" in run && run.owner === owner;
}

function useBootstrapRunner(
  input: SystemBootstrapControllerInput,
  authority: ReturnType<typeof useBootstrapAuthority>,
  { dispatch, stateRef }: BootstrapMachinePort,
) {
  const completedInputRef = useRef<SystemBootstrapRunInput | null>(null);
  const inFlightRef = useRef<BootstrapFlight | null>(null);
  const ensureBootstrapped =
    useCallback(async (): Promise<SystemBootstrapResult> => {
      const owner = authority.latestRef.current;
      if (!owner || !authority.isCurrent(owner))
        return { completed: false, skipped: true };
      while (inFlightRef.current) {
        const flight = inFlightRef.current;
        const state = stateRef.current;
        if (
          flight.owner === owner &&
          state.status === "running" &&
          state.run === flight.run
        )
          return flight.promise;
        await flight.promise;
        if (!authority.isCurrent(owner))
          return { completed: false, skipped: true };
      }
      if (matchesCompletedBootstrap(completedInputRef.current, owner.input))
        return { completed: true };
      const run = { owner };
      dispatch({ run, type: "run-started" });
      const promise = bootstrapAttempt(
        { logError: input.logError, runBootstrap: input.runBootstrap },
        owner,
        run,
        authority,
        dispatch,
        () => {
          completedInputRef.current = owner.input;
        },
      ).finally(() => {
        if (inFlightRef.current?.promise === promise)
          inFlightRef.current = null;
      });
      inFlightRef.current = { owner, run, promise };
      return promise;
    }, [authority, dispatch, input.logError, input.runBootstrap, stateRef]);
  return { ensureBootstrapped, completedInputRef, inFlightRef };
}

function matchesCompletedBootstrap(
  completed: SystemBootstrapRunInput | null,
  next: SystemBootstrapRunInput,
): boolean {
  // Snapshot objects change during ordinary runtime publication. Only reuse a
  // completed target within the SDK, domain and store that actually ran it.
  return (
    completed !== null &&
    completed.targetKey === next.targetKey &&
    completed.tearleads === next.tearleads &&
    completed.appData.state.domainScope === next.appData.state.domainScope &&
    completed.containerContentsStore === next.containerContentsStore
  );
}

function bootstrapAttempt(
  input: Pick<SystemBootstrapControllerInput, "runBootstrap" | "logError">,
  owner: BootstrapOwner,
  run: object,
  authority: ReturnType<typeof useBootstrapAuthority>,
  dispatch: BootstrapMachinePort["dispatch"],
  complete: () => void,
): Promise<SystemBootstrapResult> {
  const superseded = () => {
    if (authority.isCurrent(owner)) return false;
    if (authority.mountedRef.current)
      dispatch({
        inputMissing: authority.latestRef.current === null,
        run,
        type: "run-superseded",
      });
    return true;
  };
  // Publish the flight before calling work that can synchronously notify.
  return Promise.resolve()
    .then(() => {
      if (!authority.isCurrent(owner)) return false;
      return input.runBootstrap(owner.input);
    })
    .then((completed): SystemBootstrapResult => {
      if (superseded()) return { completed: false, skipped: true };
      if (completed) {
        complete();
        dispatch({ run, type: "run-succeeded" });
        return { completed: true };
      }
      dispatch({ run, type: "run-incomplete" });
      return { completed: false };
    })
    .catch((error: unknown): SystemBootstrapResult => {
      if (superseded()) return { completed: false, error };
      input.logError("Failed to bootstrap system containers", error);
      dispatch({ error, run, type: "run-failed" });
      return { completed: false, error };
    });
}

function useBootstrapMachine(enabled: boolean) {
  const [state, setState] = useState(() =>
    initialSystemBootstrapState(enabled),
  );
  const stateRef = useRef(state);
  const dispatch = useCallback((event: SystemBootstrapEvent) => {
    const next = transitionSystemBootstrap(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);
  return { state, stateRef, dispatch };
}

function toContextValue(
  state: SystemBootstrapState,
  ensureBootstrapped: () => Promise<SystemBootstrapResult>,
): SystemBootstrapContextValue {
  return {
    ensureBootstrapped,
    error: state.status === "error" ? state.error : null,
    // Only the first provisioning run gates the UI. Re-runs after a completed
    // bootstrap (e.g. a container converging local-only -> synced re-keys the
    // target) reconcile in the background without blanking an open mini-app.
    isBootstrapping:
      state.status === "running" && !hasSystemBootstrapCompleted(state),
    status: state.status,
  };
}
