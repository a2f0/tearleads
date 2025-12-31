import {
  AutoModelForCausalLM,
  AutoProcessor,
  AutoTokenizer,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
  RawImage,
  TextStreamer
} from '@huggingface/transformers';

// Disable local model check since we're always fetching from HuggingFace
env.allowLocalModels = false;

// Types for worker messages
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type WorkerRequest =
  | { type: 'load'; modelId: string }
  | { type: 'generate'; messages: ChatMessage[]; image?: string }
  | { type: 'unload' }
  | { type: 'abort' };

type WorkerResponse =
  | { type: 'progress'; file: string; progress: number; total: number }
  | { type: 'loaded'; modelId: string; modelType: 'chat' | 'vision' }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'unloaded' };

// Model state
let model: PreTrainedModel | null = null;
let tokenizer: PreTrainedTokenizer | null = null;
let processor: Processor | null = null;
let currentModelId: string | null = null;
let currentModelType: 'chat' | 'vision' | null = null;
let abortController: AbortController | null = null;

function postResponse(response: WorkerResponse): void {
  self.postMessage(response);
}

function isVisionModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('vision');
}

async function loadModel(modelId: string): Promise<void> {
  // Skip if already loaded
  if (currentModelId === modelId && model) {
    postResponse({
      type: 'loaded',
      modelId,
      modelType: currentModelType ?? 'chat'
    });
    return;
  }

  // Unload any existing model first
  await unloadModel();

  const isVision = isVisionModel(modelId);

  try {
    const progressCallback = (progress: {
      status: string;
      file?: string;
      progress?: number;
      total?: number;
    }) => {
      if (progress.file && progress.progress !== undefined) {
        postResponse({
          type: 'progress',
          file: progress.file,
          progress: progress.progress,
          total: progress.total ?? 0
        });
      }
    };

    if (isVision) {
      // Load vision model with processor
      [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained(modelId, {
          progress_callback: progressCallback
        }),
        AutoModelForCausalLM.from_pretrained(modelId, {
          dtype: {
            vision_encoder: 'q4',
            prepare_inputs_embeds: 'q4',
            model: 'q4f16'
          },
          device: 'webgpu',
          progress_callback: progressCallback
        })
      ]);
      // Vision models use processor's tokenizer
      tokenizer = processor.tokenizer ?? null;
    } else {
      // Load chat model
      [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(modelId, {
          progress_callback: progressCallback
        }),
        AutoModelForCausalLM.from_pretrained(modelId, {
          dtype: 'q4f16',
          device: 'webgpu',
          progress_callback: progressCallback
        })
      ]);
    }

    currentModelId = modelId;
    currentModelType = isVision ? 'vision' : 'chat';

    postResponse({
      type: 'loaded',
      modelId,
      modelType: currentModelType
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postResponse({
      type: 'error',
      message: `Failed to load model: ${message}`
    });
    throw error;
  }
}

async function unloadModel(): Promise<void> {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  if (model) {
    try {
      await model.dispose();
    } catch {
      // Ignore disposal errors
    }
    model = null;
  }

  tokenizer = null;
  processor = null;
  currentModelId = null;
  currentModelType = null;

  postResponse({ type: 'unloaded' });
}

async function generate(
  messages: ChatMessage[],
  imageBase64?: string
): Promise<void> {
  if (!model || !tokenizer) {
    postResponse({ type: 'error', message: 'No model loaded' });
    return;
  }

  abortController = new AbortController();

  try {
    let inputs: Record<string, unknown>;

    if (currentModelType === 'vision' && processor && imageBase64) {
      // Vision model with image
      const image = await RawImage.fromURL(imageBase64);

      // Format messages for vision model - use image placeholder
      const formattedMessages = messages.map((m) => {
        if (m.role === 'user' && !m.content.includes('<|image_1|>')) {
          return { ...m, content: `<|image_1|>\n${m.content}` };
        }
        return m;
      });

      const prompt = tokenizer.apply_chat_template(formattedMessages, {
        tokenize: false,
        add_generation_prompt: true
      });

      inputs = await processor(prompt, image, { num_crops: 4 });
    } else {
      // Text-only chat
      const prompt = tokenizer.apply_chat_template(messages, {
        tokenize: false,
        add_generation_prompt: true
      });

      inputs = tokenizer(prompt, { return_tensors: 'pt' });
    }

    // Create streamer that posts tokens
    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        if (!abortController?.signal.aborted) {
          postResponse({ type: 'token', text });
        }
      }
    });

    // Generate with streaming
    // @ts-expect-error - Transformers.js types don't fully match the actual API
    await model.generate(inputs, {
      max_new_tokens: 512,
      do_sample: true,
      temperature: 0.7,
      streamer
    });

    if (!abortController.signal.aborted) {
      postResponse({ type: 'done' });
    }
  } catch (error) {
    if (abortController?.signal.aborted) {
      postResponse({ type: 'done' });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    postResponse({ type: 'error', message: `Generation failed: ${message}` });
  } finally {
    abortController = null;
  }
}

// Message handler
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  switch (request.type) {
    case 'load':
      await loadModel(request.modelId);
      break;

    case 'generate':
      await generate(request.messages, request.image);
      break;

    case 'unload':
      await unloadModel();
      break;

    case 'abort':
      if (abortController) {
        abortController.abort();
      }
      break;
  }
};

console.log('LLM Worker: Transformers.js Engine Activated');
