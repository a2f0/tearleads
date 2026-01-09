import {
  AutoModelForCausalLM,
  AutoModelForVision2Seq,
  AutoProcessor,
  AutoTokenizer,
  CLIPModel,
  env,
  PaliGemmaForConditionalGeneration,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
  RawImage,
  TextStreamer
} from '@huggingface/transformers';
import { getModelType, type ModelType, softmax } from './llm-worker-utils';

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
  | { type: 'classify'; image: string; candidateLabels: string[] }
  | { type: 'unload' }
  | { type: 'abort' };

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
  | {
      type: 'classification';
      labels: string[];
      scores: number[];
      durationMs: number;
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
    } else if (modelType === 'clip') {
      // Load CLIP model for zero-shot classification
      [processor, tokenizer, model] = await Promise.all([
        AutoProcessor.from_pretrained(modelId, {
          progress_callback: progressCallback
        }),
        AutoTokenizer.from_pretrained(modelId, {
          progress_callback: progressCallback
        }),
        CLIPModel.from_pretrained(modelId, {
          dtype: 'fp32',
          device: 'webgpu',
          progress_callback: progressCallback
        })
      ]);
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
    } else if (currentModelType === 'vision' && processor) {
      // Vision models require a multimodal message format even for text-only prompts.
      // We format the messages accordingly and use the processor to apply the chat template.
      const hasImage = Boolean(imageBase64);
      const image =
        hasImage && imageBase64 ? await RawImage.fromURL(imageBase64) : null;

      // Format messages with multimodal content structure
      // Include image marker only when an image is provided
      const formattedMessages = messages.map((m) => {
        if (m.role === 'user') {
          const content: Array<{ type: string; text?: string }> = [];
          if (hasImage) {
            content.push({ type: 'image' });
          }
          content.push({ type: 'text', text: m.content });
          return { role: m.role, content };
        }
        return m;
      });

      // @ts-expect-error - SmolVLM uses multimodal content format
      const text = processor.apply_chat_template(formattedMessages, {
        add_generation_prompt: true
      });

      // Process with or without images
      inputs = image ? await processor(text, [image]) : await processor(text);
    } else {
      // Text-only chat (standard chat models like Phi-3)
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

async function classifyImage(
  imageBase64: string,
  candidateLabels: string[]
): Promise<void> {
  if (!model || !tokenizer || !processor) {
    postResponse({ type: 'error', message: 'CLIP model not loaded' });
    return;
  }

  if (currentModelType !== 'clip') {
    postResponse({
      type: 'error',
      message: 'Loaded model is not a CLIP model'
    });
    return;
  }

  const startTime = performance.now();

  try {
    // Process image
    const image = await RawImage.fromURL(imageBase64);
    const imageInputs = await processor(image);

    // Process text labels with prompt template
    const textInputs = tokenizer(
      candidateLabels.map((label) => `a photo of a ${label}`),
      { padding: true, truncation: true }
    );

    // Run CLIP model with both text and image inputs
    // CLIPModel returns logits_per_image which contains similarity scores
    const output = await model({ ...textInputs, ...imageInputs });

    // Extract logits_per_image - shape is [1, num_labels]
    // These are already cosine similarities scaled by temperature
    const logitsData = output.logits_per_image?.data;
    if (!(logitsData instanceof Float32Array)) {
      throw new Error('Unexpected logits_per_image data type');
    }

    // Convert to array for softmax
    const logits: number[] = Array.from(logitsData);

    // Apply softmax to get probabilities
    const scores = softmax(logits);

    const durationMs = performance.now() - startTime;
    postResponse({
      type: 'classification',
      labels: candidateLabels,
      scores,
      durationMs
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postResponse({
      type: 'error',
      message: `Classification failed: ${message}`
    });
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

    case 'classify':
      await classifyImage(request.image, request.candidateLabels);
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
