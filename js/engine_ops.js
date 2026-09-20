/*
 * The engine work, in one table, with no DOM in it.
 *
 * Loaded twice on purpose: js/worker.js pulls it in through importScripts, and
 * the page loads it as an ordinary script. js/engine.js calls into the worker
 * when there is one and into this table directly when there is not, so the two
 * paths run the same code rather than two copies of it that can drift.
 *
 * Every op takes and returns structured-cloneable values only: a File or Blob
 * goes across by reference, so handing the worker a two-hour recording costs
 * nothing, and the cleaned bytes come back as an ArrayBuffer the caller can
 * transfer rather than copy.
 */
(function (root) {
  "use strict";

  const req = (name) => (typeof module !== "undefined" && module.exports) ? require("./" + name) : null;
  const LayerA = req("layer_a.js") || root.LayerA;
  const ImageMeta = req("image_meta.js") || root.ImageMeta;
  const AvMeta = req("av_meta.js") || root.AvMeta;
  const ContainerMeta = req("container_meta.js") || root.ContainerMeta;
  const Stylometry = req("stylometry.js") || root.Stylometry;
  const Gumbel = req("gumbel.js") || root.Gumbel;

  const bytesOf = async (file) => new Uint8Array(await file.arrayBuffer());
  // A Uint8Array over exactly its own buffer can be handed on as-is; one that
  // is a window onto a larger buffer has to be copied first, or the receiver
  // gets the whole thing.
  const bufferOf = (u8) => (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength)
    ? u8.buffer
    : u8.slice().buffer;

  const ops = {
    async cleanImageFile({ file, stripAllMetadata }) {
      const u8 = await bytesOf(file);
      const before = ImageMeta.inspect(u8);
      const r = ImageMeta.clean(u8, { stripAllMetadata });
      return { before, format: r.format, actions: r.actions, buffer: bufferOf(r.data) };
    },

    async cleanContainerFile({ file, kind, layerAOptions }) {
      const u8 = await bytesOf(file);
      let before;
      let actions;
      let text;
      if (kind === "svg") {
        before = ContainerMeta.inspectSvg(u8);
        const r = ContainerMeta.cleanSvg(u8);
        actions = r.actions;
        text = ContainerMeta.decodeUtf8(r.data, "surrogateescape");
      } else {
        text = ContainerMeta.decodeUtf8(u8, "surrogateescape");
        before = kind === "html" ? ContainerMeta.inspectHtml(text) : ContainerMeta.inspectMarkdown(text);
        const r = kind === "html" ? ContainerMeta.cleanHtml(text) : ContainerMeta.cleanMarkdown(text);
        actions = r.actions;
        text = r.text;
      }
      const { cleaned, stats } = LayerA.clean(text, layerAOptions);
      return {
        before: { hasC2pa: before.hasC2pa, hasAi: before.hasAi, findings: before.findings },
        actions, stats, buffer: bufferOf(ContainerMeta.encodeUtf8(cleaned)),
      };
    },

    async cleanTextFile({ file, layerAOptions }) {
      const { cleaned, stats } = LayerA.clean(await file.text(), layerAOptions);
      return { cleaned, stats };
    },

    async inspectAvFile({ file }) {
      return AvMeta.inspectAvFile(file);
    },

    async cleanAvFile({ file, stripAllMetadata, type }) {
      return AvMeta.cleanAvFile(file, { stripAllMetadata, type });
    },

    layerAClean({ text, options }) {
      return LayerA.clean(text, options);
    },

    layerAInspect({ text, options }) {
      return LayerA.inspect(text, options);
    },

    /* The file is read here rather than by the caller. Reading it on the main
     * thread and passing the bytes cost two allocations of it, one for the read
     * and one for the structured clone into this worker, and the page never
     * needed them: only this op does. */
    async inspectFileBytes({ file }) {
      const u8 = await bytesOf(file);
      return ImageMeta.detectFormat(u8) !== "unknown" ? ImageMeta.inspect(u8) : AvMeta.inspectAv(u8);
    },

    /* The threshold rides along with the report so the page can render the
     * "score / threshold" column without holding js/stylometry.js itself. */
    stylometryScore({ text }) {
      return { report: Stylometry.score(text), defaultThreshold: Stylometry.DEFAULT_THRESHOLD };
    },

    /* An absent window or threshold is filled in here, where the defaults live.
     * Passing the keys through as undefined would not do: detectText merges
     * them over its defaults, and a present key wins even when its value is
     * undefined. */
    gumbelDetect({ text, key, options }) {
      const o = {};
      if (options && options.window) o.window = options.window;
      if (options && options.threshold) o.threshold = options.threshold;
      return Gumbel.detectText(text, key, o);
    },
  };

  /* Which of an op's returned values can be handed over rather than copied.
   * Transferring a 64 MiB result is the difference between one allocation and
   * two, and the worker has no use for it afterwards. */
  function transferables(result) {
    const out = [];
    if (result && result.buffer instanceof ArrayBuffer) out.push(result.buffer);
    return out;
  }

  const api = { ops, transferables };
  root.EngineOps = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
