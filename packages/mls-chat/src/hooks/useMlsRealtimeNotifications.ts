export function dispatchRealtimeMessage(
  groupId: string,
  message: unknown
): void {
  const handlers = Reflect.get(globalThis, '__mlsMessageHandler');
  if (!(handlers instanceof Map)) {
    return;
  }

  const handler = handlers.get(groupId);
  if (typeof handler === 'function') {
    handler(message);
  }
}

export function notifyMembershipChange(groupId: string): void {
  const handlers = Reflect.get(globalThis, '__mlsMembershipHandler');
  if (!(handlers instanceof Map)) {
    return;
  }

  const groupHandlers = handlers.get(groupId);
  if (groupHandlers instanceof Set) {
    for (const handler of groupHandlers) {
      if (typeof handler === 'function') {
        handler();
      }
    }
    return;
  }

  if (typeof groupHandlers === 'function') {
    groupHandlers();
  }
}

export function triggerWelcomeRefresh(): void {
  const handler = Reflect.get(globalThis, '__mlsWelcomeRefreshHandler');
  if (handler instanceof Set) {
    for (const refreshHandler of handler) {
      if (typeof refreshHandler !== 'function') {
        continue;
      }
      void Promise.resolve(refreshHandler()).catch((error) => {
        console.warn('[mls-chat] Failed to refresh welcome messages', error);
      });
    }
    return;
  }

  if (typeof handler === 'function') {
    void Promise.resolve(handler()).catch((error) => {
      console.warn('[mls-chat] Failed to refresh welcome messages', error);
    });
  }
}
