import { describe, expect, it, vi } from 'vitest';

vi.mock('@tearleads/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tearleads/shared')>();
  return {
    ...actual,
    OPENROUTER_CHAT_MODELS: [
      {
        id: 'mock-model',
        name: 'Mock Model',
        description: 'Mock',
        isFree: true
      }
    ]
  };
});

describe('models', () => {
  it('defaults OpenRouter vision flag when missing', async () => {
    const { OPENROUTER_MODELS } = await import('./models');

    expect(OPENROUTER_MODELS[0]?.isVision).toBe(false);
  });
});
