const LAST_CONVERSATION_KEY_PREFIX = 'tearleads_last_ai_conversation';

function getLastConversationKey(instanceId?: string | null): string {
  return instanceId
    ? `${LAST_CONVERSATION_KEY_PREFIX}_${instanceId}`
    : LAST_CONVERSATION_KEY_PREFIX;
}

export function readLastConversationId(
  instanceId?: string | null
): string | null {
  try {
    return localStorage.getItem(getLastConversationKey(instanceId));
  } catch {
    return null;
  }
}

export function saveLastConversationId(
  conversationId: string,
  instanceId?: string | null
): void {
  try {
    localStorage.setItem(getLastConversationKey(instanceId), conversationId);
  } catch {
    return;
  }
}

export function clearLastConversationId(instanceId?: string | null): void {
  try {
    localStorage.removeItem(getLastConversationKey(instanceId));
  } catch {
    return;
  }
}
