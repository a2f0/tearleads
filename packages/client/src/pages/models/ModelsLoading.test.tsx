import { act, render, screen, waitFor, within } from '@testing-library/react';
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

describe('model loading', () => {
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
      expect(screen.getByText('Phi 3.5 Mini')).toBeInTheDocument();
    });

    const downloadButtons = screen.getAllByRole('button', {
      name: /download/i
    });
    expect(downloadButtons.length).toBeGreaterThan(0);
    // biome-ignore lint/style/noNonNullAssertion: checked above
    await user.click(downloadButtons[0]!);

    expect(mockLoadModel).toHaveBeenCalled();
  });

  it('calls loadModel when OpenRouter Use button is clicked', async () => {
    const user = userEvent.setup();
    renderModels();

    await waitFor(() => {
      expect(screen.getByText('Mistral 7B Instruct')).toBeInTheDocument();
    });

    const mistralCard = screen
      .getByText('Mistral 7B Instruct')
      .closest('.rounded-lg');
    if (!mistralCard || !(mistralCard instanceof HTMLElement)) {
      throw new Error('Expected Mistral model card to be present');
    }
    await user.click(within(mistralCard).getByRole('button', { name: /use/i }));

    expect(mockLoadModel).toHaveBeenCalledWith('mistralai/mistral-7b-instruct');
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
      isClassifying: false,
      loadModel: loadModelMock,
      unloadModel: mockUnloadModel,
      generate: mockGenerate,
      classify: mockClassify,
      abort: mockAbort,
      isWebGPUSupported: mockIsWebGPUSupported,
      previouslyLoadedModel: null
    });

    const user = userEvent.setup();
    const { rerender } = render(
      <MemoryRouter>
        <Models />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Phi 3.5 Mini')).toBeInTheDocument();
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
        isClassifying: false,
        loadModel: loadModelMock,
        unloadModel: mockUnloadModel,
        generate: mockGenerate,
        classify: mockClassify,
        abort: mockAbort,
        isWebGPUSupported: mockIsWebGPUSupported,
        previouslyLoadedModel: null
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
      classify: mockClassify,
      abort: mockAbort,
      isWebGPUSupported: mockIsWebGPUSupported,
      isClassifying: false,
      previouslyLoadedModel: null
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
      classify: mockClassify,
      abort: mockAbort,
      isWebGPUSupported: mockIsWebGPUSupported,
      isClassifying: false,
      previouslyLoadedModel: null
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
      classify: mockClassify,
      abort: mockAbort,
      isWebGPUSupported: mockIsWebGPUSupported,
      isClassifying: false,
      previouslyLoadedModel: null
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
