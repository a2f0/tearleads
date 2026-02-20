import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Models } from './Models';
import { ModelsContent } from './ModelsContent';

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

import { useLLM } from '@/hooks/llm';

function renderModels() {
  return render(
    <MemoryRouter>
      <Models />
    </MemoryRouter>
  );
}

function renderModelsContent(
  showBackLink = true,
  viewMode?: 'cards' | 'table'
) {
  return render(
    <MemoryRouter>
      <ModelsContent
        showBackLink={showBackLink}
        {...(viewMode ? { viewMode } : {})}
      />
    </MemoryRouter>
  );
}

describe('Models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsWebGPUSupported.mockResolvedValue(true);
    Object.defineProperty(window, 'caches', {
      value: {
        has: vi.fn().mockResolvedValue(false),
        open: vi.fn()
      },
      writable: true,
      configurable: true
    });

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
    Object.defineProperty(window, 'caches', {
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

    it('renders the table view when enabled', async () => {
      renderModelsContent(true, 'table');

      await waitFor(() => {
        expect(
          screen.getByRole('table', { name: 'Recommended Models table' })
        ).toBeInTheDocument();
      });
    });

    it('shows back link by default', async () => {
      renderModels();

      await waitFor(() => {
        expect(screen.getByTestId('back-link')).toBeInTheDocument();
      });
    });

    it('hides back link when disabled', async () => {
      renderModelsContent(false);

      await waitFor(() => {
        expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
      });
    });

    it('renders model cards', async () => {
      renderModels();

      await waitFor(() => {
        expect(screen.getByText('Phi 3.5 Mini')).toBeInTheDocument();
        expect(screen.getByText('SmolVLM 256M')).toBeInTheDocument();
        expect(screen.getByText('PaliGemma 2 3B')).toBeInTheDocument();
        expect(screen.getByText('Mistral 7B Instruct')).toBeInTheDocument();
        expect(screen.getByText('Gemma 3 4B (Free)')).toBeInTheDocument();
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
        expect(visionBadges.length).toBe(3);

        // Verify vision badges are on the correct model cards
        const smolVLMCard = screen
          .getByText('SmolVLM 256M')
          .closest('.rounded-lg');
        expect(smolVLMCard).toHaveTextContent('Vision');

        const paligemmaCard = screen
          .getByText('PaliGemma 2 3B')
          .closest('.rounded-lg');
        expect(paligemmaCard).toHaveTextContent('Vision');

        const gemmaCard = screen
          .getByText('Gemma 3 4B (Free)')
          .closest('.rounded-lg');
        expect(gemmaCard).toHaveTextContent('Vision');

        // Verify non-vision model doesn't have vision badge
        const phi3Card = screen
          .getByText('Phi 3.5 Mini')
          .closest('.rounded-lg');
        const phi3VisionBadges = phi3Card?.querySelectorAll(
          '.text-chart-4'
        ) as NodeListOf<HTMLElement>;
        const hasVisionBadge = Array.from(phi3VisionBadges).some(
          (el) => el.textContent === 'Vision'
        );
        expect(hasVisionBadge).toBe(false);
      });
    });

    it('shows Remote badge for OpenRouter models', async () => {
      renderModels();

      await waitFor(() => {
        const remoteBadges = screen.getAllByText('Remote');
        expect(remoteBadges.length).toBeGreaterThan(0);
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
        expect(screen.getByText('Mistral 7B Instruct')).toBeInTheDocument();
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
        classify: mockClassify,
        abort: mockAbort,
        isWebGPUSupported: mockIsWebGPUSupported,
        isClassifying: false,
        previouslyLoadedModel: null
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
