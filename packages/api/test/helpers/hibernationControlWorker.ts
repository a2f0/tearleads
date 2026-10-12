interface ControlBindings {
  readonly REALTIME_HUB: DurableObjectNamespace<{
    publish(message: string): Promise<void>;
  }>;
  readonly KEY_VALUE_STORE: DurableObjectNamespace<{ del(key: string): void }>;
}

/** Test-only HTTP event boundaries release RPC stubs after each command. */
export default {
  async fetch(request: Request, env: ControlBindings): Promise<Response> {
    const input = (await request.json()) as {
      kind: string;
      message?: string;
      token?: string;
    };
    if (input.kind === "publish") {
      await env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName("hub")).publish(
        input.message ?? "",
      );
    } else if (input.kind === "expire-session") {
      await env.KEY_VALUE_STORE.get(
        env.KEY_VALUE_STORE.idFromName("default"),
      ).del(`session:${input.token}`);
    } else {
      return new Response("Unknown command", { status: 400 });
    }
    return new Response("ok");
  },
};
