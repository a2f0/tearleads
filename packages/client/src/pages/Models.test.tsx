import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Models } from './Models';

// Mock useLLM hook
const mockLoadModel = vi.fn();
const mockUnloadModel = vi.fn();
const mockIsWebGPUSupported = vi.fn();
const mockGenerate = vi.fn();
const mockAbort = vi.fn();

vi.mock('@/hooks/useLLM', () => ({
  useLLM: vi.fn(() => ({
    loadedModel: null,
    modelType: null,
    isLoading: false,
    loadProgress: null,
    error: null,
    loadModel: mockLoadModel,
    unloadModel: mockUnloadModel,
    generate: mockGenerate,
    abort: mockAbort,
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
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      renderModels();

      await waitFor(() => {
        expect(screen.getByText('Models')).toBeInTheDocument();
      });
    });

    it('renders the description text', async () => {
      renderModels();

      await waitFor(() => {
        expect(
          screen.getByText(/Download and run LLMs locally/)
        ).toBeInTheDocument();
      });
    });

    it('renders model cards', async () => {
      renderModels();

      await waitFor(() => {
        expect(screen.getByText('Phi-3 Mini')).toBeInTheDocument();
        expect(screen.getByText('Phi-3.5 Vision')).toBeInTheDocument();
      });
    });

    it('shows model sizes and descriptions', async () => {
      renderModels();

      await waitFor(() => {
        expect(screen.getByText(/~2GB/)).toBeInTheDocument();
        expect(screen.getByText(/~2.8GB/)).toBeInTheDocument();
      });
    });

    it('shows vision badge for vision model', async () => {
      renderModels();

      await waitFor(() => {
        expect(screen.getByText('Vision')).toBeInTheDocument();
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

    it('shows checking message while determining WebGPU support', async () => {
      mockIsWebGPUSupported.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderModels();

      await waitFor(() => {
        expect(
          screen.getByText('Checking WebGPU support...')
        ).toBeInTheDocument();
      });
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
        expect(screen.getByText('Phi-3 Mini')).toBeInTheDocument();
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
      let resolveLoad: (() => void) | undefined;
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });

      const loadModelMock = vi.fn().mockImplementation(() => loadPromise);

      vi.mocked(useLLM).mockReturnValue({
        loadedModel: null,
        modelType: null,
        isLoading: false,
        loadProgress: null,
        error: null,
        loadModel: loadModelMock,
        unloadModel: mockUnloadModel,
        generate: mockGenerate,
        abort: mockAbort,
        isWebGPUSupported: mockIsWebGPUSupported
      });

      const user = userEvent.setup();
      const { rerender } = render(
        <MemoryRouter>
          <Models />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Phi-3 Mini')).toBeInTheDocument();
      });

      const downloadButtons = screen.getAllByRole('button', {
        name: /download/i
      });
      expect(downloadButtons.length).toBeGreaterThan(0);
      // biome-ignore lint/style/noNonNullAssertion: checked above
      await user.click(downloadButtons[0]!);

      await act(async () => {
        vi.mocked(useLLM).mockReturnValue({
          loadedModel: null,
          modelType: null,
          isLoading: true,
          loadProgress: { text: 'Downloading weights...', progress: 0.45 },
          error: null,
          loadModel: loadModelMock,
          unloadModel: mockUnloadModel,
          generate: mockGenerate,
          abort: mockAbort,
          isWebGPUSupported: mockIsWebGPUSupported
        });

        rerender(
          <MemoryRouter>
            <Models />
          </MemoryRouter>
        );
      });

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /loading/i })
        ).toBeInTheDocument();
      });

      expect(screen.getByText('Downloading weights...')).toBeInTheDocument();

      await act(async () => {
        resolveLoad?.();
      });
    });

    it('shows loaded badge when model is loaded', async () => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'onnx-community/Phi-3-mini-4k-instruct',
        modelType: 'chat',
        isLoading: false,
        loadProgress: null,
        error: null,
        loadModel: mockLoadModel,
        unloadModel: mockUnloadModel,
        generate: mockGenerate,
        abort: mockAbort,
        isWebGPUSupported: mockIsWebGPUSupported
      });

      renderModels();

      await waitFor(() => {
        expect(screen.getByText('Loaded')).toBeInTheDocument();
      });
    });

    it('shows unload button for loaded model', async () => {
      vi.mocked(useLLM).mockReturnValue({
        loadedModel: 'onnx-community/Phi-3-mini-4k-instruct',
        modelType: 'chat',
        isLoading: false,
        loadProgress: null,
        error: null,
        loadModel: mockLoadModel,
        unloadModel: mockUnloadModel,
        generate: mockGenerate,
        abort: mockAbort,
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
        loadedModel: 'onnx-community/Phi-3-mini-4k-instruct',
        modelType: 'chat',
        isLoading: false,
        loadProgress: null,
        error: null,
        loadModel: mockLoadModel,
        unloadModel: mockUnloadModel,
        generate: mockGenerate,
        abort: mockAbort,
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
        loadedModel: null,
        modelType: null,
        isLoading: false,
        loadProgress: null,
        error: 'Failed to load model: Network error',
        loadModel: mockLoadModel,
        unloadModel: mockUnloadModel,
        generate: mockGenerate,
        abort: mockAbort,
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
});
