# SynthID-Text experiment keys (vendored)

`key-a.json` and `key-b.json` are copied **verbatim** from

- https://raw.githubusercontent.com/xlr8harder/synthid/main/reference/experiment-keys/key-a.json
- https://raw.githubusercontent.com/xlr8harder/synthid/main/reference/experiment-keys/key-b.json

Project: https://github.com/xlr8harder/synthid — MIT License, Copyright (c) 2026 xlr8harder.

They are the SynthID-Text watermark configurations (30 integer keys, `ngram_len` 5,
sampling table seed 0 / size 65536, context history 1024) that the published
Qwen3-4B-Instruct-2507 detector bundles
(https://huggingface.co/xlr8harder/synthid-qwen3-4b-instruct-2507-detectors, MIT)
were trained against. Each file also carries the SHA-256 commitment the bundles
reference, so the pairing can be checked.

Upstream's own statement, which applies here unchanged:

> The experiment-only Key-A and Key-B configurations are intentionally disclosed
> for exact reproduction and must not be reused for deployment.

In other words: these keys exist so the demo can show "same key → detected,
other key → not detected". Anyone can read them, so text watermarked with them
proves nothing about provenance. Generate your own key for anything real.
