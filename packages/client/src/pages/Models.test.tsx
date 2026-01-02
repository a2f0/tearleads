import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    // Setup WebGPU mock
    Object.defineProperty(navigator, 'gpu', {
      value: {
        requestAdapter: vi.fn().mockResolvedValue(mockGPUAdapter)
      },
      writable: true,
      configurable: true
    });
  });

  afterEach(() => {
    // Clean up WebGPU mock
    Object.defineProperty(navigator, 'gpu', {
      value: undefined,
      writable: true,
      configurable: true
    });
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
        expect(screen.getByText('Phi-3.5 Mini')).toBeInTheDocument();
        expect(screen.getByText('SmolVLM 256M')).toBeInTheDocument();
        expect(screen.getByText('PaliGemma 2 3B')).toBeInTheDocument();
      });
    });

    it('shows model sizes and descriptions', async () => {
      renderModels();

      await waitFor(() => {
        expect(screen.getByText(/~2GB/)).toBeInTheDocument();
        expect(screen.getByText(/~500MB/)).toBeInTheDocument();
        expect(screen.getByText(/~3GB/)).toBeInTheDocument();
      });
    });

    it('shows vision badge for vision models', async () => {
      renderModels();

      await waitFor(() => {
        // Verify total count of vision badges
        const visionBadges = screen.getAllByText('Vision');
        expect(visionBadges.length).toBe(2);

        // Verify vision badges are on the correct model cards
        const smolVLMCard = screen
          .getByText('SmolVLM 256M')
          .closest('.rounded-lg');
        expect(smolVLMCard).toHaveTextContent('Vision');

        const paligemmaCard = screen
          .getByText('PaliGemma 2 3B')
          .closest('.rounded-lg');
        expect(paligemmaCard).toHaveTextContent('Vision');

        // Verify non-vision model doesn't have vision badge
        const phi3Card = screen.getByText('Phi-3.5 Mini').closest('.rounded-lg');
        const phi3VisionBadges = phi3Card?.querySelectorAll(
          '.text-purple-500'
        ) as NodeListOf<HTMLElement>;
        const hasVisionBadge = Array.from(phi3VisionBadges).some(
          (el) => el.textContent === 'Vision'
        );
        expect(hasVisionBadge).toBe(false);
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
        expect(screen.getByText('Phi-3.5 Mini')).toBeInTheDocument();
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
        expect(screen.getByText('Phi-3.5 Mini')).toBeInTheDocument();
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
        loadedModel: 'onnx-community/Phi-3.5-mini-instruct-onnx-web',
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
        loadedModel: 'onnx-community/Phi-3.5-mini-instruct-onnx-web',
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
        loadedModel: 'onnx-community/Phi-3.5-mini-instruct-onnx-web',
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

  describe('WebGPU info panel', () => {
    it('displays WebGPU device info when available', async () => {
      renderModels();

      await waitFor(() => {
        expect(screen.getByText('WebGPU Device')).toBeInTheDocument();
        expect(screen.getByText(/Apple M2/)).toBeInTheDocument();
        expect(screen.getByText(/apple/)).toBeInTheDocument();
      });
    });

    it('expands to show detailed limits when clicked', async () => {
      const user = userEvent.setup();
      renderModels();

      await waitFor(() => {
        expect(screen.getByText('WebGPU Device')).toBeInTheDocument();
      });

      // Click to expand
      await user.click(screen.getByText('WebGPU Device'));

      await waitFor(() => {
        expect(screen.getByText('Architecture:')).toBeInTheDocument();
        expect(screen.getByText('Max Buffer:')).toBeInTheDocument();
        expect(screen.getByText('4.00 GB')).toBeInTheDocument();
        expect(screen.getByText(/ArrayBuffer limit/)).toBeInTheDocument();
      });
    });

    it('collapses when clicked again', async () => {
      const user = userEvent.setup();
      renderModels();

      await waitFor(() => {
        expect(screen.getByText('WebGPU Device')).toBeInTheDocument();
      });

      // Click to expand
      await user.click(screen.getByText('WebGPU Device'));

      await waitFor(() => {
        expect(screen.getByText('Architecture:')).toBeInTheDocument();
      });

      // Click to collapse
      await user.click(screen.getByText('WebGPU Device'));

      await waitFor(() => {
        expect(screen.queryByText('Architecture:')).not.toBeInTheDocument();
      });
    });

    it('does not show panel when WebGPU is not available', async () => {
      Object.defineProperty(navigator, 'gpu', {
        value: undefined,
        writable: true,
        configurable: true
      });

      renderModels();

      await waitFor(() => {
        expect(screen.getByText('Models')).toBeInTheDocument();
      });

      expect(screen.queryByText('WebGPU Device')).not.toBeInTheDocument();
    });
  });
});
