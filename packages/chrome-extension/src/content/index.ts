import { MessageType, type PingResponse } from '../messages';

declare global {
  var __tearleadsContentScriptInitialized: boolean | undefined;
}

function isPingMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === MessageType.PING
  );
}

export function initializeContentScript(): void {
  if (globalThis.__tearleadsContentScriptInitialized) {
    return;
  }

  globalThis.__tearleadsContentScriptInitialized = true;

  globalThis.chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (!isPingMessage(message)) {
        return false;
      }

      const response: PingResponse = { status: 'ok' };
      sendResponse(response);
      return true;
    }
  );
}

initializeContentScript();
