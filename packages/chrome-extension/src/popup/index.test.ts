/**
 * @vitest-environment jsdom
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest';
import { MessageType } from '../messages';

const mockRuntimeSendMessage = vi.fn();
const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

const mockChrome = {
  runtime: {
    sendMessage: mockRuntimeSendMessage
  },
  tabs: {
    query: mockTabsQuery,
    sendMessage: mockTabsSendMessage
  }
};

vi.stubGlobal('chrome', mockChrome);

function setupDOM() {
  document.body.innerHTML = `
    <div id="page-title">Loading...</div>
    <div id="page-url">Loading...</div>
    <button id="action-btn">Take Action</button>
    <div id="status" class="status"></div>
  `;
}

function triggerDOMContentLoaded() {
  const event = new Event('DOMContentLoaded', {
    bubbles: true,
    cancelable: true
  });
  document.dispatchEvent(event);
}

describe('popup script', () => {
  let setTimeoutSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setupDOM();
    setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(() => {
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTimeoutSpy.mockRestore();
    document.body.innerHTML = '';
  });

  it('should request tab info on DOMContentLoaded', async () => {
    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback({ title: 'Test Page', url: 'https://test.com' });
    });

    await import('./index');
    triggerDOMContentLoaded();

    expect(mockRuntimeSendMessage).toHaveBeenCalledWith(
      { type: MessageType.GET_TAB_INFO },
      expect.any(Function)
    );
  });

  it('should display tab info in DOM elements', async () => {
    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback({ title: 'Test Page', url: 'https://test.com' });
    });

    await import('./index');
    triggerDOMContentLoaded();

    expect(document.getElementById('page-title')?.textContent).toBe(
      'Test Page'
    );
    expect(document.getElementById('page-url')?.textContent).toBe(
      'https://test.com'
    );
  });

  it('should display Unknown when tab info is undefined', async () => {
    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback(undefined);
    });

    await import('./index');
    triggerDOMContentLoaded();

    expect(document.getElementById('page-title')?.textContent).toBe('Unknown');
    expect(document.getElementById('page-url')?.textContent).toBe('Unknown');
  });

  it('should display Unknown when tab info properties are undefined', async () => {
    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback({ title: undefined, url: undefined });
    });

    await import('./index');
    triggerDOMContentLoaded();

    expect(document.getElementById('page-title')?.textContent).toBe('Unknown');
    expect(document.getElementById('page-url')?.textContent).toBe('Unknown');
  });

  it('should send PING message and show success status when response is ok', async () => {
    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback({ title: 'Test', url: 'https://test.com' });
    });
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 123 }]);
    });
    mockTabsSendMessage.mockImplementation((_tabId, _message, callback) => {
      callback({ status: 'ok' });
    });

    await import('./index');
    triggerDOMContentLoaded();

    const button = document.getElementById('action-btn');
    button?.click();

    expect(mockTabsQuery).toHaveBeenCalledWith(
      { active: true, currentWindow: true },
      expect.any(Function)
    );
    expect(mockTabsSendMessage).toHaveBeenCalledWith(
      123,
      { type: MessageType.PING },
      expect.any(Function)
    );

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Content script is active!');
    expect(statusEl?.className).toBe('status success');
  });

  it('should not send message if tab has no id', async () => {
    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback({ title: 'Test', url: 'https://test.com' });
    });
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{}]);
    });

    await import('./index');
    triggerDOMContentLoaded();

    const button = document.getElementById('action-btn');
    button?.click();

    expect(mockTabsSendMessage).not.toHaveBeenCalled();
  });

  it('should not send message if no tabs returned', async () => {
    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback({ title: 'Test', url: 'https://test.com' });
    });
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([]);
    });

    await import('./index');
    triggerDOMContentLoaded();

    const button = document.getElementById('action-btn');
    button?.click();

    expect(mockTabsSendMessage).not.toHaveBeenCalled();
  });

  it('should show error status if response status is not ok', async () => {
    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback({ title: 'Test', url: 'https://test.com' });
    });
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 123 }]);
    });
    mockTabsSendMessage.mockImplementation((_tabId, _message, callback) => {
      callback({ status: 'error' });
    });

    await import('./index');
    triggerDOMContentLoaded();

    const button = document.getElementById('action-btn');
    button?.click();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Content script not responding');
    expect(statusEl?.className).toBe('status error');
  });

  it('should show error status if response is undefined', async () => {
    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback({ title: 'Test', url: 'https://test.com' });
    });
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 123 }]);
    });
    mockTabsSendMessage.mockImplementation((_tabId, _message, callback) => {
      callback(undefined);
    });

    await import('./index');
    triggerDOMContentLoaded();

    const button = document.getElementById('action-btn');
    button?.click();

    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Content script not responding');
    expect(statusEl?.className).toBe('status error');
  });

  it('should handle missing DOM elements gracefully', async () => {
    document.body.innerHTML = '';
    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback({ title: 'Test', url: 'https://test.com' });
    });

    await import('./index');

    expect(() => triggerDOMContentLoaded()).not.toThrow();
  });

  it('should clear status after timeout', async () => {
    setTimeoutSpy.mockRestore();
    vi.useFakeTimers();

    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback({ title: 'Test', url: 'https://test.com' });
    });
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 123 }]);
    });
    mockTabsSendMessage.mockImplementation((_tabId, _message, callback) => {
      callback({ status: 'ok' });
    });

    await import('./index');
    triggerDOMContentLoaded();

    const button = document.getElementById('action-btn');
    button?.click();

    const statusEl = document.getElementById('status');
    expect(statusEl?.className).toBe('status success');

    vi.advanceTimersByTime(3000);

    expect(statusEl?.className).toBe('status');

    vi.useRealTimers();
  });

  it('should handle showStatus when status element is missing', async () => {
    mockRuntimeSendMessage.mockImplementation((_message, callback) => {
      callback({ title: 'Test', url: 'https://test.com' });
    });
    mockTabsQuery.mockImplementation((_query, callback) => {
      callback([{ id: 123 }]);
    });
    mockTabsSendMessage.mockImplementation((_tabId, _message, callback) => {
      callback({ status: 'ok' });
    });

    await import('./index');
    triggerDOMContentLoaded();

    document.getElementById('status')?.remove();

    const button = document.getElementById('action-btn');
    expect(() => button?.click()).not.toThrow();
  });
});
