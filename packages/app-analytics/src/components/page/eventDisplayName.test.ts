import { describe, expect, it } from 'vitest';
import { getEventDisplayName } from './eventDisplayName';

describe('getEventDisplayName', () => {
  it('maps common prefixes and title-cases tokens', () => {
    expect(getEventDisplayName('db_setup')).toBe('Database Setup');
    expect(getEventDisplayName('api_get_ping')).toBe('API Ping');
    expect(getEventDisplayName('api_get_auth_sessions')).toBe(
      'API Get Auth Sessions'
    );
    expect(getEventDisplayName('llm_prompt_text')).toBe('LLM Text Prompt');
    expect(getEventDisplayName('llm_prompt_multimodal')).toBe(
      'LLM Prompt Multimodal'
    );
  });

  it('keeps values without delimiters unchanged', () => {
    expect(getEventDisplayName('customEvent')).toBe('customEvent');
  });
});
