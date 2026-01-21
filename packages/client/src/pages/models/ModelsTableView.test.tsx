import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type ModelInfo, OPENROUTER_MODELS } from '@/lib/models';
import type { ModelStatus } from './ModelCard';
import { ModelsTableView } from './ModelsTableView';

describe('ModelsTableView', () => {
  const recommendedModels: ModelInfo[] = [
    {
      id: 'local-model',
      name: 'Local Model',
      size: '~1GB',
      description: 'Test local model'
    }
  ];

  it('renders tables for recommended and OpenRouter models', () => {
    render(
      <ModelsTableView
        recommendedModels={recommendedModels}
        openRouterModels={OPENROUTER_MODELS.slice(0, 1)}
        loadedModel={null}
        loadingModelId={null}
        loadProgress={null}
        getModelStatus={() => 'not_downloaded'}
        onLoad={vi.fn()}
        onUnload={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(
      screen.getByRole('table', { name: 'Recommended Models table' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'OpenRouter Models table' })
    ).toBeInTheDocument();
  });

  it('calls onLoad when Download is clicked for local models', async () => {
    const user = userEvent.setup();
    const onLoad = vi.fn();
    const getModelStatus: (modelId: string) => ModelStatus = () =>
      'not_downloaded';

    render(
      <ModelsTableView
        recommendedModels={recommendedModels}
        openRouterModels={[]}
        loadedModel={null}
        loadingModelId={null}
        loadProgress={null}
        getModelStatus={getModelStatus}
        onLoad={onLoad}
        onUnload={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Download' }));

    expect(onLoad).toHaveBeenCalledWith('local-model');
  });

  it('shows Use for OpenRouter models', () => {
    render(
      <ModelsTableView
        recommendedModels={[]}
        openRouterModels={OPENROUTER_MODELS.slice(0, 1)}
        loadedModel={null}
        loadingModelId={null}
        loadProgress={null}
        getModelStatus={() => 'not_downloaded'}
        onLoad={vi.fn()}
        onUnload={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Use' })).toBeInTheDocument();
  });
});
