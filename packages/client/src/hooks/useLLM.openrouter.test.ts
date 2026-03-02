import {
  DEFAULT_OPENROUTER_MODEL_ID,
  OPENROUTER_CHAT_MODELS
} from '@tearleads/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockOpenChatCompletions = vi.fn();

// Mock the worker
const mockPostMessage = vi.fn();

vi.mock('../workers/llmWorker.ts', () => ({}));

vi.mock('@tearleads/api-client/chatCompletions', () => ({
  openChatCompletions: (...args: unknown[]) => mockOpenChatCompletions(...args)
}));

// Mock Worker constructor
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage = mockPostMessage;
  terminate = vi.fn();
}

// Mock database
vi.mock('@/db', () => ({
  getDatabase: vi.fn().mockReturnValue(null),
  getCurrentInstanceId: vi.fn().mockReturnValue('test-instance-id')
}));

// Mock useAppLifecycle
vi.mock('./app/useAppLifecycle', () => ({
  saveLastLoadedModel: vi.fn(),
  getLastLoadedModel: vi.fn().mockReturnValue(null),
  clearLastLoadedModel: vi.fn()
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}));

describe('useLLM OpenRouter models', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('Worker', MockWorker);
    localStorage.removeItem('auth_token');
    mockOpenChatCompletions.mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Remote reply'
          }
        }
      ]
    });
    // Mock WebGPU
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({})
      }
    });
    const { getLastLoadedModel } = await import('./app/useAppLifecycle');
    vi.mocked(getLastLoadedModel).mockReturnValue(null);
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const getVisionOpenRouterModelId = () => {
    const visionModel = OPENROUTER_CHAT_MODELS.find((model) => model.isVision);
    if (!visionModel) {
      throw new Error('Expected a vision OpenRouter model in the list');
    }
    return visionModel.id;
  };

  it('loads OpenRouter models without using the worker', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    const { useLLM } = await import('./llm');
    const { result } = renderHook(() => useLLM());

    await act(async () => {
      await result.current.loadModel(DEFAULT_OPENROUTER_MODEL_ID);
    });

    expect(result.current.loadedModel).toBe(DEFAULT_OPENROUTER_MODEL_ID);
    expect(result.current.modelType).toBe('chat');
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('loads OpenRouter vision models as vision type', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    const { useLLM } = await import('./llm');
    const { result } = renderHook(() => useLLM());

    const visionModelId = getVisionOpenRouterModelId();

    await act(async () => {
      await result.current.loadModel(visionModelId);
    });

    expect(result.current.loadedModel).toBe(visionModelId);
    expect(result.current.modelType).toBe('vision');
  });

  it('generates responses via the OpenRouter Connect endpoint', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost');

    const { useLLM } = await import('./llm');
    const { result } = renderHook(() => useLLM());

    await act(async () => {
      await result.current.loadModel(DEFAULT_OPENROUTER_MODEL_ID);
    });

    const onToken = vi.fn();
    await act(async () => {
      await result.current.generate(
        [{ role: 'user', content: 'Hello' }],
        onToken
      );
    });

    expect(onToken).toHaveBeenCalledWith('Remote reply');
    expect(mockOpenChatCompletions).toHaveBeenCalledTimes(1);
    expect(mockOpenChatCompletions).toHaveBeenCalledWith(
      expect.objectContaining({
        apiBaseUrl: 'http://localhost',
        token: null,
        body: expect.objectContaining({
          model: DEFAULT_OPENROUTER_MODEL_ID,
          messages: [{ role: 'user', content: 'Hello' }],
          tools: expect.any(Array),
          tool_choice: 'auto'
        })
      })
    );
  });

  it('includes the auth header when available for OpenRouter requests', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.setItem('auth_token', 'test-token');

    const { useLLM } = await import('./llm');
    const { result } = renderHook(() => useLLM());

    await act(async () => {
      await result.current.loadModel(DEFAULT_OPENROUTER_MODEL_ID);
    });

    const onToken = vi.fn();
    await act(async () => {
      await result.current.generate(
        [{ role: 'user', content: 'Hello' }],
        onToken
      );
    });

    expect(onToken).toHaveBeenCalledWith('Remote reply');
    expect(mockOpenChatCompletions).toHaveBeenCalledTimes(1);
    expect(mockOpenChatCompletions).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'Bearer test-token'
      })
    );
    localStorage.removeItem('auth_token');
  });

  it('sends image attachments for OpenRouter vision models', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    mockOpenChatCompletions.mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Vision reply'
          }
        }
      ]
    });

    const { useLLM } = await import('./llm');
    const { result } = renderHook(() => useLLM());

    const visionModelId = getVisionOpenRouterModelId();

    await act(async () => {
      await result.current.loadModel(visionModelId);
    });

    const onToken = vi.fn();
    await act(async () => {
      await result.current.generate(
        [{ role: 'user', content: 'What is in this image?' }],
        onToken,
        'data:image/png;base64,test-image'
      );
    });

    expect(onToken).toHaveBeenCalledWith('Vision reply');
    expect(mockOpenChatCompletions).toHaveBeenCalledTimes(1);
    expect(mockOpenChatCompletions).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          model: visionModelId,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What is in this image?' },
                {
                  type: 'image_url',
                  image_url: { url: 'data:image/png;base64,test-image' }
                }
              ]
            }
          ],
          tools: expect.any(Array),
          tool_choice: 'auto'
        })
      })
    );
  });

  it('logs OpenRouter API errors in dev', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    mockOpenChatCompletions.mockRejectedValue(new Error('API error: 500 Boom'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { useLLM } = await import('./llm');
    const { result } = renderHook(() => useLLM());

    await act(async () => {
      await result.current.loadModel(DEFAULT_OPENROUTER_MODEL_ID);
    });

    await act(async () => {
      await expect(
        result.current.generate([{ role: 'user', content: 'Hello' }], vi.fn())
      ).rejects.toThrow('API error: 500 Boom');
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'OpenRouter chat API error',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});
