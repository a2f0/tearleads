import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const broadcastChannelPrototype = globalThis.BroadcastChannel?.prototype;

if (broadcastChannelPrototype) {
  const addEventListener = broadcastChannelPrototype.addEventListener;
  broadcastChannelPrototype.addEventListener = function addEventListenerShim(
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
