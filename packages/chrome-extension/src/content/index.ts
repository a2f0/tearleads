import { MessageType, type PingResponse } from '../messages';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MessageType.PING) {
    const response: PingResponse = { status: 'ok' };
    sendResponse(response);
  }
});
