"""Cross-engine parity: js/av_meta.js must match upstream av_meta.py.

Two things are checked here. The buffer driver (inspectAv/cleanAv) has to agree
with upstream byte for byte, the same contract the image and text ports are held
to. The slice driver (inspectAvFile/cleanAvFile), which walks a File through
slice() so a video never has to be held in memory, then has to agree with the
buffer driver on the same fixtures: it is a second traversal over shared
primitives, and this is what stops it drifting away from the one parity checks.

The truncated-MP4 case this port once diverged on is asserted at the bottom,
now that upstream #242 has converged on the same behaviour.

Requires `node` and an upstream checkout (WATERMARKS_UPSTREAM_DIR, default
../watermarks-remover). Skips cleanly when either is missing.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = Path(os.environ.get("WATERMARKS_UPSTREAM_DIR", ROOT.parent / "watermarks-remover"))
SCRIPTS = UPSTREAM / "service" / "scripts"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(
    NODE is None or not (SCRIPTS / "av_meta.py").is_file(),
    reason="needs node and an upstream checkout (WATERMARKS_UPSTREAM_DIR)",
)

if (SCRIPTS / "av_meta.py").is_file():
    sys.path.insert(0, str(SCRIPTS))
    import av_meta  # type: ignore  # noqa: E402


# ---------------------------------------------------------------- builders

def iso_box(fourcc: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + fourcc + payload


XMP_UUID = bytes.fromhex("be7acfcb97a942e89c719994 91e3afac".replace(" ", ""))
XMP_AI = (b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF>'
          b"<digitalSourceType>trainedAlgorithmicMedia</digitalSourceType></rdf:RDF></x:xmpmeta>")
JUMBF = (b"\x00\x00\x00\x1fjumb\x00\x00\x00\x17jumdc2pa\x00\x11\x00\x10"
         b"\x80\x00\x00\xaa\x00\x38\x9b\x71\x03c2pa\x00")
# C2PA ContentProvenanceBox user type for BMFF containers (upstream #264).
C2PA_BMFF_UUID = bytes.fromhex("d8fec3d61b0e483c92975828877ec481")


def c2pa_prov(purpose: bytes = b"manifest", data: bytes | None = None,
              *, fullbox: bool = False) -> tuple[bytes, bytes]:
    """A top-level C2PA content-provenance `uuid` box.

    `data` defaults to a JUMBF-ish payload that the old substring scan would
    also have caught; pass binary data to exercise recognition by user type
    alone. `fullbox` puts a version/flags word before the user type, the
    defensive layout upstream also accepts.
    """
    if data is None:
        data = b"c2pa" + b"\x00" * 8 + b"jumb" + b"\x00" * 4
    head = b"\x00\x00\x00\x00" if fullbox else b""
    return b"uuid", head + C2PA_BMFF_UUID + purpose + b"\x00" + data


def make_mp4(boxes: list[tuple[bytes, bytes]], *, brand: bytes = b"isomiso2avc1mp41",
             mdat: int = 512) -> bytes:
    out = iso_box(b"ftyp", brand[:4] + b"\x00\x00\x02\x00" + brand)
    for fourcc, payload in boxes:
        out += iso_box(fourcc, payload)
    return out + iso_box(b"mdat", bytes(mdat))


def moov(*sub: bytes) -> tuple[bytes, bytes]:
    return b"moov", iso_box(b"mvhd", bytes(100)) + b"".join(sub)


def udta(text: bytes) -> bytes:
    return iso_box(b"udta", b"\x00\x00\x00\x00tool" + text)


def syncsafe(n: int) -> bytes:
    return bytes([(n >> 21) & 0x7F, (n >> 14) & 0x7F, (n >> 7) & 0x7F, n & 0x7F])


def id3v2(frames: list[tuple[bytes, bytes]], *, major: int = 4, ext: bool = False,
          footer: bool = False, padding: int = 0) -> bytes:
    """A well-formed ID3v2.3/2.4 tag. v2.2 needs make_id3v22 instead."""
    body = b""
    if ext:
        # v2.4 counts the extended header's own size field; v2.3 does not.
        body += syncsafe(6) + b"\x01\x00" if major == 4 else struct.pack(">I", 6) + bytes(6)
    for frame_id, payload in frames:
        size = syncsafe(len(payload)) if major == 4 else struct.pack(">I", len(payload))
        body += frame_id + size + b"\x00\x00" + payload
    body += bytes(padding)
    flags = (0x40 if ext else 0) | (0x10 if footer and major == 4 else 0)
    header = b"ID3" + bytes([major, 0, flags]) + syncsafe(len(body))
    tag = header + body
    if footer and major == 4:
        tag += b"3DI" + header[3:10]
    return tag


def make_id3v22(payload: bytes) -> bytes:
    """A v2.2 tag: detected, never decomposed into frames."""
    body = b"TT2" + bytes([0, 0, len(payload)]) + payload
    return b"ID3" + bytes([2, 0, 0]) + syncsafe(len(body)) + body


MPEG_FRAME = b"\xff\xfb\x90\x00" + bytes(100)
FLAC_STREAM = b"fLaC" + b"\x80\x00\x00\x22" + bytes(34)


def geob(mime: bytes, *, encoding: int = 0, filename: bytes = b"c2pa",
         description: bytes = b"manifest", data: bytes = b"\x01\x02\x03") -> bytes:
    return bytes([encoding]) + mime + b"\x00" + filename + b"\x00" + description + b"\x00" + data


def riff_chunk(cid: bytes, payload: bytes) -> bytes:
    return cid + struct.pack("<I", len(payload)) + payload + (b"\x00" if len(payload) & 1 else b"")


def make_wav(chunks: list[tuple[bytes, bytes]]) -> bytes:
    body = riff_chunk(b"fmt ", struct.pack("<HHIIHH", 1, 1, 8000, 8000, 1, 8))
    for cid, payload in chunks:
        body += riff_chunk(cid, payload)
    body += riff_chunk(b"data", bytes(64))
    return b"RIFF" + struct.pack("<I", 4 + len(body)) + b"WAVE" + body


AI_TEXT = b"\x00Generated by OpenAI Sora"
BENIGN_TEXT = b"\x00Recorded on a phone in Taipei"

SAMPLES: dict[str, bytes] = {
    # ---- MP4 / MOV
    "mp4_clean": make_mp4([moov()]),
    "mp4_udta_ai": make_mp4([moov(udta(b"Generated by OpenAI Sora"))]),
    "mp4_udta_benign": make_mp4([moov(udta(b"Recorded on a phone in Taipei"))]),
    "mp4_xmp": make_mp4([moov(), (b"uuid", XMP_UUID + XMP_AI)]),
    "mp4_c2pa": make_mp4([moov(), (b"jumb", JUMBF)]),
    "mp4_uuid_plain": make_mp4([moov(), (b"uuid", b"\x11" * 16 + b"harmless camera note")]),
    "mp4_meta": make_mp4([moov(), (b"meta", b"\x00\x00\x00\x00" + iso_box(b"iinf", b"Generated by OpenAI"))]),
    "mp4_udta_and_xmp": make_mp4([moov(udta(b"Generated by OpenAI Sora")), (b"uuid", XMP_UUID + XMP_AI)]),
    "mov_quicktime": make_mp4([moov(udta(b"Generated by OpenAI Sora"))], brand=b"qt  qt  "),
    "m4a_audio": make_mp4([moov(udta(b"SynthID"))], brand=b"M4A M4A mp42"),
    # ---- MP4 C2PA content-provenance uuid boxes (upstream #264)
    "mp4_c2pa_prov": make_mp4([moov(), c2pa_prov()]),
    # No ASCII c2pa/jumb anywhere in the payload: the old substring scan missed
    # this one entirely in keep mode.
    "mp4_c2pa_prov_no_marker": make_mp4([moov(), c2pa_prov(data=bytes(range(1, 64)))]),
    "mp4_c2pa_prov_merkle": make_mp4([moov(), c2pa_prov(b"merkle", bytes(range(1, 128)))]),
    "mp4_c2pa_prov_fullbox": make_mp4([moov(), c2pa_prov(fullbox=True)]),
    # An update manifest is appended as the last box, after mdat.
    "mp4_c2pa_prov_update_last": (
        make_mp4([moov()]) + iso_box(b"uuid", C2PA_BMFF_UUID + b"update\x00" + bytes(range(1, 32)))
    ),
    # The same 16 bytes at an offset the spec does not use: not a manifest, and
    # it has to survive a keep-mode clean.
    "mp4_uuid_c2pa_bytes_bad_offset": make_mp4(
        [moov(), (b"uuid", b"\x00" + C2PA_BMFF_UUID + b"not-a-manifest")]
    ),
    # ---- WAV
    "wav_clean": make_wav([]),
    "wav_c2pa": make_wav([(b"C2PA", JUMBF)]),
    "wav_info_ai": make_wav([(b"LIST", b"INFO" + riff_chunk(b"ISFT", b"Generated by OpenAI\x00"))]),
    "wav_info_benign": make_wav([(b"LIST", b"INFO" + riff_chunk(b"ISFT", b"Audacity 3.4\x00"))]),
    "wav_list_not_info": make_wav([(b"LIST", b"adtl" + riff_chunk(b"note", b"Generated by OpenAI\x00"))]),
    "wav_id3_ai": make_wav([(b"id3 ", id3v2([(b"TSSE", AI_TEXT)]))]),
    "wav_id3_benign": make_wav([(b"id3 ", id3v2([(b"TSSE", BENIGN_TEXT)]))]),
    "wav_odd_chunk": make_wav([(b"LIST", b"INFO" + riff_chunk(b"ISFT", b"Generated by OpenAI\x00")),
                              (b"note", b"odd")]),
    # A chunk whose declared size overruns: the remainder is copied verbatim.
    "wav_overrun": make_wav([]) + b"junk" + struct.pack("<I", 0xFFFF) + b"tail",
    # ---- MP3
    "mp3_no_tag": MPEG_FRAME * 3,
    "mp3_clean_v24": id3v2([(b"TIT2", b"\x00A song")]) + MPEG_FRAME,
    "mp3_ai_v24": id3v2([(b"TIT2", b"\x00A song"), (b"TSSE", AI_TEXT)]) + MPEG_FRAME,
    "mp3_ai_v23": id3v2([(b"TIT2", b"\x00A song"), (b"TSSE", AI_TEXT)], major=3) + MPEG_FRAME,
    "mp3_ai_ext_v24": id3v2([(b"TSSE", AI_TEXT)], ext=True) + MPEG_FRAME,
    "mp3_ai_ext_v23": id3v2([(b"TSSE", AI_TEXT)], major=3, ext=True) + MPEG_FRAME,
    "mp3_ai_footer_v24": id3v2([(b"TSSE", AI_TEXT)], footer=True) + MPEG_FRAME,
    "mp3_padding": id3v2([(b"TSSE", AI_TEXT)], padding=32) + MPEG_FRAME,
    "mp3_v22_ai": make_id3v22(b"\x00Generated by OpenAI") + MPEG_FRAME,
    "mp3_v22_benign": make_id3v22(b"\x00A song") + MPEG_FRAME,
    "mp3_geob_c2pa": id3v2([(b"GEOB", geob(b"application/c2pa"))]) + MPEG_FRAME,
    # ---- FLAC
    "flac_plain": FLAC_STREAM,
    "flac_geob_c2pa": id3v2([(b"GEOB", geob(b"application/c2pa"))]) + FLAC_STREAM,
    "flac_geob_other": id3v2([(b"GEOB", geob(b"image/jpeg"))]) + FLAC_STREAM,
    "flac_geob_and_text": id3v2([(b"TIT2", b"\x00A song"), (b"GEOB", geob(b"application/c2pa"))]) + FLAC_STREAM,
    "flac_geob_utf16": id3v2([(b"GEOB", geob(b"application/c2pa", encoding=1,
                                             filename=b"c\x00\x00\x00", description=b"m\x00\x00\x00"))]) + FLAC_STREAM,
    "flac_geob_only_ext": id3v2([(b"GEOB", geob(b"application/c2pa"))], ext=True) + FLAC_STREAM,
    # ---- not audio or video at all
    "not_av": b"\x89PNG\r\n\x1a\n" + bytes(64),
}


def _js(mode: str, data: bytes, options: dict | None = None) -> dict:
    req = {"mode": mode, "file": base64.b64encode(data).decode(), "options": options or {}}
    proc = subprocess.run([NODE, str(ROOT / "tests" / "av_meta_cli.js")], input=json.dumps(req),
                          capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def _py_inspect(data: bytes, fmt: str) -> tuple[bool, bool, list[str]]:
    if fmt == "mp4":
        return av_meta._inspect_mp4(data)
    if fmt == "wav":
        return av_meta._inspect_wav(data)
    if fmt == "mp3":
        return av_meta._inspect_id3v2(data)
    if fmt == "flac":
        return av_meta._inspect_flac(data)
    return False, False, ["unsupported format (MP4/MOV/M4A/WAV/MP3/FLAC)"]


def _py_clean(data: bytes, fmt: str, strip_all: bool) -> tuple[bytes, list[str], bool]:
    """Upstream #242 gave _strip_mp4 a third return value; the others still have two."""
    if fmt == "mp4":
        return av_meta._strip_mp4(data, strip_all_metadata=strip_all)
    if fmt == "wav":
        cleaned, actions = av_meta._strip_wav(data, strip_all_metadata=strip_all)
    elif fmt == "mp3":
        cleaned, actions = av_meta._strip_id3v2(data, strip_all_metadata=strip_all)
    else:
        cleaned, actions = av_meta._strip_flac(data, strip_all_metadata=strip_all)
    return cleaned, actions, False


@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_detect_parity(name: str) -> None:
    data = SAMPLES[name]
    assert _js("detect", data)["format"] == av_meta.detect_av_format(data), name


@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_inspect_parity(name: str) -> None:
    data = SAMPLES[name]
    fmt = av_meta.detect_av_format(data)
    has_c2pa, has_ai, findings = _py_inspect(data, fmt)
    js = _js("inspect", data)
    assert js["format"] == fmt, name
    assert (js["has_c2pa"], js["has_ai_metadata"], js["findings"]) == (has_c2pa, has_ai, findings), name


@pytest.mark.parametrize("name", sorted(k for k in SAMPLES if k != "not_av"))
@pytest.mark.parametrize("strip_all", [True, False])
def test_clean_parity(name: str, strip_all: bool) -> None:
    data = SAMPLES[name]
    fmt = av_meta.detect_av_format(data)
    py_bytes, py_actions, py_incomplete = _py_clean(data, fmt, strip_all)
    js = _js("clean", data, {"stripAllMetadata": strip_all})
    assert "error" not in js, js
    assert js["format"] == fmt, name
    assert js["actions"] == py_actions, name
    assert js["inspectionIncomplete"] == py_incomplete, name
    assert base64.b64decode(js["data"]) == py_bytes, name


def test_clean_rejects_a_format_it_does_not_handle() -> None:
    js = _js("clean", SAMPLES["not_av"])
    assert "unsupported audio/video format" in js["error"]


def test_inspect_notes_only_when_the_format_is_unknown() -> None:
    assert _js("inspect", SAMPLES["not_av"])["notes"] == [
        "format not fully inspected; only MP4/MOV/M4A/WAV/MP3/FLAC are supported"]
    assert _js("inspect", SAMPLES["mp4_clean"])["notes"] == []


# ------------------------------------------------- the two drivers must agree

@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_slice_driver_inspect_matches_buffer_driver(name: str) -> None:
    data = SAMPLES[name]
    assert _js("inspect-file", data) == _js("inspect", data), name
    assert _js("detect-file", data) == _js("detect", data), name


@pytest.mark.parametrize("name", sorted(k for k in SAMPLES if k != "not_av"))
@pytest.mark.parametrize("strip_all", [True, False])
def test_slice_driver_clean_matches_buffer_driver(name: str, strip_all: bool) -> None:
    data = SAMPLES[name]
    opts = {"stripAllMetadata": strip_all}
    assert _js("clean-file", data, opts) == _js("clean", data, opts), name


# ------------------------------------------------- the tail upstream once lost

TRUNCATED_MP4 = SAMPLES["mp4_udta_ai"][:-256]


def test_c2pa_prov_uuid_is_recognized_by_user_type() -> None:
    """Upstream #264, stated as behaviour rather than as parity.

    A content-provenance box goes even in keep mode, both drivers agree, and
    the equal-size `free` replacement leaves mdat where it was. A uuid box that
    merely holds the same 16 bytes at an unused offset stays.
    """
    for name in ("mp4_c2pa_prov", "mp4_c2pa_prov_no_marker", "mp4_c2pa_prov_merkle",
                 "mp4_c2pa_prov_fullbox", "mp4_c2pa_prov_update_last"):
        src = SAMPLES[name]
        for mode in ("inspect", "inspect-file"):
            assert _js(mode, src)["has_c2pa"] is True, (name, mode)
        for strip_all in (True, False):
            for mode in ("clean", "clean-file"):
                out = base64.b64decode(_js(mode, src, {"stripAllMetadata": strip_all})["data"])
                assert C2PA_BMFF_UUID not in out, (name, mode, strip_all)
                assert len(out) == len(src), (name, mode, strip_all)
                assert out.index(b"mdat") == src.index(b"mdat"), (name, mode, strip_all)
                assert b"free" in out, (name, mode, strip_all)

    src = SAMPLES["mp4_uuid_c2pa_bytes_bad_offset"]
    for mode in ("inspect", "inspect-file"):
        assert _js(mode, src)["has_c2pa"] is False, mode
    for mode in ("clean", "clean-file"):
        kept = base64.b64decode(_js(mode, src, {"stripAllMetadata": False})["data"])
        assert C2PA_BMFF_UUID in kept, mode


def test_truncated_mp4_keeps_its_tail_the_way_upstream_now_does() -> None:
    """guillaumemeyer/watermarks-remover#240, fixed upstream by #242.

    upstream's _strip_moov_udta used to rebuild the file from the boxes that
    parsed, so everything after the first box whose size overran the data was
    discarded, even though the strip_isobmff pass just before it had preserved
    that tail and put "kept N bytes of truncated tail" in the action list. This
    port kept the tail, as upstream #182 already established for PNG and
    ISOBMFF. #242 took the same approach, so this asserts the two agree rather
    than that they differ, and covers the inspection_incomplete flag it added.
    """
    upstream_bytes, upstream_actions, upstream_incomplete = av_meta._strip_mp4(
        TRUNCATED_MP4, strip_all_metadata=True)
    assert any("kept" in a and "truncated tail" in a for a in upstream_actions)
    assert len(upstream_bytes) == len(TRUNCATED_MP4), "upstream keeps the media since #242"
    assert upstream_incomplete is True

    for mode in ("clean", "clean-file"):
        js = _js(mode, TRUNCATED_MP4, {"stripAllMetadata": True})
        cleaned = base64.b64decode(js["data"])
        assert js["actions"] == upstream_actions, mode
        assert js["inspectionIncomplete"] is True, mode
        assert cleaned == upstream_bytes, mode
        assert len(cleaned) == len(TRUNCATED_MP4), mode


def test_a_complete_mp4_is_not_reported_as_partially_inspected() -> None:
    """The flag has to stay off for the files that parse whole, in both drivers."""
    for mode in ("clean", "clean-file"):
        js = _js(mode, SAMPLES["mp4_udta_ai"], {"stripAllMetadata": True})
        assert js["inspectionIncomplete"] is False, mode


def test_truncated_mp4_still_inspects_like_upstream() -> None:
    has_c2pa, has_ai, findings = av_meta._inspect_mp4(TRUNCATED_MP4)
    for mode in ("inspect", "inspect-file"):
        js = _js(mode, TRUNCATED_MP4)
        assert (js["has_c2pa"], js["has_ai_metadata"], js["findings"]) == (has_c2pa, has_ai, findings), mode
