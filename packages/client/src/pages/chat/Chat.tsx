import { useLLM } from '@/hooks/useLLM';
import { OPENROUTER_CHAT_MODELS } from '@rapid/shared';
import { ChatHeader } from './ChatHeader';
import { ChatInterface } from './ChatInterface';
import { NoModelLoadedContent } from './NoModelLoadedContent';

/**
 * Derives a display name from an ONNX model ID.
 * Example: onnx-community/Phi-3.5-mini-instruct-onnx-web -> Phi 3.5 Mini
 */
function getModelDisplayName(modelId: string): string {
  const openRouterModel = OPENROUTER_CHAT_MODELS.find(
    (model) => model.id === modelId
  );
  if (openRouterModel) {
    return openRouterModel.name;
  }

  // Extract the model name part after the org/
  const modelName = modelId.includes('/')
    ? (modelId.split('/')[1] ?? modelId)
    : modelId;

  // Parse the name
  return modelName
    .replace(/-4k-instruct$/, '')
    .replace(/-instruct$/, '')
    .split('-')
    .slice(0, 3)
    .map((part) => {
      // Capitalize first letter of each part
      if (part.length > 0) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      }
      return part;
    })
    .join(' ')
    .trim();
}

export function Chat() {
  const { loadedModel, modelType, generate } = useLLM();

  const modelDisplayName = loadedModel
    ? getModelDisplayName(loadedModel)
    : undefined;

  const isVisionModel = modelType === 'vision' || modelType === 'paligemma';

  return (
    <div className="flex h-full flex-col">
      <ChatHeader modelDisplayName={modelDisplayName} />
      {loadedModel ? (
        <ChatInterface generate={generate} isVisionModel={isVisionModel} />
      ) : (
        <NoModelLoadedContent />
      )}
    </div>
  );
}
