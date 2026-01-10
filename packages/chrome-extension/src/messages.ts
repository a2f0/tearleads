export const MessageType = {
  GET_TAB_INFO: 'GET_TAB_INFO',
  PING: 'PING'
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export interface TabInfoResponse {
  url: string | undefined;
  title: string | undefined;
}

export interface PingResponse {
  status: 'ok';
}

export function isValidMessageType(type: unknown): type is MessageType {
  return (
    typeof type === 'string' &&
    Object.values(MessageType).includes(type as MessageType)
  );
}
