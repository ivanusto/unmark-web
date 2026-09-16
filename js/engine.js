/*
 * Runs the engine work off the main thread when the browser allows it.
 *
 * The heavy paths here are not incidental: a 64 MiB image is scanned and
 * rebuilt in one synchronous pass, keyed-Gumbel does four pure-JS SHA-256
 * compressions per token, and the stylometry marker table walks the whole text
 * once per pattern. On the main thread each of those freezes the tab for as
 * long as it takes.
 *
 * `call()` hands the op to js/worker.js when a worker could be created, and
 * runs the same function from js/engine_ops.js in place when it could not. A
 * page opened straight off the filesystem is the case that matters: file://
 * cannot start a worker, and the README says to open index.html that way, so
 * the fallback is a supported path rather than a safety net. Callers await
 * either way and cannot tell them apart.
 */
(function (root) {
  "use strict";

  const OPS = root.EngineOps;
  let worker = null;
  let unavailable = false;
  let nextId = 1;
  const pending = new Map();

  function ensureWorker() {
    if (worker || unavailable) return worker;
    try {
      worker = new Worker("js/worker.js");
      worker.onmessage = (e) => {
        const { id, ok, result, error } = e.data || {};
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        if (ok) entry.resolve(result);
        else entry.reject(new Error(error));
      };
      /* An error here is the worker failing to start or dying mid-flight. Fail
       * the calls that were in the air rather than leaving them pending for
       * ever, and stop offering the worker: the next call runs in place. */
      worker.onerror = () => {
        unavailable = true;
        const waiting = [...pending.values()];
        pending.clear();
        try { worker.terminate(); } catch (_) { /* already gone */ }
        worker = null;
        for (const entry of waiting) entry.reject(new Error("worker failed"));
      };
    } catch (_) {
      unavailable = true;   // file:// and anything else that refuses
      worker = null;
    }
    return worker;
  }

  /** Run `op` with `payload`, in a worker when there is one. */
  function call(op, payload) {
    const w = ensureWorker();
    if (!w) return Promise.resolve().then(() => OPS.ops[op](payload));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      try {
        w.postMessage({ id, op, payload });
      } catch (err) {
        // Something in the payload could not be cloned: run it here instead of
        // failing the call, so a browser quirk costs responsiveness, not work.
        pending.delete(id);
        resolve(OPS.ops[op](payload));
      }
    });
  }

  const api = { call, get offMainThread() { return !!ensureWorker(); } };
  root.Engine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
