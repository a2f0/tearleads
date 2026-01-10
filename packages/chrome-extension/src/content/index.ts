import { MessageType, type PingResponse } from '../messages';

console.log('Rapid content script loaded');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MessageType.PING) {
    const response: PingResponse = { status: 'ok' };
    sendResponse(response);
  }
});
