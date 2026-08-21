# unmark-stat: statistical text-watermark sidecar (local only)

`unmark_stat.py` is a small, stdlib-HTTP Python service that gives the web UI
**real** detection of two published token-level ("statistical") text watermarks,
plus demo generation so you can see them work:

| id | scheme | how |
| --- | --- | --- |
| `kgw` | Kirchenbauer et al., *A Watermark for Large Language Models* (green-list / z-score) | Hugging Face `WatermarkingConfig` + `WatermarkDetector` (`lefthash`, context width 1, γ = 0.25, δ = 3.0) |
| `synthid-text` | SynthID-Text (Dathathri et al., *Nature* 2024) | HF `SynthIDTextWatermarkLogitsProcessor` + the MIT-licensed Bayesian detector bundles from [xlr8harder/synthid](https://github.com/xlr8harder/synthid), trained for `Qwen/Qwen3-4B-Instruct-2507` |

The rest of the app (Layer A cleaning, metadata stripping, stylometry) runs in
the page. This part cannot: it needs a model and, in practice, a GPU.

## Why it is local-only

- [The hosted build](https://ivanusto.github.io/unmark-web/) is HTTPS. Browsers
  block an HTTPS page from calling a plain-HTTP loopback service, so GitHub
  Pages can never reach this sidecar. It only works through `serve_local.py`,
  which proxies `/stat/*` same-origin.
- It loads an 8 GB language model and scores tokens with it. That is not a
  browser job.
- Nothing leaves your machine. The sidecar binds `127.0.0.1` and talks to
  nothing but the Hugging Face Hub (once, to download weights).

## Setup

```bash
cd sidecar
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt      # pick the torch build for your GPU from pytorch.org first if needed
```

First use downloads, into your Hugging Face cache (`~/.cache/huggingface`):

| what | size |
| --- | --- |
| `Qwen/Qwen3-4B-Instruct-2507` (bf16 safetensors) | ≈ 8 GB |
| `xlr8harder/synthid-qwen3-4b-instruct-2507-detectors` (two small Bayesian detectors, sampling tables, evaluation JSON; the repo also carries per-sample score files) | ≈ 100 MB |

Qwen3's model license is between you and its publisher; read it on the model
card before downloading. The detector bundles and experiment keys are MIT.

## Run

```bash
# terminal 1: the sidecar (127.0.0.1:8767; model loads lazily on first request)
.venv/bin/python unmark_stat.py
#   --port 8767 / UNMARK_STAT_PORT
#   --api-key "$KEY" / UNMARK_STAT_API_KEY    every request must then carry Authorization: Bearer $KEY
#   --model Qwen/Qwen3-4B-Instruct-2507       (the SynthID detectors are only valid for this one)
#   --device auto|cuda|cpu
#   --no-generate                             detection only
#   --preload                                 load everything at startup

# terminal 2: the UI, pointing /stat at it
cd .. && python3 serve_local.py --stat-upstream http://127.0.0.1:8767 [--stat-api-key "$KEY"]
# equivalently UNMARK_STAT_URL / UNMARK_STAT_API_KEY
# open http://127.0.0.1:8766/
```

`serve_local.py` injects the sidecar key itself and never forwards the
browser's `Authorization` header to `/stat/*`; `GET /stat-config` tells the UI
only `{"enabled": true|false}`, with no URL and no key.

## API

```
GET  /health
     → {ok, device, model, loaded, generate, detectors:[{id, available, requires_key, requires_model, key_profiles, model, note}]}

POST /detect    {"text": "...", "detectors": ["kgw","synthid-text"], "key_profile": "a"|"b"}
     → {ok, results:[{detector, status, confidence, score, threshold, evidence:[{label,detail}], note,
                       requires_key:true, requires_model:true, local:true, meta:{model, key_profile, tokens, tokens_scored, ...}}]}
     status ∈ clean | detected | uncertain | unavailable | not_tested | error

POST /generate  {"prompt": "...", "scheme": "kgw"|"synthid"|"none", "key_profile": "a"|"b", "max_new_tokens": ≤1024}
     → {ok, text, scheme, key_profile, tokens, model, sampler:{temperature, top_k, top_p}}
```

Errors are `{"ok": false, "error": "..."}`. Body cap 2 MiB. One GPU job at a
time (a global lock); long texts are truncated to 4096 tokens before scoring.

### Key profiles

Both schemes are keyed, so the sidecar ships two profiles, `a` and `b`:

- **KGW**: the key is one integer (`hashing_key`). `a` = 15485863 (the
  original KGW default), `b` = 32452843. Any other integer is "another key".
- **SynthID-Text**: `keys/key-a.json` and `keys/key-b.json`, the public
  experiment keys from xlr8harder/synthid, each paired with its own detector
  bundle (`same-model-matched/key-{a,b}/model`). See [`keys/README.md`](keys/README.md):
  they are public, they must not be reused for deployment, and text marked
  with them proves nothing about provenance.

### How the verdicts are made

- **KGW**: `detected` if z ≥ 4, `clean` if z < 2, else `uncertain`; fewer than
  50 scored tokens → `uncertain` ("too short"). Evidence: z-score, one-sided
  p-value (exact normal tail), green fraction, tokens scored. Two choices
  worth knowing: seeding is `lefthash` (greenlist seeded by the previous
  token, the paper's `simple_1`), because HF's `selfhash` with context width
  1 seeds on the candidate token alone and so becomes a fixed green/red split
  of the vocabulary (measured here, unwatermarked text then scored z ≈ ±4
  from its token mix alone); and generation uses δ = 3.0 rather than the
  paper's 2.0, because on this low-entropy instruct model δ = 2.0 gave
  z ≈ 4.4–5.2 at 450 tokens (borderline) while 3.0 gives z ≈ 7. δ does not
  enter detection, only γ, the seeding and the key do.
- **SynthID-Text**: score = the Bayesian detector's posterior P(watermarked).
  `detected` above the bundle's own 1 %-validation-FPR threshold
  (`evaluation-summary.json`, picked at the nearest evaluated length ≤ tokens
  scored: 50/100/200/400; ≈ 0.91 at 200 tokens); `clean` below 0.12 (our
  choice: in the bundle's released per-sample scores about 60 % of 200-token
  negatives and only ≈ 2 % of matching-key positives fall under it); else
  `uncertain`. Fewer than 100 scored n-grams → forced `uncertain` (the
  detectors were evaluated at 100–400 tokens; headline numbers are at 200).
  On load, the HF-generated sampling table is compared byte-for-byte with the
  bundle's `sampling-table.int64le`; if it differs (torch's CPU and CUDA RNG
  streams differ), the bundle's table is loaded instead and `meta.table` says so.

## Honest limits: read before trusting a verdict

- **A watermark is only visible to its own key.** Detection is valid for text
  produced with the *same* scheme, the *same* key and the *same* tokenizer.
  `clean` means "not marked with *this* key", never "not AI-written". Text
  from Gemini, ChatGPT, Claude, or anyone whose key you do not hold **cannot
  be judged here**, and the sidecar will happily call it `clean`.
- **The SynthID detectors are for one model.** They were trained on
  `Qwen3-4B-Instruct-2507` outputs sampled at temperature 0.7 / top-k 100 /
  top-p 1.0 (the upstream "paper" profile, which is exactly what `/generate` uses).
  Other models or samplers shift the score distribution; upstream measured
  Key-A detection dropping from ≈ 71 % to ≈ 34 % just by changing the sampler.
- **Short text says little.** Upstream's same-model detectors reach ≈ 71 %
  (key A) / ≈ 68 % (key B) true-positive rate at 200 tokens and 1 % FPR; at
  100 tokens it is ≈ 38 %. A `clean` on 150 tokens is weak evidence.
- **Paraphrasing removes it.** Upstream's blind rephrase with an unwatermarked
  4B model took matching-key detection from ≈ 70 % to ≈ 4–5 %. That is the
  whole point of the statistical-watermark row in the app's table.
- **Layer A does not touch it.** Zero-width / homoglyph cleaning changes
  characters, not the token-choice statistics. Re-detecting after cleaning
  should give the same verdict. That is the demo below, and it is the reason
  the app is explicit that it does not remove statistical watermarks.

## Demo flow (what the UI walks through)

1. `POST /generate {scheme:"synthid", key_profile:"a", max_new_tokens:400}`
   returns a paragraph watermarked with key A.
2. `POST /detect {key_profile:"a"}` → SynthID `detected` (posterior ≈ 1.0),
   KGW `clean` (different scheme).
3. `POST /detect {key_profile:"b"}` → SynthID `clean`/`uncertain` with a low
   posterior: wrong key, nothing to see.
4. Run the text through Layer A cleaning in the page. Nothing visible changes
   (it contained no invisible characters to begin with).
5. `POST /detect {key_profile:"a"}` again → still `detected`. Cleaning did not
   remove it; only rewriting would.

The same with `scheme:"kgw"`: key A → z ≈ 7, key B → z ≈ 0.

Measured on one run (Qwen3-4B-Instruct-2507, bf16, 450 new tokens, the coffee
prompt), to set expectations rather than promise them:

| text | SynthID key a | SynthID key b | KGW key a | KGW key b |
| --- | --- | --- | --- | --- |
| generated, SynthID key a | 0.99999 → detected | 0.0001 → clean | z 0.74 → clean | z 0.52 → clean |
| generated, KGW key a (δ 3.0) | 0.007 → clean | 0.001 → clean | z 6.08 → detected | z 0.30 → clean |
| generated, no watermark | 0.002 → clean | 0.083 → clean | z −0.03 → clean | z 1.28 → clean |
| human-written, 340 tokens | 0.015 → clean | 0.31 → uncertain | z 1.41 → clean | z 0.41 → clean |

That `uncertain` on the human paragraph under key b is what the 0.12…0.92
band is for: a posterior of 0.31 is nowhere near the 1 %-FPR threshold, but
the detector is not confident enough to be called clean either.

## Files

- `unmark_stat.py`: the service (stdlib HTTP; torch/transformers imported lazily)
- `requirements.txt`: Python deps
- `keys/`: vendored SynthID experiment keys + provenance
