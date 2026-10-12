// Wrangler aliases the bare `loro-crdt` specifier to this module (subpath
// imports such as `loro-crdt/web` are untouched). The package's bundler entry
// expects the bundler to instantiate its WebAssembly, and Workers forbid
// compiling WebAssembly from bytes at runtime, so the `web` build is
// initialized here from the module Wrangler compiles at deploy time.
import { initSync } from "loro-crdt/web";
import wasmModule from "loro-crdt/web/loro_wasm_bg.wasm";

initSync({ module: wasmModule });

export * from "loro-crdt/web";
