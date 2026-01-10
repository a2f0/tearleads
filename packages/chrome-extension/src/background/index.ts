import { MessageType, type TabInfoResponse } from '../messages';

chrome.runtime.onInstalled.addListener(() => {
  console.log('Rapid extension installed');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MessageType.GET_TAB_INFO) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const response: TabInfoResponse = {
        url: tab?.url,
        title: tab?.title
      };
      sendResponse(response);
    });
    return true;
  }
  return false;
});
