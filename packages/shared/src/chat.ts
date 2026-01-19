import { isRecord } from './index.js';

export type ChatRole = 'assistant' | 'system' | 'tool' | 'user';

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatContent = string | ChatContentPart[];

export interface ChatMessage {
  role: ChatRole;
  content: ChatContent;
}

export type ChatMessagesValidationResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; error: string };

type ContentPartResult =
  | { ok: true; value: ChatContentPart }
  | { ok: false; error: string };

type ContentResult = { ok: true; value: ChatContent } | { ok: false; error: string };

const isChatRole = (value: unknown): value is ChatRole =>
  value === 'assistant' ||
  value === 'system' ||
  value === 'tool' ||
  value === 'user';

const parseContentPart = (
  value: unknown,
  messageIndex: number,
  partIndex: number
): ContentPartResult => {
  const prefix = `messages[${messageIndex}].content[${partIndex}]`;
  if (!isRecord(value)) {
    return { ok: false, error: `${prefix} must be an object` };
  }

  const type = value['type'];
  if (type === 'text') {
    const text = value['text'];
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, error: `${prefix}.text must be a non-empty string` };
    }
    return { ok: true, value: { type: 'text', text } };
  }

  if (type === 'image_url') {
    const imageUrl = value['image_url'];
    if (!isRecord(imageUrl)) {
      return { ok: false, error: `${prefix}.image_url must be an object` };
    }
    const url = imageUrl['url'];
    if (typeof url !== 'string' || url.trim().length === 0) {
      return {
        ok: false,
        error: `${prefix}.image_url.url must be a non-empty string`
      };
    }
    return { ok: true, value: { type: 'image_url', image_url: { url } } };
  }

  return { ok: false, error: `${prefix}.type must be "text" or "image_url"` };
};

const parseContent = (value: unknown, messageIndex: number): ContentResult => {
  const prefix = `messages[${messageIndex}].content`;
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      return { ok: false, error: `${prefix} must be a non-empty string` };
    }
    return { ok: true, value };
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: `${prefix} must be a non-empty string or array` };
  }

  if (value.length === 0) {
    return { ok: false, error: `${prefix} must be a non-empty array` };
  }

  const parts: ChatContentPart[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    const result = parseContentPart(entry, messageIndex, index);
    if (!result.ok) {
      return result;
    }
    parts.push(result.value);
  }

  return { ok: true, value: parts };
};

export const validateChatMessages = (
  value: unknown
): ChatMessagesValidationResult => {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: 'messages must be a non-empty array' };
  }

  const messages: ChatMessage[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      return { ok: false, error: `messages[${index}] must be an object` };
    }

    const role = entry['role'];
    if (!isChatRole(role)) {
      return {
        ok: false,
        error:
          'messages[' +
          index +
          '].role must be one of: system, user, assistant, tool'
      };
    }

    const contentResult = parseContent(entry['content'], index);
    if (!contentResult.ok) {
      return contentResult;
    }

    messages.push({ role, content: contentResult.value });
  }

  return { ok: true, messages };
};
