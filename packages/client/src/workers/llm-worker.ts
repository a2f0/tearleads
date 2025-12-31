import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

let handler: WebWorkerMLCEngineHandler;

self.onmessage = (msg: MessageEvent) => {
  if (!handler) {
    handler = new WebWorkerMLCEngineHandler();
    console.log('LLM Worker: WebLLM Engine Activated');
  }
  handler.onmessage(msg);
};
