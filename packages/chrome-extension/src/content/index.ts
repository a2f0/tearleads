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

if (!globalThis.__tearleadsContentScriptInitialized) {
  globalThis.__tearleadsContentScriptInitialized = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isPingMessage(message)) {
      return false;
    }

    const response: PingResponse = { status: 'ok' };
    sendResponse(response);
    return true;
  });
}
