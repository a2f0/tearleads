export interface ModelInfo {
  id: string;
  name: string;
  size: string;
  description: string;
  isVision?: boolean;
}

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
  }
];
