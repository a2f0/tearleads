const EMAIL_PREFIX = 'smtp:email:';
const EMAIL_LIST_PREFIX = 'smtp:emails:';
const EMAIL_USERS_PREFIX = 'smtp:email:users:';

export const EMAIL_DELETE_SCRIPT = `
local usersKey = KEYS[1]
local listKey = KEYS[2]
local emailKey = KEYS[3]
local userId = ARGV[1]
local emailId = ARGV[2]

if redis.call('SISMEMBER', usersKey, userId) == 0 then
  return 0
end

redis.call('SREM', usersKey, userId)
redis.call('LREM', listKey, 1, emailId)
local remaining = redis.call('SCARD', usersKey)
if remaining == 0 then
  redis.call('DEL', emailKey)
  redis.call('DEL', usersKey)
end

return 1
`;

interface EmailAddress {
  address: string;
  name?: string;
}

export interface StoredEmail {
  id: string;
  envelope: {
    mailFrom: EmailAddress | false;
    rcptTo: EmailAddress[];
  };
  rawData: string;
  receivedAt: string;
  size: number;
}

export interface EmailListItem {
  id: string;
  from: string;
  to: string[];
  subject: string;
  receivedAt: string;
  size: number;
}

export const getEmailListKey = (userId: string): string =>
  `${EMAIL_LIST_PREFIX}${userId}`;

export const getEmailUsersKey = (emailId: string): string =>
  `${EMAIL_USERS_PREFIX}${emailId}`;

export const getEmailKey = (emailId: string): string =>
  `${EMAIL_PREFIX}${emailId}`;

export function extractSubject(rawData: string): string {
  const lines = rawData.split('\n');
  for (const line of lines) {
    if (line.toLowerCase().startsWith('subject:')) {
      return line.slice(8).trim();
    }
    if (line.trim() === '') {
      break;
    }
  }
  return '';
}

export function formatEmailAddress(addr: EmailAddress | false): string {
  if (!addr) {
    return '';
  }
  if (addr.name) {
    return `${addr.name} <${addr.address}>`;
  }
  return addr.address;
}
