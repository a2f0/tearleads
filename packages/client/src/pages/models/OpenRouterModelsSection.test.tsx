import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OPENROUTER_MODELS } from '@/lib/models';
import { OpenRouterModelsSection } from './OpenRouterModelsSection';

describe('OpenRouterModelsSection', () => {
  it('loads a model when Use is clicked', async () => {
    const user = userEvent.setup();
    const onLoad = vi.fn();

    render(
      <OpenRouterModelsSection
        loadedModel={null}
        loadingModelId={null}
        onLoad={onLoad}
        onUnload={vi.fn()}
      />
    );

    const useButtons = screen.getAllByRole('button', { name: 'Use' });
    const firstUseButton = useButtons[0];
    if (!firstUseButton) {
      throw new Error('Expected at least one Use button');
    }

    await user.click(firstUseButton);

    expect(onLoad).toHaveBeenCalledWith(OPENROUTER_MODELS[0]?.id);
  });

  it('unloads when a loaded model is disconnected', async () => {
    const user = userEvent.setup();
    const onUnload = vi.fn();
    const loadedModelId = OPENROUTER_MODELS[0]?.id ?? null;

    render(
      <OpenRouterModelsSection
        loadedModel={loadedModelId}
        loadingModelId={null}
        onLoad={vi.fn()}
        onUnload={onUnload}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(onUnload).toHaveBeenCalledTimes(1);
  });
});
