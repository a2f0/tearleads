import {
  DEFAULT_OPENROUTER_MODEL_ID,
  OPENROUTER_CHAT_MODELS
} from '@tearleads/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the worker
const mockPostMessage = vi.fn();

vi.mock('../workers/llmWorker.ts', () => ({}));

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
vi.mock('./useAppLifecycle', () => ({
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
    // Mock WebGPU
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({})
      }
    });
    const { getLastLoadedModel } = await import('./useAppLifecycle');
    vi.mocked(getLastLoadedModel).mockReturnValue(null);
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
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
    vi.unstubAllEnvs();
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
    vi.unstubAllEnvs();
  });

  it('generates responses via the OpenRouter API', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Remote reply'
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', mockFetch);

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
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })
    );
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('includes the auth header when available for OpenRouter requests', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.setItem('auth_token', 'test-token');
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Remote reply'
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', mockFetch);

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
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token'
        }
      })
    );
    localStorage.removeItem('auth_token');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends image attachments for OpenRouter vision models', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Vision reply'
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', mockFetch);

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
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const call = mockFetch.mock.calls[0];
    if (!call) {
      throw new Error('Expected fetch to be called');
    }

    const requestInit = call[1];
    if (!requestInit || typeof requestInit !== 'object') {
      throw new Error('Expected fetch options to be provided');
    }

    const body = requestInit.body;
    if (typeof body !== 'string') {
      throw new Error('Expected request body to be a string');
    }

    const parsedBody = JSON.parse(body);
    expect(parsedBody).toMatchObject({
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
      ]
    });
    // Tool calling should also be included for OpenRouter
    expect(parsedBody.tools).toBeDefined();
    expect(parsedBody.tool_choice).toBe('auto');

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('logs OpenRouter API errors in dev', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'Boom'
          }
        }),
        {
          status: 500,
          statusText: 'Internal Server Error',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );
    vi.stubGlobal('fetch', mockFetch);
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
      expect.objectContaining({
        status: 500,
        statusText: 'Internal Server Error',
        url: 'http://localhost/chat/completions',
        body: {
          error: {
            message: 'Boom'
          }
        }
      })
    );

    consoleSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
