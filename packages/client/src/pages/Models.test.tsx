import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Models } from './Models';

// Mock web-llm cache functions
vi.mock('@mlc-ai/web-llm', () => ({
  hasModelInCache: vi.fn().mockResolvedValue(false),
  deleteModelInCache: vi.fn().mockResolvedValue(undefined)
}));

import { deleteModelInCache, hasModelInCache } from '@mlc-ai/web-llm';

const mockHasModelInCache = vi.mocked(hasModelInCache);
const mockDeleteModelInCache = vi.mocked(deleteModelInCache);

// Mock useLLM hook
const mockLoadModel = vi.fn();
const mockUnloadModel = vi.fn();
const mockIsWebGPUSupported = vi.fn();

vi.mock('@/hooks/useLLM', () => ({
  useLLM: vi.fn(() => ({
    engine: null,
    loadedModel: null,
    isLoading: false,
    loadProgress: null,
    error: null,
    loadModel: mockLoadModel,
    unloadModel: mockUnloadModel,
    isWebGPUSupported: mockIsWebGPUSupported
  }))
}));

import { useLLM } from '@/hooks/useLLM';

function renderModels() {
  return render(
    <MemoryRouter>
      <Models />
    </MemoryRouter>
  );
}

describe('Models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsWebGPUSupported.mockResolvedValue(true);
    mockHasModelInCache.mockResolvedValue(false);
    mockDeleteModelInCache.mockResolvedValue(undefined);
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      renderModels();

      expect(screen.getByText('Models')).toBeInTheDocument();
    });

    it('renders the description text', async () => {
      renderModels();

      expect(
        screen.getByText(/Download and run LLMs locally/)
      ).toBeInTheDocument();
    });

    it('renders model cards', async () => {
      renderModels();

      await waitFor(() => {
        expect(screen.getByText('Llama 3.2 1B Instruct')).toBeInTheDocument();
        expect(screen.getByText('Llama 3.2 3B Instruct')).toBeInTheDocument();
        expect(screen.getByText('Phi 3.5 Mini')).toBeInTheDocument();
      });
    });

    it('shows model sizes and descriptions', async () => {
      renderModels();

      await waitFor(() => {
        expect(screen.getByText(/~700MB/)).toBeInTheDocument();
        expect(screen.getByText(/~1.8GB/)).toBeInTheDocument();
      });
    });
  });

  describe('WebGPU support', () => {
    it('shows error message when WebGPU is not supported', async () => {
      mockIsWebGPUSupported.mockResolvedValue(false);

      renderModels();

      await waitFor(() => {
        expect(screen.getByText('WebGPU Not Supported')).toBeInTheDocument();
        expect(
          screen.getByText(/Your browser does not support WebGPU/)
        ).toBeInTheDocument();
      });
    });

    it('shows checking message while determining WebGPU support', () => {
      mockIsWebGPUSupported.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderModels();

      expect(
        screen.getByText('Checking WebGPU support...')
      ).toBeInTheDocument();
    });
  });

  describe('model loading', () => {
    it('shows download button for models not downloaded', async () => {
      renderModels();

      await waitFor(() => {
        const downloadButtons = screen.getAllByRole('button', {
          name: /download/i
        });
        expect(downloadButtons.length).toBeGreaterThan(0);
      });
    });

    it('calls loadModel when download button is clicked', async () => {
      const user = userEvent.setup();
      renderModels();

      await waitFor(() => {
        expect(screen.getByText('Llama 3.2 1B Instruct')).toBeInTheDocument();
      });

      const downloadButtons = screen.getAllByRole('button', {
        name: /download/i
      });
      expect(downloadButtons.length).toBeGreaterThan(0);
      // biome-ignore lint/style/noNonNullAssertion: checked above
      await user.click(downloadButtons[0]!);

      expect(mockLoadModel).toHaveBeenCalled();
    });

    it('shows loading button when model is being downloaded', async () => {
      // To test the loading state, we need to simulate:
      // 1. User clicks download -> sets loadingModelId in component state
      // 2. Hook's isLoading becomes true -> getModelStatus returns 'downloading'
      //
      // We achieve this by making loadModel not resolve immediately,
      // then updating the mock to show isLoading: true, triggering a re-render
      let resolveLoad: (() => void) | undefined;
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });

      const loadModelMock = vi.fn().mockImplementation(() => loadPromise);

      // Start with isLoading: false
      vi.mocked(useLLM).mockReturnValue({
        engine: null,
        loadedModel: null,
        isLoading: false,
        loadProgress: null,
        error: null,
        loadModel: loadModelMock,
        unloadModel: mockUnloadModel,
        isWebGPUSupported: mockIsWebGPUSupported
      });

      const user = userEvent.setup();
      const { rerender } = render(
        <MemoryRouter>
          <Models />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Llama 3.2 1B Instruct')).toBeInTheDocument();
      });

      // Click the download button - this sets loadingModelId in component state
      const downloadButtons = screen.getAllByRole('button', {
        name: /download/i
      });
      expect(downloadButtons.length).toBeGreaterThan(0);
      // biome-ignore lint/style/noNonNullAssertion: checked above
      await user.click(downloadButtons[0]!);

      // Now update the mock to show loading state and re-render
      vi.mocked(useLLM).mockReturnValue({
        engine: null,
        loadedModel: null,
        isLoading: true,
        loadProgress: { text: 'Downloading weights...', progress: 0.45 },
        error: null,
        loadModel: loadModelMock,
        unloadModel: mockUnloadModel,
        isWebGPUSupported: mockIsWebGPUSupported
      });

      // Trigger re-render
      rerender(
        <MemoryRouter>
          <Models />
        </MemoryRouter>
      );

      // Verify the loading button is shown
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /loading/i })
        ).toBeInTheDocument();
      });

      // Cleanup: resolve the promise to prevent hanging
      resolveLoad?.();
    });

    it('shows loaded badge when model is loaded', async () => {
      vi.mocked(useLLM).mockReturnValue({
        engine: {} as ReturnType<typeof useLLM>['engine'],
        loadedModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
        isLoading: false,
        loadProgress: null,
        error: null,
        loadModel: mockLoadModel,
        unloadModel: mockUnloadModel,
        isWebGPUSupported: mockIsWebGPUSupported
      });

      renderModels();

      await waitFor(() => {
        expect(screen.getByText('Loaded')).toBeInTheDocument();
      });
    });

    it('shows unload button for loaded model', async () => {
      vi.mocked(useLLM).mockReturnValue({
        engine: {} as ReturnType<typeof useLLM>['engine'],
        loadedModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
        isLoading: false,
        loadProgress: null,
        error: null,
        loadModel: mockLoadModel,
        unloadModel: mockUnloadModel,
        isWebGPUSupported: mockIsWebGPUSupported
      });

      renderModels();

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /unload/i })
        ).toBeInTheDocument();
      });
    });

    it('calls unloadModel when unload button is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(useLLM).mockReturnValue({
        engine: {} as ReturnType<typeof useLLM>['engine'],
        loadedModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
        isLoading: false,
        loadProgress: null,
        error: null,
        loadModel: mockLoadModel,
        unloadModel: mockUnloadModel,
        isWebGPUSupported: mockIsWebGPUSupported
      });

      renderModels();

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /unload/i })
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /unload/i }));

      expect(mockUnloadModel).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('displays error message when there is an error', async () => {
      vi.mocked(useLLM).mockReturnValue({
        engine: null,
        loadedModel: null,
        isLoading: false,
        loadProgress: null,
        error: 'Failed to load model: Network error',
        loadModel: mockLoadModel,
        unloadModel: mockUnloadModel,
        isWebGPUSupported: mockIsWebGPUSupported
      });

      renderModels();

      await waitFor(() => {
        expect(
          screen.getByText('Failed to load model: Network error')
        ).toBeInTheDocument();
      });
    });
  });

  describe('model cache persistence', () => {
    it('checks cache for all models on mount', async () => {
      renderModels();

      await waitFor(() => {
        // Should check cache for each recommended model
        expect(mockHasModelInCache).toHaveBeenCalledWith(
          'Llama-3.2-1B-Instruct-q4f16_1-MLC'
        );
        expect(mockHasModelInCache).toHaveBeenCalledWith(
          'Llama-3.2-3B-Instruct-q4f16_1-MLC'
        );
        expect(mockHasModelInCache).toHaveBeenCalledWith(
          'Phi-3.5-mini-instruct-q4f16_1-MLC'
        );
      });
    });

    it('shows Ready status for cached models', async () => {
      // Only the first model is cached
      mockHasModelInCache.mockImplementation((modelId: string) =>
        Promise.resolve(modelId === 'Llama-3.2-1B-Instruct-q4f16_1-MLC')
      );

      renderModels();

      await waitFor(() => {
        // First model should show "Ready" and "Load" button
        expect(screen.getByText('Ready')).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: /^Load$/i })
        ).toBeInTheDocument();
      });
    });

    it('shows Load button instead of Download for cached models', async () => {
      mockHasModelInCache.mockResolvedValue(true);

      renderModels();

      await waitFor(() => {
        // All models are cached, so no Download buttons
        expect(
          screen.queryByRole('button', { name: /download/i })
        ).not.toBeInTheDocument();
        // Should have Load buttons instead
        const loadButtons = screen.getAllByRole('button', { name: /^Load$/i });
        expect(loadButtons.length).toBeGreaterThan(0);
      });
    });

    it('shows delete button for cached models', async () => {
      mockHasModelInCache.mockImplementation((modelId: string) =>
        Promise.resolve(modelId === 'Llama-3.2-1B-Instruct-q4f16_1-MLC')
      );

      renderModels();

      await waitFor(() => {
        // Should have a delete button (trash icon) for the cached model
        const deleteButtons = screen.getAllByRole('button');
        // Look for button that contains trash icon (it's an icon button without text)
        const trashButton = deleteButtons.find(
          (btn) => btn.querySelector('svg.lucide-trash-2') !== null
        );
        expect(trashButton).toBeDefined();
      });
    });

    it('calls deleteModelInCache when delete button is clicked', async () => {
      const user = userEvent.setup();
      mockHasModelInCache.mockImplementation((modelId: string) =>
        Promise.resolve(modelId === 'Llama-3.2-1B-Instruct-q4f16_1-MLC')
      );

      renderModels();

      await waitFor(() => {
        expect(screen.getByText('Ready')).toBeInTheDocument();
      });

      // Find and click the delete button (trash icon)
      const deleteButtons = screen.getAllByRole('button');
      const trashButton = deleteButtons.find(
        (btn) => btn.querySelector('svg.lucide-trash-2') !== null
      );
      expect(trashButton).toBeDefined();
      if (trashButton) {
        await user.click(trashButton);
      }

      expect(mockDeleteModelInCache).toHaveBeenCalledWith(
        'Llama-3.2-1B-Instruct-q4f16_1-MLC'
      );
    });
  });
});
