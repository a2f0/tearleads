import {
  type ComponentType,
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useWindowActions,
  useWindowStateData,
} from "../components/window/WindowStateProvider";

export type MiniAppId = "contacts" | "explorer" | "notes" | "org-manager";

export interface MiniAppDefinition {
  createComponent: () => ComponentType;
  title: string;
}

export interface MiniAppWindowPosition {
  x: number;
  y: number;
}

type MiniAppMessage = {
  appId: "org-manager";
  groupId: string;
  type: "open-group";
};

interface OpenMiniAppRequest {
  appId: MiniAppId;
  message?: MiniAppMessage;
  position?: MiniAppWindowPosition;
}

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

const DEFAULT_MINI_APP_POSITION = {
  x: 200,
  y: 160,
} satisfies MiniAppWindowPosition;

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
      latestMessage.message.appId !== appId
    ) {
      return;
    }

    handledSequenceRef.current = latestMessage.sequence;
    onMessage(
      latestMessage.message as Extract<MiniAppMessage, { appId: AppId }>,
    );
    acknowledgeMiniAppMessage(latestMessage.sequence);
  }, [acknowledgeMiniAppMessage, appId, latestMessage, onMessage]);
}

function findTopMiniAppWindow(
  windows: ReturnType<typeof useWindowStateData>["windows"],
  appId: MiniAppId,
) {
  return windows.reduce<(typeof windows)[number] | null>(
    (topWindow, window) => {
      if (window.appId !== appId) {
        return topWindow;
      }

      return !topWindow || window.zIndex > topWindow.zIndex
        ? window
        : topWindow;
    },
    null,
  );
}

export function MiniAppBusProvider({
  children,
  miniApps,
}: PropsWithChildren<{
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>;
}>) {
  const { bringToFront, create, restore } = useWindowActions();
  const { windows } = useWindowStateData();
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
    ({
      appId,
      message,
      position = DEFAULT_MINI_APP_POSITION,
    }: OpenMiniAppRequest) => {
      const existingWindow = findTopMiniAppWindow(windows, appId);

      if (existingWindow) {
        restore(existingWindow.id);
        bringToFront(existingWindow.id);
      } else {
        const definition = miniApps[appId];
        create(
          definition.title,
          position.x,
          position.y,
          definition.createComponent(),
          {
            appId,
          },
        );
      }

      if (message) {
        sendMiniAppMessage(message);
      }
    },
    [bringToFront, create, miniApps, restore, sendMiniAppMessage, windows],
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
