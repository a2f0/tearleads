import {
  AutoModelForCausalLM,
  AutoModelForVision2Seq,
  AutoProcessor,
  AutoTokenizer,
  env,
  PaliGemmaForConditionalGeneration,
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

type ModelType = 'chat' | 'vision' | 'paligemma';

type WorkerResponse =
  | { type: 'progress'; file: string; progress: number; total: number }
  | {
      type: 'loaded';
      modelId: string;
      modelType: ModelType;
      durationMs: number;
    }
  | { type: 'token'; text: string }
  | {
      type: 'done';
      durationMs: number;
      promptType: 'text' | 'multimodal';
    }
  | { type: 'error'; message: string }
  | { type: 'unloaded' };

// Model state
let model: PreTrainedModel | null = null;
let tokenizer: PreTrainedTokenizer | null = null;
let processor: Processor | null = null;
let currentModelId: string | null = null;
let currentModelType: ModelType | null = null;
let abortController: AbortController | null = null;

function postResponse(response: WorkerResponse): void {
  self.postMessage(response);
}

function isPaliGemmaModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('paligemma');
}

function isVisionModel(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase();
  return lowerModelId.includes('vision') || lowerModelId.includes('vlm');
}

function getModelType(modelId: string): ModelType {
  if (isPaliGemmaModel(modelId)) return 'paligemma';
  if (isVisionModel(modelId)) return 'vision';
  return 'chat';
}

async function loadModel(modelId: string): Promise<void> {
  const startTime = performance.now();

  // Skip if already loaded
  if (currentModelId === modelId && model) {
    postResponse({
      type: 'loaded',
      modelId,
      modelType: currentModelType ?? 'chat',
      durationMs: 0
    });
    return;
  }

  // Unload any existing model first
  await unloadModel();

  const modelType = getModelType(modelId);

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

    if (modelType === 'paligemma') {
      // Load PaliGemma model with mixed dtype to avoid ArrayBuffer limit
      // embed_tokens_fp16.onnx is 1.19GB (fits), embed_tokens_q4.onnx_data is 2.37GB (exceeds ~2.15GB limit)
      [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained(modelId, {
          progress_callback: progressCallback
        }),
        PaliGemmaForConditionalGeneration.from_pretrained(modelId, {
          dtype: {
            embed_tokens: 'fp16',
            vision_encoder: 'q4',
            decoder_model_merged: 'q4'
          },
          device: 'webgpu',
          progress_callback: progressCallback
        })
      ]);
      // PaliGemma uses processor's tokenizer
      tokenizer = processor.tokenizer ?? null;
    } else if (modelType === 'vision') {
      // Load vision model (SmolVLM) with processor
      [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained(modelId, {
          progress_callback: progressCallback
        }),
        AutoModelForVision2Seq.from_pretrained(modelId, {
          dtype: 'q4',
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
    currentModelType = modelType;

    const durationMs = performance.now() - startTime;
    postResponse({
      type: 'loaded',
      modelId,
      modelType: currentModelType,
      durationMs
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

  const startTime = performance.now();
  const isMultimodal = Boolean(imageBase64);
  abortController = new AbortController();

  try {
    let inputs: Record<string, unknown>;

    if (currentModelType === 'paligemma' && processor && imageBase64) {
      // PaliGemma model with image
      const image = await RawImage.fromURL(imageBase64);

      // PaliGemma ft-docci uses specific prompt format for captioning
      // Format: <image>caption en (for English captions)
      const prompt = '<image>caption en';

      // Process image and prompt together
      inputs = await processor(image, prompt);

      // PaliGemma doesn't stream well, generate and decode the full output
      const output = await model.generate({
        ...inputs,
        // @ts-expect-error - Transformers.js types don't include all generation options
        max_new_tokens: 256,
        do_sample: false
      });

      if (abortController.signal.aborted) {
        const durationMs = performance.now() - startTime;
        postResponse({ type: 'done', durationMs, promptType: 'multimodal' });
        return;
      }

      // Slice to get only the generated tokens (not the prompt)
      // @ts-expect-error - output.slice exists on Tensor
      const inputLength = inputs.input_ids.dims[1];
      // @ts-expect-error - output.slice exists on Tensor
      const generatedIds = output.slice(null, [inputLength, null]);

      // Decode the generated tokens
      const decoded = processor.batch_decode(generatedIds, {
        skip_special_tokens: true
      });

      const answer = decoded[0] ?? '';
      postResponse({ type: 'token', text: answer });
      const durationMs = performance.now() - startTime;
      postResponse({ type: 'done', durationMs, promptType: 'multimodal' });
      return;
    } else if (currentModelType === 'vision' && processor && imageBase64) {
      // Vision model with image (SmolVLM format)
      const image = await RawImage.fromURL(imageBase64);

      // Format messages for SmolVLM - use type markers, not actual images
      // The images are passed separately to the processor
      const formattedMessages = messages.map((m) => {
        if (m.role === 'user') {
          return {
            role: m.role,
            content: [{ type: 'image' }, { type: 'text', text: m.content }]
          };
        }
        return m;
      });

      // Use processor.apply_chat_template for vision models
      // @ts-expect-error - SmolVLM uses multimodal content format
      const text = processor.apply_chat_template(formattedMessages, {
        add_generation_prompt: true
      });

      // Pass text and images separately to processor
      inputs = await processor(text, [image]);
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
    await model.generate({
      ...inputs,
      // @ts-expect-error - Transformers.js types don't include all generation options
      max_new_tokens: 512,
      do_sample: true,
      temperature: 0.7,
      streamer
    });

    const durationMs = performance.now() - startTime;
    const promptType = isMultimodal ? 'multimodal' : 'text';
    if (!abortController.signal.aborted) {
      postResponse({ type: 'done', durationMs, promptType });
    }
  } catch (error) {
    if (abortController?.signal.aborted) {
      const durationMs = performance.now() - startTime;
      const promptType = isMultimodal ? 'multimodal' : 'text';
      postResponse({ type: 'done', durationMs, promptType });
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
