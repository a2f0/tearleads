export enum MessageType {
  GET_TAB_INFO = 'GET_TAB_INFO',
  PING = 'PING',
  INJECT_CONTENT_SCRIPT = 'INJECT_CONTENT_SCRIPT'
}

export interface TabInfoRequest {
  type: MessageType.GET_TAB_INFO;
}

export interface TabInfoResponse {
  url: string | undefined;
  title: string | undefined;
}

export interface PingRequest {
  type: MessageType.PING;
}

export interface PingResponse {
  status: 'ok';
}

export interface InjectContentScriptRequest {
  type: MessageType.INJECT_CONTENT_SCRIPT;
}

export interface InjectContentScriptResponse {
  status: 'injected' | 'failed';
  error?: string;
}

export type ExtensionMessage =
  | TabInfoRequest
  | PingRequest
  | InjectContentScriptRequest;

const messageTypeSet = new Set<string>(Object.values(MessageType));

export function isValidMessageType(type: unknown): type is MessageType {
  return typeof type === 'string' && messageTypeSet.has(type);
}
