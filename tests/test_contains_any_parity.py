"""Cross-engine parity for the byte scanner behind every marker heuristic.

`containsAny` in js/image_meta.js was rewritten as a direct byte scan so a
multi-megabyte image no longer has to be turned into a latin-1 string first.
The image fixtures only reach it through whole files, so the marker lists and
the offsets they exercise are whatever those files happen to contain. This
drives the scanner directly against upstream `_contains_any` with upstream's
own marker tuples, over the placements that a rewrite gets wrong: nothing,
offset zero, end of blob, mixed case, a needle longer than the blob, and
overlapping needles.

Requires `node` and an upstream checkout (WATERMARKS_UPSTREAM_DIR, default
../watermarks-remover). Skips cleanly when either is missing.
"""
from __future__ import annotations

import base64
import json
import os
import random
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = Path(os.environ.get("WATERMARKS_UPSTREAM_DIR", ROOT.parent / "watermarks-remover"))
SCRIPTS = UPSTREAM / "service" / "scripts"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(
    NODE is None or not (SCRIPTS / "image_meta.py").is_file(),
    reason="needs node and an upstream checkout (WATERMARKS_UPSTREAM_DIR)",
)

if (SCRIPTS / "image_meta.py").is_file():
    sys.path.insert(0, str(SCRIPTS))
    import image_meta  # type: ignore  # noqa: E402

    NEEDLE_SETS = {
        "c2pa": image_meta.C2PA_MARKERS,
        "ai_meta": image_meta.AI_META_HINTS,
        "all_hints": image_meta.AI_META_HINTS + image_meta.C2PA_MARKERS,
        "jpeg_c2pa": image_meta.JPEG_C2PA_MARKERS,
        "jpeg_com": image_meta.JPEG_COM_AI_HINTS,
    }
else:  # pragma: no cover - the whole module skips
    NEEDLE_SETS = {}


def _filler(n: int, seed: int) -> bytes:
    """Bytes that cannot contain a marker by accident, including the high half."""
    rng = random.Random(seed)
    return bytes(rng.randrange(0x80, 0x100) for _ in range(n))


BLOBS = {
    "empty": b"",
    "no_markers": b"just an ordinary photo caption, nothing to see",
    "high_bytes": _filler(4096, 1),
    "at_offset_zero": b"c2pa" + _filler(64, 2),
    "at_end": _filler(64, 3) + b"contentcredentials",
    "split_case": b"CoNtEnTcReDeNtIaLs and DiGiTaLsOuRcEtYpE",
    "needle_longer_than_blob": b"cai",
    "prefix_without_suffix": b"contentcreden" + _filler(32, 4) + b"tials",
    "overlapping": b"c2pac2mac2pa",
    "adjacent_spellings": b"C2PAc2pa",
    "url_marker": b"xmlns:xmpMM=\"http://ns.adobe.com/xmp/InstanceID/\"",
    "buried": _filler(65536, 5) + b"trainedAlgorithmicMedia" + _filler(4096, 6),
    "repeated": b"AIGC " * 500,
    "false_start": b"c2p" * 300 + b"c2pa",
}


def _js(data: bytes, needles: list[str]) -> list[str]:
    req = {"mode": "scan", "file": base64.b64encode(data).decode(), "needles": needles}
    proc = subprocess.run([NODE, str(ROOT / "tests" / "image_meta_cli.js")], input=json.dumps(req),
                          capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)["found"]


@pytest.mark.parametrize("blob_name", sorted(BLOBS))
@pytest.mark.parametrize("set_name", sorted(NEEDLE_SETS))
def test_contains_any_parity(set_name: str, blob_name: str) -> None:
    needles = NEEDLE_SETS[set_name]
    data = BLOBS[blob_name]
    expected = image_meta._contains_any(data, needles)
    decoded = [n.decode("ascii", errors="replace") for n in needles]
    assert _js(data, decoded) == expected, (set_name, blob_name)
