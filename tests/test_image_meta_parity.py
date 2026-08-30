"""Cross-engine parity: js/image_meta.js must produce the same bytes as upstream image_meta.py."""
from __future__ import annotations

import base64
import json
import os
import shutil
import struct
import subprocess
import sys
import zlib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = Path(os.environ.get("WATERMARKS_UPSTREAM_DIR", ROOT.parent / "watermarks-remover"))
SCRIPTS = UPSTREAM / "service" / "scripts"
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None or not (SCRIPTS / "image_meta.py").is_file(),
                                reason="needs node and an upstream checkout (WATERMARKS_UPSTREAM_DIR)")
if (SCRIPTS / "image_meta.py").is_file():
    sys.path.insert(0, str(SCRIPTS))
    import image_meta  # type: ignore  # noqa: E402


def png_chunk(ctype: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + ctype + payload + struct.pack(">I", zlib.crc32(ctype + payload) & 0xFFFFFFFF)


def make_png(extra: list[tuple[bytes, bytes]]) -> bytes:
    ihdr = png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    idat = png_chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00\xff"))
    body = ihdr
    for t, p in extra[: len(extra) // 2]:
        body += png_chunk(t, p)
    body += idat
    for t, p in extra[len(extra) // 2:]:
        body += png_chunk(t, p)
    return image_meta.PNG_SIG + body + png_chunk(b"IEND", b"")


def jpeg_seg(marker: int, payload: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload


def make_jpeg(apps: list[tuple[int, bytes]]) -> bytes:
    out = b"\xff\xd8" + jpeg_seg(0xE0, b"JFIF\x00\x01\x02\x00\x00\x01\x00\x01\x00\x00")
    for m, p in apps:
        out += jpeg_seg(m, p)
    out += jpeg_seg(0xDB, b"\x00" + bytes(64)) + jpeg_seg(0xC0, b"\x08\x00\x01\x00\x01\x01\x01\x11\x00")
    out += jpeg_seg(0xC4, b"\x00" + bytes(16) + b"\x00") + jpeg_seg(0xDA, b"\x01\x01\x00\x00\x3f\x00")
    return out + b"\x12\x34\xff\x00\x56" + b"\xff\xd9"


def riff_chunk(fourcc: bytes, payload: bytes) -> bytes:
    return fourcc + struct.pack("<I", len(payload)) + payload + (b"\x00" if len(payload) & 1 else b"")


def make_webp(chunks: list[tuple[bytes, bytes]], flags: int) -> bytes:
    vp8x = riff_chunk(b"VP8X", bytes([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    vp8 = riff_chunk(b"VP8 ", b"\x00" * 11)
    body = b"WEBP" + vp8x
    for f, p in chunks:
        body += riff_chunk(f, p)
    body += vp8
    return b"RIFF" + struct.pack("<I", len(body)) + body


XMP_AI = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><digitalSourceType>trainedAlgorithmicMedia</digitalSourceType></rdf:RDF></x:xmpmeta>'
JUMBF = b"\x00\x00\x00\x1fjumb\x00\x00\x00\x17jumdc2pa\x00\x11\x00\x10\x80\x00\x00\xaa\x00\x38\x9b\x71\x03c2pa\x00"
XMP_UUID = b"\xbe\x7a\xcf\xcb\x97\xa9\x42\xe8\x9c\x71\x99\x94\x91\xe3\xaf\xac"
# C2PA ContentProvenanceBox user type for BMFF containers (upstream #264). A
# manifest lives in a top-level `uuid` box carrying this user type, not in a
# `c2pa` box, so a payload with no ASCII marker is recognized by type alone.
C2PA_BMFF_UUID = bytes.fromhex("d8fec3d61b0e483c92975828877ec481")


def iso_box(fourcc: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload) + 8) + fourcc + payload


def iso_meta(sub: list[tuple[bytes, bytes]]) -> bytes:
    """meta box payload: 4-byte version/flags then sub-boxes."""
    return b"\x00\x00\x00\x00" + b"".join(iso_box(f, p) for f, p in sub)


def make_isobmff(brand: bytes, boxes: list[tuple[bytes, bytes]]) -> bytes:
    ftyp = iso_box(b"ftyp", brand + b"\x00\x00\x00\x00" + brand + b"mif1")
    return ftyp + b"".join(iso_box(f, p) for f, p in boxes) + iso_box(b"mdat", b"\x00" * 8)


def truncate_isobmff(data: bytes, cut: int) -> bytes:
    """Drop the last `cut` bytes, so the final box overruns the buffer.

    Upstream #170: the rebuild used to emit only the boxes that parsed, which
    threw away a half-written mdat (the coded image) while reporting the file
    as already clean.
    """
    return data[:-cut]


def make_truncated_png(extra: list[tuple[bytes, bytes]], tail: bytes) -> bytes:
    """A PNG cut mid-IDAT, with no IEND: the last chunk header declares more
    payload than the file actually holds. Built without make_png because both
    engines stop walking at IEND, so a tail appended after one is never seen.
    """
    body = image_meta.PNG_SIG + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    for t, payload in extra:
        body += png_chunk(t, payload)
    return body + struct.pack(">I", 4096) + b"IDAT" + tail



# --- BMP / GIF / TIFF builders, mirroring upstream tests/test_image_formats_bmp_gif_tiff.py ---

def make_bmp(trailing: bytes = b"") -> bytes:
    pixel = b"\x00\x00\xff\xff"  # BGRA, 1x1 32-bit, no row padding
    dib = struct.pack("<IiiHHIIiiII", 40, 1, 1, 1, 32, 0, len(pixel), 0, 0, 0, 0)
    data_offset = 14 + len(dib)
    header = b"BM" + struct.pack("<IHHI", data_offset + len(pixel), 0, 0, data_offset)
    return header + dib + pixel + trailing


def gif_extension(label: int, payload: bytes) -> bytes:
    out = b"\x21" + bytes([label])
    pos = 0
    while pos < len(payload):
        chunk = payload[pos:pos + 255]
        out += bytes([len(chunk)]) + chunk
        pos += 255
    return out + b"\x00"


def make_gif(*extensions: tuple[int, bytes]) -> bytes:
    lsd = struct.pack("<HHBBB", 1, 1, 0x00, 0x00, 0x00)
    image = b"\x2c" + struct.pack("<HHHHB", 0, 0, 1, 1, 0x00) + b"\x02" + b"\x02\x02\x44" + b"\x00"
    return b"GIF89a" + lsd + b"".join(gif_extension(l, p) for l, p in extensions) + image + b"\x3b"


GIF_XMP_PAYLOAD = b"XMP DataXMP" + XMP_AI


def _tiff_entry(bo: str, big: bool, tag: int, ftype: int, fcount: int, value: bytes) -> bytes:
    count_fmt = bo + ("Q" if big else "I")
    return struct.pack(bo + "HH", tag, ftype) + struct.pack(count_fmt, fcount) + value


def make_tiff(*, big_endian: bool = False, big: bool = False, with_meta: bool = True) -> bytes:
    """Classic or BigTIFF with strip offsets, an ExifIFD chain and metadata tags.

    Offsets are laid out by hand so the parity test exercises the in-place patch
    path: strip data must stay byte-identical and reachable after cleaning.
    """
    bo = ">" if big_endian else "<"
    off_fmt = bo + ("Q" if big else "I")
    count_fmt = bo + ("Q" if big else "H")
    count_len = 8 if big else 2
    off_len = 8 if big else 4
    entry_size = 20 if big else 12
    header_size = 16 if big else 8
    xmp = XMP_AI
    make = b"Acme Corp\x00"
    dt = b"2024:01:01 10:00:00\x00"
    maker = b"AIGC maker\x00"
    strip_data = b"\xaa\xbb\xcc\xdd\xee\xff\x00\x11"

    def short_val(v: int) -> bytes:
        return struct.pack(bo + "H", v) + b"\x00" * (off_len - 2)

    def long_val(v: int) -> bytes:
        return struct.pack(off_fmt, v)

    base = [(256, 4, 1, long_val(1)), (257, 4, 1, long_val(1)), (258, 3, 1, short_val(8)),
            (259, 3, 1, short_val(1)), (262, 3, 1, short_val(2)), (273, 4, 1, b"\x00" * off_len),
            (278, 4, 1, long_val(1)), (279, 4, 1, long_val(len(strip_data)))]
    if with_meta:
        base += [(271, 2, len(make), b"\x00" * off_len), (700, 2, len(xmp), b"\x00" * off_len),
                 (34665, 4, 1, b"\x00" * off_len)]
    count = len(base)
    ifd0_off = header_size
    cursor = ifd0_off + count_len + count * entry_size + off_len

    exif_count = 3 if with_meta else 0
    exif_off = cursor if with_meta else 0
    exp_payload = struct.pack(bo + "II", 1, 100)
    exp_off = dt_off = mn_off = 0
    if with_meta:
        cursor += count_len + exif_count * entry_size + off_len
        exp_off = cursor
        cursor += len(exp_payload)
        dt_off = cursor
        cursor += len(dt)
        mn_off = cursor
        cursor += len(maker)

    strip_off = cursor
    cursor += len(strip_data)
    make_off = cursor
    cursor += len(make)
    xmp_off = cursor

    ifd0 = bytearray(struct.pack(count_fmt, count))
    for tag, ftype, fcount, value in base:
        if tag == 273:
            ifd0 += _tiff_entry(bo, big, tag, 4, 1, long_val(strip_off))
        elif tag == 271:
            ifd0 += _tiff_entry(bo, big, tag, 2, len(make), long_val(make_off))
        elif tag == 700:
            ifd0 += _tiff_entry(bo, big, tag, 2, len(xmp), long_val(xmp_off))
        elif tag == 34665:
            ifd0 += _tiff_entry(bo, big, tag, 4, 1, long_val(exif_off))
        else:
            ifd0 += _tiff_entry(bo, big, tag, ftype, fcount, value)
    ifd0 += struct.pack(off_fmt, 0)

    if with_meta:
        exif = bytearray(struct.pack(count_fmt, exif_count))
        exif += _tiff_entry(bo, big, 33434, 5, 1, long_val(exp_off))
        exif += _tiff_entry(bo, big, 36867, 2, len(dt), long_val(dt_off))
        exif += _tiff_entry(bo, big, 37500, 2, len(maker), long_val(mn_off))
        exif += struct.pack(off_fmt, 0)
        tail = exp_payload + dt + maker + strip_data + make + xmp
    else:
        exif = b""
        tail = strip_data + make + xmp

    magic = 43 if big else 42
    header = (b"MM" if big_endian else b"II") + struct.pack(bo + "H", magic)
    if big:
        header += struct.pack(bo + "H", 8) + struct.pack(bo + "H", 0)
    header += struct.pack(off_fmt, ifd0_off)
    return header + bytes(ifd0) + bytes(exif) + tail


SAMPLES = {
    "png_clean": make_png([]),
    "png_text": make_png([(b"tEXt", b"Software\x00Photoshop"), (b"iTXt", b"XML:com.adobe.xmp\x00\x00\x00\x00\x00" + XMP_AI)]),
    "png_exif_c2pa": make_png([(b"eXIf", b"MM\x00*"), (b"caBX", JUMBF), (b"tIME", bytes(7)), (b"pHYs", bytes(9))]),
    "png_private_c2pa": make_png([(b"prVt", b"hello contentcredentials"), (b"tRNS", b"\x00\x00")]),
    # Upstream #125: product names are matched only against the values of the
    # generator-bearing keys (Software / Creator / parameters), never as a flat
    # blob scan — hence the free-text negatives below.
    "png_gen_software": make_png([(b"tEXt", b"Software\x00ChatGPT")]),
    "png_gen_creator": make_png([(b"tEXt", b"Creator\x00DALL-E 3")]),
    "png_gen_parameters": make_png([(b"tEXt", b"parameters\x00Steps: 20, Sampler: DPM++ 2M, Model: SDXL base 1.0")]),
    "png_gen_parameters_plain": make_png([(b"tEXt", b"parameters\x00Steps: 20, Sampler: DPM++ 2M, Model: sd_xl_base_1.0")]),
    "png_gen_lowercase": make_png([(b"tEXt", b"software\x00chatgpt")]),
    "png_gen_free_text": make_png([(b"tEXt", b"Comment\x00Hiking near the Gemini constellation")]),
    "png_gen_wrong_key": make_png([(b"tEXt", b"Title\x00Midjourney fan art")]),
    "png_gen_ztxt": make_png([(b"zTXt", b"Software\x00\x00" + zlib.compress(b"ChatGPT"))]),
    "png_gen_itxt": make_png([(b"iTXt", b"Software\x00\x00\x00\x00\x00ChatGPT")]),
    "png_gen_itxt_compressed": make_png([(b"iTXt", b"Software\x00\x01\x00\x00\x00" + zlib.compress(b"Midjourney v6"))]),
    # Upstream #127: flat markers must also match text that only exists once the
    # chunk is decompressed.
    "png_ztxt_flat_hint": make_png([(b"zTXt", b"Comment\x00\x00" + zlib.compress(b"Generated by AI"))]),
    "png_itxt_flat_hint": make_png([(b"iTXt", b"Comment\x00\x01\x00\x00\x00" + zlib.compress(b"Generated by AI"))]),
    "png_itxt_utf8": make_png([(b"iTXt", "Description\x00\x00\x00\x00\x00畫を Midjourney で生成".encode("utf-8"))]),
    # Undecodable payloads must degrade silently, exactly as zlib.error does.
    "png_ztxt_corrupt": make_png([(b"zTXt", b"Software\x00\x00not-actually-zlib")]),
    "png_itxt_truncated": make_png([(b"iTXt", b"Software\x00\x00\x00")]),
    "jpeg_clean": make_jpeg([]),
    "jpeg_exif_xmp": make_jpeg([(0xE1, b"Exif\x00\x00MM\x00*"), (0xE1, b"http://ns.adobe.com/xap/1.0/\x00" + XMP_AI), (0xFE, b"a comment")]),
    "jpeg_c2pa": make_jpeg([(0xEB, b"JP\x00\x01" + JUMBF), (0xE2, b"ICC_PROFILE\x00" + bytes(20)), (0xEE, b"Adobe" + bytes(7))]),
    # Upstream #216: COM is unkeyed free text. Keep mode preserves a benign
    # comment, and the flat AI_META_HINTS entries that read as ordinary prose
    # ("Generated by", bare vendor names) are deliberately not COM hints.
    "jpeg_com_benign": make_jpeg([(0xFE, b"Family vacation, Shanghai, 2026-08-21")]),
    "jpeg_com_generated_by": make_jpeg([(0xFE, b"Generated by ImageMagick 7.1")]),
    "jpeg_com_vendor_name": make_jpeg([(0xFE, b"Claude Monet retrospective")]),
    "jpeg_com_ai": make_jpeg([(0xFE, b"Generated by AI with OpenAI")]),
    "jpeg_com_c2pa": make_jpeg([(0xFE, b"contentcredentials c2pa manifest note")]),
    # The same change narrowed the whole-file byte scan for JPEG. "jumb" and the
    # XMP InstanceID namespace occur in ordinary files, so neither promotes a
    # JPEG to C2PA any more unless it sits in a segment we parsed.
    "jpeg_com_jumbo": make_jpeg([(0xFE, b"JUMBO family photo")]),
    "jpeg_xmp_instanceid": make_jpeg([
        (0xE1, b"http://ns.adobe.com/xap/1.0/\x00"
               b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:xmpMM='
               b'"http://ns.adobe.com/xmp/InstanceID/"/></rdf:RDF></x:xmpmeta>'),
    ]),
    "webp_clean": make_webp([], 0x10),
    "webp_meta": make_webp([(b"ICCP", bytes(9)), (b"EXIF", b"MM\x00*" + b"OpenAI"), (b"XMP ", XMP_AI)], 0x10 | 0x20 | 0x08 | 0x04),
    "webp_c2pa": make_webp([(b"C2PA", JUMBF)], 0x10),
    "avif_clean": make_isobmff(b"avif", [(b"meta", iso_meta([(b"hdlr", b"\x00" * 12 + b"pict")]))]),
    "avif_xmp_c2pa": make_isobmff(b"avif", [
        (b"uuid", XMP_UUID + XMP_AI),
        (b"jumb", JUMBF),
        (b"meta", iso_meta([(b"hdlr", b"\x00" * 12 + b"pict"), (b"iinf", b"\x00\x00\x00\x01 Generated by OpenAI")])),
    ]),
    "avif_uuid_plain": make_isobmff(b"avif", [(b"uuid", b"\x11" * 16 + b"harmless camera note")]),
    "heic_meta": make_isobmff(b"heic", [
        (b"meta", iso_meta([
            (b"hdlr", b"\x00" * 12 + b"pict"),
            (b"uuid", XMP_UUID + XMP_AI),
            (b"xml ", b"<note>contentcredentials</note>"),
        ])),
    ]),
    "heic_c2pa_box": make_isobmff(b"heix", [(b"c2pa", JUMBF), (b"meta", iso_meta([(b"hdlr", b"\x00" * 12 + b"pict")]))]),
    # Upstream #182: an interrupted download leaves a box (or a PNG chunk)
    # whose declared length overruns the file. The tail has to survive.
    "avif_truncated_tail": truncate_isobmff(
        make_isobmff(b"avif", [(b"uuid", XMP_UUID + XMP_AI), (b"meta", iso_meta([(b"hdlr", b"\x00" * 12 + b"pict")]))]), 4),
    "avif_truncated_junk": make_isobmff(b"avif", [(b"c2pa", JUMBF)]) + b"\x00\x01\x02",
    # Upstream #264. The merkle and no-marker payloads are the cases the old
    # substring scan missed entirely in keep mode; bad_offset is the one it
    # wrongly matched, and it must survive a keep-mode clean.
    "avif_c2pa_prov_uuid": make_isobmff(b"avif", [
        (b"uuid", C2PA_BMFF_UUID + b"manifest\x00" + b"c2pa" + b"\x00" * 8 + b"jumb"),
    ]),
    "avif_c2pa_prov_no_marker": make_isobmff(b"avif", [
        (b"uuid", C2PA_BMFF_UUID + b"manifest\x00" + bytes(range(1, 64))),
    ]),
    "avif_c2pa_prov_merkle": make_isobmff(b"avif", [
        (b"uuid", C2PA_BMFF_UUID + b"merkle\x00" + bytes(range(1, 128))),
    ]),
    "avif_c2pa_prov_offset4": make_isobmff(b"avif", [
        (b"uuid", b"\x00\x00\x00\x00" + C2PA_BMFF_UUID + b"manifest\x00" + b"data"),
    ]),
    "avif_uuid_c2pa_bytes_bad_offset": make_isobmff(b"avif", [
        (b"uuid", b"\x00" + C2PA_BMFF_UUID + b"not-a-manifest"),
    ]),
    "avif_meta_c2pa_prov_uuid": make_isobmff(b"avif", [
        (b"meta", iso_meta([
            (b"hdlr", b"\x00" * 12 + b"pict"),
            (b"uuid", C2PA_BMFF_UUID + b"manifest\x00" + bytes(range(1, 48))),
        ])),
    ]),
    # The box walk stops at the overrunning mdat, so the manifest sits in the
    # unparsed tail and only the whole-file fallback can see it: the C2PA user
    # type follows a `uuid` fourcc, but no ASCII marker does.
    "avif_prov_uuid_in_tail": (
        iso_box(b"ftyp", b"avif\x00\x00\x00\x00avifmif1")
        + b"\x00\x00\xff\xff"
        + b"mdat"
        + b"uuid"
        + C2PA_BMFF_UUID
        + bytes(range(1, 32))
    ),
    "png_truncated_tail": make_truncated_png([(b"tEXt", b"Software\x00ChatGPT")], b"\x01\x02\x03\x04\x05\x06"),
    "bmp_clean": make_bmp(),
    "bmp_trailing_ai": make_bmp(b"digitalSourceType=trainedAlgorithmicMedia"),
    "bmp_trailing_plain": make_bmp(b"harmless scanner note"),
    "gif_clean": make_gif(),
    "gif_comment_ai": make_gif((0xFE, b"Generated by OpenAI")),
    "gif_comment_plain": make_gif((0xFE, b"just a caption")),
    "gif_xmp": make_gif((0xFF, GIF_XMP_PAYLOAD)),
    "gif_netscape_loop": make_gif((0xFF, b"NETSCAPE2.0" + b"\x03\x01\x00\x00")),
    "gif_unknown_app": make_gif((0xFF, b"WHATEVER1.0" + b"payload")),
    "tiff_le": make_tiff(),
    "tiff_be": make_tiff(big_endian=True),
    "tiff_le_clean": make_tiff(with_meta=False),
    "bigtiff_le": make_tiff(big=True),
    "bigtiff_be": make_tiff(big=True, big_endian=True),
}


def _js(mode: str, data: bytes, options: dict) -> dict:
    req = {"mode": mode, "file": base64.b64encode(data).decode(), "options": options}
    proc = subprocess.run([NODE, str(ROOT / "tests" / "image_meta_cli.js")], input=json.dumps(req),
                          capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def _py_clean(data: bytes, fmt: str, strip_all: bool) -> tuple[bytes, list[str]]:
    if fmt == "png":
        return image_meta.strip_png(data, strip_all_text=strip_all)
    if fmt == "jpeg":
        return image_meta.strip_jpeg(data, strip_all_app=strip_all)
    if fmt == "webp":
        return image_meta.strip_webp(data, strip_all_metadata=strip_all)
    if fmt == "bmp":
        return image_meta.strip_bmp(data, strip_all_metadata=strip_all)
    if fmt == "gif":
        return image_meta.strip_gif(data, strip_all_metadata=strip_all)
    if fmt == "tiff":
        return image_meta.strip_tiff(data, strip_all_metadata=strip_all)
    return image_meta.strip_isobmff(data, fmt, strip_all_metadata=strip_all)


def _py_inspect(data: bytes, fmt: str) -> tuple[bool, bool, list[str]]:
    if fmt == "png":
        return image_meta.inspect_png(data)
    if fmt == "jpeg":
        return image_meta.inspect_jpeg(data)
    if fmt == "webp":
        return image_meta.inspect_webp(data)
    if fmt == "bmp":
        return image_meta.inspect_bmp(data)
    if fmt == "gif":
        return image_meta.inspect_gif(data)
    if fmt == "tiff":
        return image_meta.inspect_tiff(data)
    return image_meta.inspect_isobmff(data, fmt)


@pytest.mark.parametrize("name", sorted(SAMPLES))
@pytest.mark.parametrize("strip_all", [True, False])
def test_clean_parity(name: str, strip_all: bool) -> None:
    data = SAMPLES[name]
    fmt = image_meta.detect_format(data)
    py_bytes, py_actions = _py_clean(data, fmt, strip_all)
    js = _js("clean", data, {"stripAllMetadata": strip_all})
    assert "error" not in js, js
    assert js["format"] == fmt
    assert base64.b64decode(js["data"]) == py_bytes, name
    assert js["actions"] == py_actions, name


@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_inspect_parity(name: str) -> None:
    data = SAMPLES[name]
    fmt = image_meta.detect_format(data)
    has_c2pa, has_ai, findings = _py_inspect(data, fmt)
    js = _js("inspect", data, {})
    assert js["format"] == fmt
    assert (js["has_c2pa"], js["has_ai_metadata"], js["findings"]) == (has_c2pa, has_ai, findings), name


def test_idempotent_and_valid_structure() -> None:
    for name, data in SAMPLES.items():
        js1 = _js("clean", data, {})
        once = base64.b64decode(js1["data"])
        js2 = _js("clean", once, {})
        assert base64.b64decode(js2["data"]) == once, name
        fmt = image_meta.detect_format(once)
        assert fmt == image_meta.detect_format(data)
        if fmt == "webp":
            assert struct.unpack("<I", once[4:8])[0] + 8 == len(once)


def test_isobmff_unparsable_still_byte_scans() -> None:
    """Upstream #176: when no box parses, the whole-file C2PA scan still runs.

    strip_isobmff refuses this input on both sides, so it cannot live in SAMPLES
    (which every clean-parity case must survive); inspect is the interesting half.
    """
    head = iso_box(b"ftyp", b"avif\x00\x00\x00\x00avifmif1")
    # Overstate the very first box's size so the walk stops before box one.
    broken = struct.pack(">I", 1 << 20) + head[4:] + JUMBF
    assert image_meta.detect_format(broken) == "avif"
    py = image_meta.inspect_isobmff(broken, "avif")
    js = _js("inspect", broken, {})
    assert (js["has_c2pa"], js["has_ai_metadata"], js["findings"]) == py
    assert py[0] is True and any("byte-scan" in f for f in py[2])


def test_isobmff_free_box_preserves_offsets() -> None:
    """Upstream #183: a dropped box becomes an equal-size `free` box.

    That is what keeps every absolute offset later in the file valid, so the
    cleaned image is the same length and mdat has not moved.
    """
    for name in (
        "avif_xmp_c2pa",
        "heic_c2pa_box",
        "heic_meta",
        "avif_uuid_plain",
        "avif_c2pa_prov_uuid",
        "avif_c2pa_prov_merkle",
        "avif_meta_c2pa_prov_uuid",
    ):
        src = SAMPLES[name]
        out = base64.b64decode(_js("clean", src, {})["data"])
        assert len(out) == len(src), name
        assert out.index(b"mdat") == src.index(b"mdat"), name
        assert b"free" in out, name
        for secret in (XMP_AI, JUMBF, b"harmless camera note"):
            if secret in src:
                assert secret not in out, (name, secret)


def test_c2pa_prov_box_survives_only_where_upstream_keeps_it() -> None:
    """Upstream #264: the user type drives detection and removal, not a substring.

    A manifest whose payload carries no ASCII `c2pa`/`jumb` is stripped even in
    keep mode, while a uuid box that merely happens to hold the same 16 bytes at
    an offset the spec does not use is left alone.
    """
    for name in ("avif_c2pa_prov_uuid", "avif_c2pa_prov_no_marker", "avif_c2pa_prov_merkle",
                 "avif_c2pa_prov_offset4", "avif_meta_c2pa_prov_uuid"):
        src = SAMPLES[name]
        assert _js("inspect", src, {})["has_c2pa"] is True, name
        for strip_all in (True, False):
            out = base64.b64decode(_js("clean", src, {"stripAllMetadata": strip_all})["data"])
            assert C2PA_BMFF_UUID not in out, (name, strip_all)

    src = SAMPLES["avif_uuid_c2pa_bytes_bad_offset"]
    assert _js("inspect", src, {})["has_c2pa"] is False
    kept = base64.b64decode(_js("clean", src, {"stripAllMetadata": False})["data"])
    assert C2PA_BMFF_UUID in kept


def test_bmp_and_tiff_structural_invariants() -> None:
    """Properties byte-parity cannot express: the cleaned file must still be
    coherent, not merely identical to what upstream produced.
    """
    # BMP: the file-size field at offset 2 has to match the truncated length.
    for name in ("bmp_trailing_ai", "bmp_trailing_plain"):
        out = base64.b64decode(_js("clean", SAMPLES[name], {})["data"])
        assert struct.unpack("<I", out[2:6])[0] == len(out), name

    # TIFF is patched in place, so every offset in the file stays where it was:
    # the pixel strip must survive byte-identical at its original offset while
    # the metadata payloads around it are zeroed.
    strip_data = b"\xaa\xbb\xcc\xdd\xee\xff\x00\x11"
    for name in ("tiff_le", "tiff_be", "bigtiff_le", "bigtiff_be"):
        src = SAMPLES[name]
        out = base64.b64decode(_js("clean", src, {})["data"])
        assert len(out) == len(src), name
        off = src.index(strip_data)
        assert out[off:off + len(strip_data)] == strip_data, name
        for secret in (XMP_AI, b"Acme Corp", b"AIGC maker"):
            assert secret not in out, (name, secret)

    # GIF: a NETSCAPE2.0 loop extension is rendering control, not provenance.
    kept = base64.b64decode(_js("clean", SAMPLES["gif_netscape_loop"], {})["data"])
    assert b"NETSCAPE2.0" in kept
