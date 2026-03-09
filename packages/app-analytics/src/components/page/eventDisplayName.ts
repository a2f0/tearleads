const TOKEN_MAP: Record<string, string> = {
  db: 'Database',
  api: 'API',
  llm: 'LLM',
  vfs: 'VFS',
  ai: 'AI',
  id: 'ID',
  sdk: 'SDK',
  sql: 'SQL',
  csv: 'CSV'
};

const EVENT_NAME_OVERRIDES: Record<string, string> = {
  api_get_ping: 'API Ping',
  llm_prompt_text: 'LLM Text Prompt'
};

function toWord(token: string): string {
  const mapped = TOKEN_MAP[token];
  if (mapped) {
    return mapped;
  }
  if (token.length === 0) {
    return token;
  }
  return token.charAt(0).toUpperCase() + token.slice(1);
}

export function getEventDisplayName(eventName: string): string {
  const override = EVENT_NAME_OVERRIDES[eventName];
  if (override) {
    return override;
  }
  if (!eventName.includes('_')) {
    return eventName;
  }
  return eventName
    .split('_')
    .map((token) => toWord(token))
    .join(' ');
}
