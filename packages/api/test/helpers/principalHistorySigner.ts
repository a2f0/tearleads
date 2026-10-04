import { parentPort } from "node:worker_threads";
import {
  signPrincipalState,
  type UnsignedPrincipalState,
} from "@tearleads/crypto";

const port = parentPort;
if (!port) throw new Error("Principal history signer requires a worker");
port.on(
  "message",
  async (input: {
    states: UnsignedPrincipalState[];
    signingPrivateKey: Uint8Array;
  }) => {
    const signed = [];
    for (const state of input.states)
      signed.push(await signPrincipalState(state, input.signingPrivateKey));
    port.postMessage(signed);
  },
);
