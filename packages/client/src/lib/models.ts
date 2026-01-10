export interface ModelInfo {
  id: string;
  name: string;
  size: string;
  description: string;
  isVision?: boolean;
  isClassification?: boolean;
}

export const DOCUMENT_LABELS = [
  'passport',
  'drivers license',
  'identity card',
  'credit card',
  'bank statement',
  'utility bill',
  'other document'
];

export const CLASSIFICATION_MODEL: ModelInfo = {
  id: 'Xenova/clip-vit-base-patch32',
  name: 'CLIP ViT-B/32',
  size: '~350MB',
  description: 'Zero-shot image classification for documents',
  isClassification: true
};

export const RECOMMENDED_MODELS: ModelInfo[] = [
  {
    id: 'onnx-community/Phi-3.5-mini-instruct-onnx-web',
    name: 'Phi 3.5 Mini',
    size: '~2GB',
    description: 'Fast chat model for general tasks'
  },
  {
    id: 'HuggingFaceTB/SmolVLM-256M-Instruct',
    name: 'SmolVLM 256M',
    size: '~500MB',
    description: 'Compact vision model for image understanding',
    isVision: true
  },
  {
    id: 'onnx-community/paligemma2-3b-ft-docci-448',
    name: 'PaliGemma 2 3B',
    size: '~3GB',
    description: 'Google vision model for detailed captions',
    isVision: true
  },
  CLASSIFICATION_MODEL
];

export const CHAT_MODELS: ModelInfo[] = RECOMMENDED_MODELS.filter(
  (model) => !model.isClassification
);
