import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import { Models } from './Models';

// Mock WebGPU API
const mockGPUAdapter = {
  info: {
    device: 'Apple M2',
    vendor: 'apple',
    architecture: 'gpu'
  },
  limits: {
    maxBufferSize: 4294967296,
    maxStorageBufferBindingSize: 134217728,
    maxComputeWorkgroupStorageSize: 32768,
    maxComputeInvocationsPerWorkgroup: 1024
  },
  requestDevice: vi.fn()
};

// Mock useLLM hook
const mockLoadModel = vi.fn();
const mockUnloadModel = vi.fn();
const mockIsWebGPUSupported = vi.fn();
const mockGenerate = vi.fn();
const mockClassify = vi.fn();
const mockAbort = vi.fn();

vi.mock('@/hooks/llm', () => ({
  useLLM: vi.fn(() => ({
    loadedModel: null,
    modelType: null,
    isLoading: false,
    loadProgress: null,
    error: null,
    isClassifying: false,
    loadModel: mockLoadModel,
    unloadModel: mockUnloadModel,
    generate: mockGenerate,
    classify: mockClassify,
    abort: mockAbort,
    isWebGPUSupported: mockIsWebGPUSupported,
    previouslyLoadedModel: null
  }))
}));

function renderModels() {
  return render(
    <MemoryRouter>
      <Models />
    </MemoryRouter>
  );
}

describe('cached models', () => {
  const mockCacheStorage = {
    keys: vi.fn(),
    open: vi.fn(),
    has: vi.fn()
  };

  const mockCache = {
    keys: vi.fn(),
    delete: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsWebGPUSupported.mockResolvedValue(true);

    // Setup WebGPU mock
    Object.defineProperty(navigator, 'gpu', {
      value: {
        requestAdapter: vi.fn().mockResolvedValue(mockGPUAdapter)
      },
      writable: true,
      configurable: true
    });

    Object.defineProperty(window, 'caches', {
      value: mockCacheStorage,
      writable: true,
      configurable: true
    });
    mockCacheStorage.keys.mockResolvedValue([]);
    mockCacheStorage.open.mockResolvedValue(mockCache);
    mockCacheStorage.has.mockResolvedValue(false);
    mockCache.keys.mockResolvedValue([]);
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'gpu', {
      value: undefined,
      writable: true,
      configurable: true
    });
    Object.defineProperty(window, 'caches', {
      value: undefined,
      writable: true,
      configurable: true
    });
  });

  it('shows Load button for cached models', async () => {
    // Mock a cached model in transformers-cache
    mockCacheStorage.has.mockResolvedValue(true);
    mockCache.keys.mockResolvedValue([
      {
        url: 'https://huggingface.co/onnx-community/Phi-3.5-mini-instruct-onnx-web/resolve/main/model.onnx'
      }
    ]);

    renderModels();

    await waitFor(() => {
      // The Phi 3.5 model should show "Load" instead of "Download"
      expect(
        screen.getByRole('button', { name: /^Load$/i })
      ).toBeInTheDocument();
    });
  });

  it('shows Downloaded badge for cached models', async () => {
    // Mock a cached model in transformers-cache
    mockCacheStorage.has.mockResolvedValue(true);
    mockCache.keys.mockResolvedValue([
      {
        url: 'https://huggingface.co/onnx-community/Phi-3.5-mini-instruct-onnx-web/resolve/main/model.onnx'
      }
    ]);

    renderModels();

    await waitFor(() => {
      expect(screen.getByText('Downloaded')).toBeInTheDocument();
    });
  });

  it('shows Download button for non-cached models', async () => {
    // No models cached (has returns false by default in beforeEach)
    renderModels();

    await waitFor(() => {
      // All models should show "Download" buttons
      const downloadButtons = screen.getAllByRole('button', {
        name: /download/i
      });
      expect(downloadButtons.length).toBe(4); // All recommended local models
    });
  });

  it('calls loadModel when Load button is clicked for cached model', async () => {
    const user = userEvent.setup();

    // Mock a cached model in transformers-cache
    mockCacheStorage.has.mockResolvedValue(true);
    mockCache.keys.mockResolvedValue([
      {
        url: 'https://huggingface.co/onnx-community/Phi-3.5-mini-instruct-onnx-web/resolve/main/model.onnx'
      }
    ]);

    renderModels();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /^Load$/i })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^Load$/i }));

    expect(mockLoadModel).toHaveBeenCalledWith(
      'onnx-community/Phi-3.5-mini-instruct-onnx-web'
    );
  });

  it('handles cache API not available gracefully', async () => {
    const consoleSpy = mockConsoleError();
    Object.defineProperty(window, 'caches', {
      value: undefined,
      writable: true,
      configurable: true
    });

    renderModels();

    await waitFor(() => {
      // Should still render with Download buttons
      const downloadButtons = screen.getAllByRole('button', {
        name: /download/i
      });
      expect(downloadButtons.length).toBe(4);
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to check model cache:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('shows delete button for cached models', async () => {
    // Mock a cached model in transformers-cache
    mockCacheStorage.has.mockResolvedValue(true);
    mockCache.keys.mockResolvedValue([
      {
        url: 'https://huggingface.co/onnx-community/Phi-3.5-mini-instruct-onnx-web/resolve/main/model.onnx'
      }
    ]);

    renderModels();

    await waitFor(() => {
      // Should show delete button (trash icon) for cached model
      const deleteButton = screen.getByTitle('Delete from cache');
      expect(deleteButton).toBeInTheDocument();
    });
  });

  it('does not show delete button for non-cached models', async () => {
    // No models cached
    mockCacheStorage.has.mockResolvedValue(false);
    mockCache.keys.mockResolvedValue([]);

    renderModels();

    await waitFor(() => {
      expect(screen.getByText('Phi 3.5 Mini')).toBeInTheDocument();
    });

    // Should not show any delete buttons
    expect(screen.queryByTitle('Delete from cache')).not.toBeInTheDocument();
  });

  it('removes model from cache when delete button is clicked', async () => {
    const user = userEvent.setup();

    // Mock a cached model in transformers-cache
    mockCacheStorage.has.mockResolvedValue(true);
    const cachedRequest = {
      url: 'https://huggingface.co/onnx-community/Phi-3.5-mini-instruct-onnx-web/resolve/main/model.onnx'
    };
    mockCache.keys.mockResolvedValue([cachedRequest]);
    mockCache.delete.mockResolvedValue(true);

    renderModels();

    await waitFor(() => {
      expect(screen.getByTitle('Delete from cache')).toBeInTheDocument();
    });

    await user.click(screen.getByTitle('Delete from cache'));

    await waitFor(() => {
      expect(mockCache.delete).toHaveBeenCalledWith(cachedRequest);
    });
  });

  it('updates UI to show Download button after deleting cached model', async () => {
    const user = userEvent.setup();

    // Mock a cached model in transformers-cache
    mockCacheStorage.has.mockResolvedValue(true);
    const cachedRequest = {
      url: 'https://huggingface.co/onnx-community/Phi-3.5-mini-instruct-onnx-web/resolve/main/model.onnx'
    };
    mockCache.keys.mockResolvedValue([cachedRequest]);
    mockCache.delete.mockResolvedValue(true);

    renderModels();

    // Wait for the cached model to show with Delete and Downloaded badge
    await waitFor(() => {
      expect(screen.getByTitle('Delete from cache')).toBeInTheDocument();
      expect(screen.getByText('Downloaded')).toBeInTheDocument();
    });

    // Get the Phi 3.5 model card container by finding the delete button's parent
    const deleteButton = screen.getByTitle('Delete from cache');
    const modelCard = deleteButton.closest('.bg-card');

    // Verify we're on the right card before deletion
    expect(modelCard).toBeInTheDocument();
    expect(
      modelCard?.querySelector('[class*="lucide-play"]')
    ).toBeInTheDocument();

    await user.click(deleteButton);

    // Wait for the cache delete to be called
    await waitFor(() => {
      expect(mockCache.delete).toHaveBeenCalled();
    });

    // After deletion, the Phi 3.5 card should show Download button (with download icon)
    // instead of Load button (with play icon)
    await waitFor(
      () => {
        expect(
          modelCard?.querySelector('[class*="lucide-download"]')
        ).toBeInTheDocument();
        expect(
          modelCard?.querySelector('[class*="lucide-play"]')
        ).not.toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });
});
