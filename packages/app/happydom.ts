import { afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

interface AppTestProcessState {
  hasLoadedApiRuntimeModule: boolean;
}

const appTestProcessState = globalThis as typeof globalThis & {
  __tearleadsAppTestProcessState?: AppTestProcessState;
};

if (!appTestProcessState.__tearleadsAppTestProcessState) {
  appTestProcessState.__tearleadsAppTestProcessState = {
    hasLoadedApiRuntimeModule: false,
  };
}

afterAll(async () => {
  if (
    !appTestProcessState.__tearleadsAppTestProcessState
      .hasLoadedApiRuntimeModule
  ) {
    return;
  }

  const cleanupModuleUrl = new URL("../api/test/cleanup.ts", import.meta.url)
    .href;
  const { closeApiTestAdapters } = await import(cleanupModuleUrl);
  await closeApiTestAdapters();
});

const broadcastChannelPrototype = globalThis.BroadcastChannel?.prototype;

if (broadcastChannelPrototype) {
  const addEventListener = broadcastChannelPrototype.addEventListener;
  broadcastChannelPrototype.addEventListener =
    function addEventListenerForHappyDom(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean,
    ) {
      if (listener === null) {
        return;
      }

      try {
        return addEventListener.call(this, type, listener, options);
      } catch (error) {
        if (
          error instanceof TypeError &&
          options &&
          typeof options === "object" &&
          "signal" in options
        ) {
          return addEventListener.call(this, type, listener);
        }
        throw error;
      }
    };
}
