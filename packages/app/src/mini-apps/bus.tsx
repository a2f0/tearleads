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
  acknowledgeMiniAppMessage: (sequence: number) => void;
  openMiniApp: (request: OpenMiniAppRequest) => void;
  sendMiniAppMessage: (message: MiniAppMessage) => void;
}

interface MiniAppBusMessages {
  latestMessage: MiniAppMessageEnvelope | null;
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
  const { acknowledgeMiniAppMessage } = useMiniAppBusActions();
  const { latestMessage } = useMiniAppBusMessages();
  const handledSequenceRef = useRef(0);

  useEffect(() => {
    if (
      !latestMessage ||
      latestMessage.sequence <= handledSequenceRef.current ||
      !isMiniAppMessageFor(latestMessage.message, appId)
    ) {
      return;
    }

    handledSequenceRef.current = latestMessage.sequence;
    onMessage(latestMessage.message);
    acknowledgeMiniAppMessage(latestMessage.sequence);
  }, [acknowledgeMiniAppMessage, appId, latestMessage, onMessage]);
}

export function MiniAppBusProvider({ children }: PropsWithChildren) {
  const appNavigation = useAppNavigationActions();
  const sequenceRef = useRef(0);
  const [latestMessage, setLatestMessage] =
    useState<MiniAppMessageEnvelope | null>(null);

  const sendMiniAppMessage = useCallback((message: MiniAppMessage) => {
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    setLatestMessage({ message, sequence });
  }, []);

  const acknowledgeMiniAppMessage = useCallback((sequence: number) => {
    setLatestMessage((current) =>
      current?.sequence === sequence ? null : current,
    );
  }, []);

  const openMiniApp = useCallback(
    ({ appId, message, position, reuseExisting }: OpenMiniAppRequest) => {
      appNavigation.openMiniApp({
        appId,
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
      acknowledgeMiniAppMessage,
      openMiniApp,
      sendMiniAppMessage,
    }),
    [acknowledgeMiniAppMessage, openMiniApp, sendMiniAppMessage],
  );
  const messages = useMemo(() => ({ latestMessage }), [latestMessage]);

  return (
    <MiniAppBusActionsContext.Provider value={actions}>
      <MiniAppBusMessagesContext.Provider value={messages}>
        {children}
      </MiniAppBusMessagesContext.Provider>
    </MiniAppBusActionsContext.Provider>
  );
}
