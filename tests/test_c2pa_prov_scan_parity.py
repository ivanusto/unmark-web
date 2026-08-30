"""Cross-engine parity for the C2PA BMFF content-provenance user-type scan.

Upstream #264 recognizes a C2PA manifest in an ISOBMFF container by the user
type of its `uuid` box rather than by ASCII markers in the payload, and backs
that up with a whole-file scan for the same user type after a `uuid` fourcc.
The image and av fixtures reach the scan only through whole files, so this
drives it directly against upstream `_contains_c2pa_prov_box` over the
placements a rewrite gets wrong: the UUID with no fourcc in front of it, the
FullBox layout that puts it four bytes further on, a false `uuid` occurrence
before the real one, and the byte before the blob ends.

It also pins the chunked slice-driver counterpart in js/av_meta.js against the
same answers with a chunk size small enough that every fixture spans several
chunks, which is what a browser sees on a file too large to hold.

Requires `node` and an upstream checkout (WATERMARKS_UPSTREAM_DIR, default
../watermarks-remover). Skips cleanly when either is missing.
"""
from __future__ import annotations

import base64
import json
import os
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

UUID = bytes.fromhex("d8fec3d61b0e483c92975828877ec481")
OTHER = bytes.fromhex("be7acfcb97a942e89c71999491e3afac")

CASES: dict[str, bytes] = {
    "empty": b"",
    "plain": b"a plain mp4 with no manifest at all",
    "fourcc_then_uuid": b"\x00" * 8 + b"uuid" + UUID + b"rest",
    # Upstream's own assertion: the bytes alone are not enough.
    "uuid_bytes_without_fourcc": b"\x00" * 10 + UUID + b"\x00" * 10,
    "fullbox_offset4": b"\x00" * 8 + b"uuid" + b"\x00\x00\x00\x00" + UUID + b"tail",
    # One byte off on either side of the two accepted offsets.
    "offset1": b"uuid" + b"\x00" + UUID,
    "offset3": b"uuid" + b"\x00\x00\x00" + UUID,
    "offset5": b"uuid" + b"\x00" * 5 + UUID,
    # A decoy `uuid` fourcc has to advance the search, not end it.
    "decoy_then_real": b"uuid" + OTHER + b"padpadpaduuid" + UUID,
    "decoy_only": b"uuid" + OTHER + b"nothing else here",
    # The scan must not read past the end when the match window is cut short.
    "truncated_window": b"uuid" + UUID[:15],
    "truncated_fourcc": b"\x00" * 6 + b"uui",
    "uuid_at_very_end": b"\x00" * 32 + b"uuid" + UUID,
    "overlapping_fourccs": b"uuuuid" + UUID,
    "two_manifests": b"uuid" + UUID + b"first" + b"uuid" + UUID + b"second",
}


def _js_prov(data: bytes) -> bool:
    req = {"mode": "provscan", "file": base64.b64encode(data).decode()}
    proc = subprocess.run([NODE, str(ROOT / "tests" / "image_meta_cli.js")], input=json.dumps(req),
                          capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)["found"]


def _js_prov_file(data: bytes, chunk_size: int) -> bool:
    req = {"mode": "provscan-file", "file": base64.b64encode(data).decode(), "chunkSize": chunk_size}
    proc = subprocess.run([NODE, str(ROOT / "tests" / "av_meta_cli.js")], input=json.dumps(req),
                          capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)["found"]


@pytest.mark.parametrize("name", sorted(CASES))
def test_prov_scan_parity(name: str) -> None:
    data = CASES[name]
    assert _js_prov(data) == image_meta._contains_c2pa_prov_box(data), name


@pytest.mark.parametrize("chunk_size", [1, 4, 16, 29])
def test_slice_driver_scan_matches_the_buffered_one(chunk_size: int) -> None:
    """The chunked scan overlaps by one byte less than the match window.

    A manifest that straddles a chunk boundary has to be found anyway, so this
    runs every fixture at chunk sizes far below the 28-byte window.
    """
    for name, data in CASES.items():
        expected = image_meta._contains_c2pa_prov_box(data)
        assert _js_prov_file(data, chunk_size) == expected, (name, chunk_size)


def test_boundary_placement_at_every_offset() -> None:
    """Slide one manifest across a blob and past every chunk boundary."""
    for offset in range(0, 40):
        data = b"\x00" * offset + b"uuid" + UUID + b"\x00" * 8
        assert _js_prov(data) is True, offset
        assert _js_prov_file(data, 8) is True, offset
        assert image_meta._contains_c2pa_prov_box(data) is True, offset
