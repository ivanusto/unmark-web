/*
 * The worker side of js/engine.js: load the engines, run one op, reply.
 *
 * The engine modules are plain scripts that attach themselves to globalThis,
 * so importScripts loads them here unchanged; there is no worker-specific copy
 * of any of them. A page served from file:// cannot start a worker at all, and
 * js/engine.js falls back to calling the same op table on the main thread.
 */
/* global importScripts, EngineOps */
importScripts(
  "pyre.js",
  "layer_a.js",
  "image_meta.js",
  "av_meta.js",
  "container_meta.js",
  "stylometry.js",
  "gumbel.js",
  "engine_ops.js"
);

self.onmessage = async (e) => {
  const { id, op, payload } = e.data || {};
  const fn = EngineOps.ops[op];
  if (!fn) {
    self.postMessage({ id, ok: false, error: `unknown op: ${op}` });
    return;
  }
  try {
    const result = await fn(payload);
    self.postMessage({ id, ok: true, result }, EngineOps.transferables(result));
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
