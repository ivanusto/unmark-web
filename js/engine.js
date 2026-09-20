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
 *
 * The engines are not in the page's script tags. The worker loads its own copy
 * through importScripts, so on the path almost everyone takes the main thread
 * never fetches, parses or compiles them at all: the six engine modules are
 * most of the JavaScript this page has, and the first screen uses none of it.
 * The fallback loads them itself, on the first call, which is also the first
 * moment anyone can tell the difference.
 */
(function (root) {
  "use strict";

  /* Load order is the modules' dependency order: pyre before its users,
   * engine_ops last because it captures the rest as it runs. */
  const ENGINE_SCRIPTS = [
    "pyre.js", "layer_a.js", "image_meta.js", "av_meta.js",
    "container_meta.js", "stylometry.js", "gumbel.js", "engine_ops.js",
  ];

  let worker = null;
  let unavailable = false;
  let nextId = 1;
  let opsReady = null;
  const pending = new Map();

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error("could not load " + src));
      document.head.appendChild(el);
    });
  }

  /** The op table, loading the engines into this thread the first time. */
  function ops() {
    if (root.EngineOps) return Promise.resolve(root.EngineOps);
    if (!opsReady) {
      opsReady = ENGINE_SCRIPTS
        .reduce((chain, name) => chain.then(() => loadScript("js/" + name)), Promise.resolve())
        .then(() => {
          if (!root.EngineOps) throw new Error("engine modules loaded but EngineOps is missing");
          return root.EngineOps;
        });
    }
    return opsReady;
  }

  function runHere(op, payload) {
    return ops().then((table) => {
      const fn = table.ops[op];
      if (!fn) throw new Error(`unknown op: ${op}`);
      return fn(payload);
    });
  }

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
    if (!w) return runHere(op, payload);
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      try {
        w.postMessage({ id, op, payload });
      } catch (err) {
        // Something in the payload could not be cloned: run it here instead of
        // failing the call, so a browser quirk costs responsiveness, not work.
        pending.delete(id);
        resolve(runHere(op, payload));
      }
    });
  }

  /* Started now rather than on the first call. Creating it costs the page
   * nothing: the fetching and compiling of the engines happens on the worker's
   * own thread, and doing it during load means the first clean does not wait
   * for it. */
  ensureWorker();

  const api = { call, get offMainThread() { return !!ensureWorker(); } };
  root.Engine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
