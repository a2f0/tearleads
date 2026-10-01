import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppNavigationActions } from "../navigation/AppNavigationProvider";
import type { MiniAppId, MiniAppMessage, OpenMiniAppRequest } from "./types";

interface MiniAppMessageEnvelope {
  message: MiniAppMessage;
  sequence: number;
}

interface MiniAppBusActions {
  // Claims a pending message for delivery. Returns true exactly once per
  // message, so two subscribers of the same app (or an effect React runs
  // twice) never both handle it.
  claimMiniAppMessage: (sequence: number) => boolean;
  openMiniApp: (request: OpenMiniAppRequest) => void;
  sendMiniAppMessage: (message: MiniAppMessage) => void;
}

interface MiniAppBusMessages {
  // Undelivered messages in send order. A message waits here until a
  // subscriber of its app claims it, so a burst of sends, or a send to an app
  // whose window has not mounted yet, loses nothing.
  pendingMessages: ReadonlyArray<MiniAppMessageEnvelope>;
}

function isMiniAppMessageFor<AppId extends MiniAppId>(
  message: MiniAppMessage,
  appId: AppId,
): message is Extract<MiniAppMessage, { appId: AppId }> {
  return message.appId === appId;
}

const MiniAppBusActionsContext = createContext<MiniAppBusActions | null>(null);
const MiniAppBusMessagesContext = createContext<MiniAppBusMessages | null>(
  null,
);

function useMiniAppBusMessages() {
  const context = useContext(MiniAppBusMessagesContext);
  if (!context) {
    throw new Error("useMiniAppBusMessages requires MiniAppBusProvider");
  }

  return context;
}

export function useMiniAppBusActions() {
  const context = useContext(MiniAppBusActionsContext);
  if (!context) {
    throw new Error("useMiniAppBusActions requires MiniAppBusProvider");
  }

  return context;
}

export function useMiniAppMessage<AppId extends MiniAppId>(
  appId: AppId,
  onMessage: (message: Extract<MiniAppMessage, { appId: AppId }>) => void,
) {
  const { claimMiniAppMessage } = useMiniAppBusActions();
  const { pendingMessages } = useMiniAppBusMessages();

  useEffect(() => {
    for (const { message, sequence } of pendingMessages) {
      if (
        isMiniAppMessageFor(message, appId) &&
        claimMiniAppMessage(sequence)
      ) {
        onMessage(message);
      }
    }
  }, [appId, claimMiniAppMessage, onMessage, pendingMessages]);
}

export function MiniAppBusProvider({ children }: PropsWithChildren) {
  const appNavigation = useAppNavigationActions();
  const sequenceRef = useRef(0);
  // Claims are recorded synchronously, ahead of the state update that drops
  // the message, because every subscriber's effect in one commit sees the same
  // pending snapshot. A delivered sequence leaves the snapshot on the next
  // render and is never claimed again, so its entry can be dropped then.
  const claimedRef = useRef(new Set<number>());
  const [pendingMessages, setPendingMessages] = useState<
    ReadonlyArray<MiniAppMessageEnvelope>
  >([]);

  const sendMiniAppMessage = useCallback((message: MiniAppMessage) => {
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    setPendingMessages((current) => [...current, { message, sequence }]);
  }, []);

  // Runs after every subscriber effect of the commit that rendered this
  // snapshot, so a sequence missing from it can no longer be offered.
  useEffect(() => {
    const pending = new Set(
      pendingMessages.map((envelope) => envelope.sequence),
    );
    for (const sequence of claimedRef.current) {
      if (!pending.has(sequence)) {
        claimedRef.current.delete(sequence);
      }
    }
  }, [pendingMessages]);

  const claimMiniAppMessage = useCallback((sequence: number) => {
    if (claimedRef.current.has(sequence)) {
      return false;
    }
    claimedRef.current.add(sequence);
    setPendingMessages((current) =>
      current.filter((envelope) => envelope.sequence !== sequence),
    );
    return true;
  }, []);

  const openMiniApp = useCallback(
    ({
      appId,
      message,
      pathSegments,
      position,
      reuseExisting,
    }: OpenMiniAppRequest) => {
      appNavigation.openMiniApp({
        appId,
        ...(pathSegments ? { pathSegments } : {}),
        ...(position ? { position } : {}),
        ...(reuseExisting === undefined ? {} : { reuseExisting }),
      });

      if (message) {
        sendMiniAppMessage(message);
      }
    },
    [appNavigation, sendMiniAppMessage],
  );

  const actions = useMemo(
    () => ({
      claimMiniAppMessage,
      openMiniApp,
      sendMiniAppMessage,
    }),
    [claimMiniAppMessage, openMiniApp, sendMiniAppMessage],
  );
  const messages = useMemo(() => ({ pendingMessages }), [pendingMessages]);

  return (
    <MiniAppBusActionsContext.Provider value={actions}>
      <MiniAppBusMessagesContext.Provider value={messages}>
        {children}
      </MiniAppBusMessagesContext.Provider>
    </MiniAppBusActionsContext.Provider>
  );
}
