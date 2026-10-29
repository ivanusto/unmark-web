"""Fast-DetectGPT must be wired into the detector registry and every i18n language block."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANG_KEYS = ("det.fast-detectgpt", "inspect.noteFastDetectGpt", "rewriteMeterFdg")


def test_sidecar_ids_include_fast_detectgpt() -> None:
    src = (ROOT / "js" / "detectors.js").read_text(encoding="utf-8")
    m = re.search(r"SIDECAR_IDS\s*=\s*\[([^\]]*)\]", src)
    assert m and '"fast-detectgpt"' in m.group(1)


def test_fast_detectgpt_registered_as_heuristic() -> None:
    src = (ROOT / "js" / "detectors.js").read_text(encoding="utf-8")
    i = src.index('id: "fast-detectgpt"')
    reg = src[i:src.index("});", i)]
    assert "heuristic: true" in reg


def test_i18n_blocks_have_fdg_keys() -> None:
    src = (ROOT / "js" / "i18n.js").read_text(encoding="utf-8")
    starts = [src.index(f"\n    {lang}: {{") for lang in ('en', '"zh-Hant"', '"zh-Hans"') if f"\n    {lang}: {{" in src]
    assert len(starts) == 3
    bounds = starts + [len(src)]
    for a, b in zip(bounds, bounds[1:]):
        block = src[a:b]
        for k in LANG_KEYS:
            assert k in block, k
