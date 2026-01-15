import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelSelector } from './ModelSelector';

vi.mock('@/hooks/useLLM');

import { useLLM } from '@/hooks/useLLM';

const mockLoadModel = vi.fn();
const mockUnloadModel = vi.fn();
const mockGenerate = vi.fn();
const mockClassify = vi.fn();
const mockAbort = vi.fn();
const mockIsWebGPUSupported = vi.fn().mockResolvedValue(true);

const defaultMockReturn = {
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
};

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLLM).mockReturnValue(defaultMockReturn);
  });

  describe('when no model is loaded', () => {
    it('shows "Select Model" text', () => {
      render(<ModelSelector modelDisplayName={undefined} />);

      expect(screen.getByText('Select Model')).toBeInTheDocument();
    });

    it('renders dropdown trigger button', () => {
      render(<ModelSelector modelDisplayName={undefined} />);

      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });

  describe('when a model is loaded', () => {
    it('shows the model display name', () => {
      vi.mocked(useLLM).mockReturnValue({
        ...defaultMockReturn,
        loadedModel: 'onnx-community/Phi-3.5-mini-instruct-onnx-web'
      });

      render(<ModelSelector modelDisplayName="Phi 3.5 Mini" />);

      expect(screen.getByText('Phi 3.5 Mini')).toBeInTheDocument();
    });

    it('applies green styling when model is loaded', () => {
      vi.mocked(useLLM).mockReturnValue({
        ...defaultMockReturn,
        loadedModel: 'onnx-community/Phi-3.5-mini-instruct-onnx-web'
      });

      render(<ModelSelector modelDisplayName="Phi 3.5 Mini" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-success/10');
      expect(button).toHaveClass('text-success');
    });
  });

  describe('dropdown behavior', () => {
    it('opens dropdown when clicked', async () => {
      const user = userEvent.setup();
      render(<ModelSelector modelDisplayName={undefined} />);

      await user.click(screen.getByRole('button'));

      expect(screen.getByText('Available Models')).toBeInTheDocument();
    });

    it('shows chat models in dropdown (excludes classification models)', async () => {
      const user = userEvent.setup();
      render(<ModelSelector modelDisplayName={undefined} />);

      await user.click(screen.getByRole('button'));

      expect(screen.getByText('Phi 3.5 Mini')).toBeInTheDocument();
      expect(screen.getByText('SmolVLM 256M')).toBeInTheDocument();
      expect(screen.getByText('PaliGemma 2 3B')).toBeInTheDocument();
    });

    it('shows Vision badge for vision models', async () => {
      const user = userEvent.setup();
      render(<ModelSelector modelDisplayName={undefined} />);

      await user.click(screen.getByRole('button'));

      const visionBadges = screen.getAllByText('Vision');
      expect(visionBadges.length).toBe(2);
    });

    it('closes dropdown when clicking outside', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <ModelSelector modelDisplayName={undefined} />
        </div>
      );

      await user.click(screen.getByText('Select Model'));
      expect(screen.getByText('Available Models')).toBeInTheDocument();

      await user.click(screen.getByTestId('outside'));

      await waitFor(() => {
        expect(screen.queryByText('Available Models')).not.toBeInTheDocument();
      });
    });

    it('closes dropdown when pressing Escape', async () => {
      const user = userEvent.setup();
      render(<ModelSelector modelDisplayName={undefined} />);

      await user.click(screen.getByText('Select Model'));
      expect(screen.getByText('Available Models')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.queryByText('Available Models')).not.toBeInTheDocument();
    });
  });

  describe('model selection', () => {
    it('calls loadModel when a different model is selected', async () => {
      const user = userEvent.setup();
      render(<ModelSelector modelDisplayName={undefined} />);

      await user.click(screen.getByText('Select Model'));
      // Wait for dropdown to appear
      await waitFor(() => {
        expect(screen.getByText('Available Models')).toBeInTheDocument();
      });
      await user.click(screen.getByText('Phi 3.5 Mini'));

      await waitFor(() => {
        expect(mockLoadModel).toHaveBeenCalledWith(
          'onnx-community/Phi-3.5-mini-instruct-onnx-web'
        );
      });
    });

    it('does not call loadModel when the same model is selected', async () => {
      vi.mocked(useLLM).mockReturnValue({
        ...defaultMockReturn,
        loadedModel: 'onnx-community/Phi-3.5-mini-instruct-onnx-web'
      });

      const user = userEvent.setup();
      render(<ModelSelector modelDisplayName="Phi 3.5 Mini" />);

      await user.click(screen.getByRole('button'));
      // Get the dropdown menu and find the option within it
      const dropdownMenu = screen.getByRole('menu');
      const dropdownOption = within(dropdownMenu).getByText('Phi 3.5 Mini');
      await user.click(dropdownOption);

      expect(mockLoadModel).not.toHaveBeenCalled();
    });

    it('closes dropdown after selecting a model', async () => {
      const user = userEvent.setup();
      render(<ModelSelector modelDisplayName={undefined} />);

      await user.click(screen.getByText('Select Model'));
      await user.click(screen.getByText('SmolVLM 256M'));

      expect(screen.queryByText('Available Models')).not.toBeInTheDocument();
    });

    it('shows checkmark next to loaded model', async () => {
      vi.mocked(useLLM).mockReturnValue({
        ...defaultMockReturn,
        loadedModel: 'onnx-community/Phi-3.5-mini-instruct-onnx-web'
      });

      const user = userEvent.setup();
      render(<ModelSelector modelDisplayName="Phi 3.5 Mini" />);

      await user.click(screen.getByRole('button'));

      // Find the Phi 3.5 Mini option in the dropdown menu
      const dropdownMenu = screen.getByRole('menu');
      const phi3DropdownOption = within(dropdownMenu)
        .getAllByRole('menuitem')
        .find(
          (btn) =>
            btn.textContent?.includes('Phi 3.5 Mini') &&
            btn.textContent?.includes('~2GB')
        );

      expect(phi3DropdownOption).toBeInTheDocument();

      // Assert that the checkmark icon is present within the button
      const checkmarkIcon = phi3DropdownOption?.querySelector('.lucide-check');
      expect(checkmarkIcon).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading percentage when loading', () => {
      vi.mocked(useLLM).mockReturnValue({
        ...defaultMockReturn,
        isLoading: true,
        loadProgress: { text: 'Downloading...', progress: 0.5 }
      });

      render(<ModelSelector modelDisplayName={undefined} />);

      expect(screen.getByText('Loading 50%')).toBeInTheDocument();
    });

    it('shows spinner when loading', () => {
      vi.mocked(useLLM).mockReturnValue({
        ...defaultMockReturn,
        isLoading: true,
        loadProgress: { text: 'Downloading...', progress: 0.25 }
      });

      render(<ModelSelector modelDisplayName={undefined} />);

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('disables button when loading', () => {
      vi.mocked(useLLM).mockReturnValue({
        ...defaultMockReturn,
        isLoading: true,
        loadProgress: { text: 'Downloading...', progress: 0.75 }
      });

      render(<ModelSelector modelDisplayName={undefined} />);

      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('does not open dropdown when loading', async () => {
      vi.mocked(useLLM).mockReturnValue({
        ...defaultMockReturn,
        isLoading: true,
        loadProgress: { text: 'Downloading...', progress: 0.5 }
      });

      const user = userEvent.setup();
      render(<ModelSelector modelDisplayName={undefined} />);

      await user.click(screen.getByRole('button'));

      expect(screen.queryByText('Available Models')).not.toBeInTheDocument();
    });
  });
});
