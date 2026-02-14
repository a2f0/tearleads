import {
  type ExtensionMessage,
  type InjectContentScriptResponse,
  isValidMessageType,
  MessageType,
  type TabInfoResponse
} from '../messages';

function hasMessageType(message: unknown): message is { type: unknown } {
  return typeof message === 'object' && message !== null && 'type' in message;
}

function isExtensionMessage(message: unknown): message is ExtensionMessage {
  return hasMessageType(message) && isValidMessageType(message.type);
}

function getActiveTab(
  callback: (tab: chrome.tabs.Tab | undefined) => void
): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    callback(tabs[0]);
  });
}

function handleGetTabInfo(sendResponse: (response: TabInfoResponse) => void) {
  getActiveTab((tab) => {
    const response: TabInfoResponse = {
      url: tab?.url,
      title: tab?.title
    };
    sendResponse(response);
  });
}

function handleInjectContentScript(
  sendResponse: (response: InjectContentScriptResponse) => void
) {
  getActiveTab((tab) => {
    if (tab?.id === undefined) {
      sendResponse({
        status: 'failed',
        error: 'No active tab available for script injection.'
      });
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        files: ['content.js']
      },
      () => {
        const errorMessage = chrome.runtime.lastError?.message;
        if (errorMessage) {
          sendResponse({
            status: 'failed',
            error: errorMessage
          });
          return;
        }

        sendResponse({ status: 'injected' });
      }
    );
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Tearleads extension installed');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isExtensionMessage(message)) {
    return false;
  }

  if (message.type === MessageType.GET_TAB_INFO) {
    handleGetTabInfo(sendResponse);
    return true;
  }

  if (message.type === MessageType.INJECT_CONTENT_SCRIPT) {
    handleInjectContentScript(sendResponse);
    return true;
  }

  return false;
});
