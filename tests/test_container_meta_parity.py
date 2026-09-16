"""Cross-engine parity for js/container_meta.js against upstream container_meta.py.

Covers the text-markup half of that module: the shared AI vocabulary, the
embedded data-URI scanner, and SVG inspect/clean. The ZIP and PDF halves are
not ported and are not exercised here.

Two things below are not ports of upstream code but reimplementations of
CPython behaviour the port stands on, so they are tested directly rather than
only through the functions that use them: `bytes.decode("utf-8", errors=...)`
in both modes upstream uses, and `base64.b64decode` / `quote_from_bytes` /
`unquote_to_bytes`. Getting any of them approximately right changes the bytes
that come out of clean_svg.

Requires `node` and an upstream checkout (WATERMARKS_UPSTREAM_DIR, default
../watermarks-remover). Skips cleanly when either is missing.
"""
from __future__ import annotations

import base64
import binascii
import json
import os
import random
import shutil
import subprocess
import sys
import urllib.parse
import zlib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = Path(os.environ.get("WATERMARKS_UPSTREAM_DIR", ROOT.parent / "watermarks-remover"))
SCRIPTS = UPSTREAM / "service" / "scripts"
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(
    NODE is None or not (SCRIPTS / "container_meta.py").is_file(),
    reason="needs node and an upstream checkout (WATERMARKS_UPSTREAM_DIR)",
)

if (SCRIPTS / "container_meta.py").is_file():
    sys.path.insert(0, str(SCRIPTS))
    import container_meta  # type: ignore  # noqa: E402


def _js(req: dict) -> dict:
    proc = subprocess.run([NODE, str(ROOT / "tests" / "container_meta_cli.js")],
                          input=json.dumps(req), capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


# --------------------------------------------------------------------------
# fixtures
# --------------------------------------------------------------------------

def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (len(payload).to_bytes(4, "big") + kind + payload
            + (zlib.crc32(kind + payload) & 0xFFFFFFFF).to_bytes(4, "big"))


def png(text_chunks: bytes = b"") -> bytes:
    ihdr = (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + bytes([8, 2, 0, 0, 0])
    return (b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr) + text_chunks
            + png_chunk(b"IDAT", b"\x00" * 8) + png_chunk(b"IEND", b""))


PNG_AI = png(png_chunk(b"tEXt", b"Software\x00Midjourney"))
PNG_CLEAN = png()
JPEG_AI = (b"\xff\xd8\xff\xe1" + (20).to_bytes(2, "big") + b"Exif\x00\x00"
           + b"trainedAlgorithmicMedia"[:12] + b"\xff\xd9")

SVGS = {
    # The thirteen shapes upstream's own SVG hardening suite pins down.
    "doctype_entities": b"""<?xml version="1.0"?>
<!DOCTYPE svg [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;">
]>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <circle cx="50" cy="50" r="40" />
</svg>""",
    "external_id_quoted_gt": b"""<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" />
""",
    "multiline_external_id": b"""<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG
1.1//EN" "http://www.w3.org/2000/svg">
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" />
""",
    "gt_close_in_dtd_comment": b"""<?xml version="1.0"?>
<!DOCTYPE svg [ <!-- ]> --> <!ENTITY x "y"> ]>
<svg xmlns="http://www.w3.org/2000/svg" />
""",
    "nested_internal_subset": b"""<?xml version="1.0"?>
<!DOCTYPE svg [ <!ENTITY a "x>y"> <!ENTITY b "b>c"> ]>
<svg xmlns="http://www.w3.org/2000/svg"><text>&a;</text></svg>
""",
    "decl_like_in_cdata": b"""<svg xmlns="http://www.w3.org/2000/svg">
<![CDATA[<!ENTITY legit "keep me"> <!DOCTYPE fake>]]>
<circle cx="1" cy="2" r="3" />
</svg>""",
    "decl_like_in_comment": b"""<svg xmlns="http://www.w3.org/2000/svg">
<!-- <!ENTITY legit "keep me"> -->
<circle cx="1" cy="2" r="3" />
</svg>""",
    "decl_like_in_attribute": b"""<svg xmlns="http://www.w3.org/2000/svg" title="<!ENTITY legit &quot;keep me&quot;>">
<circle cx="1" cy="2" r="3" />
</svg>""",
    "unterminated_declaration": b"""<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>
<!ENTITY unterminated "no close""",
    "single_quoted_root_attrs": b"<svg xmlns='http://www.w3.org/2000/svg' generator='tool' inkscape:version='1.0' sodipodi:docname='x.svg' width='10'/>",
    "generator_like_text_content": b'<svg xmlns="http://www.w3.org/2000/svg"><text>run generator="tool" now</text></svg>',
    "attrs_alongside_declarations": b"""<?xml version="1.0"?>
<!DOCTYPE svg [
  <!ENTITY lol "lol">
]>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" generator="tool" inkscape:version="1.0" sodipodi:docname="x.svg" />""",
    "pi_containing_svg": b'<?xml-stylesheet type="text/css" href="<svg foo=1>"?>\n<svg xmlns="http://www.w3.org/2000/svg" generator="tool" width="10"/>',
    # Metadata blocks, XMP, AI comments, and the block shapes the linear
    # scanners exist for.
    "metadata_block": b'<svg xmlns="http://www.w3.org/2000/svg"><metadata><rdf:RDF>generator</rdf:RDF></metadata><circle r="1"/></svg>',
    "xmpmeta_block": b'<svg xmlns="http://www.w3.org/2000/svg"><x:xmpmeta xmlns:x="adobe:ns:meta/"><digitalSourceType>trainedAlgorithmicMedia</digitalSourceType></x:xmpmeta></svg>',
    "two_metadata_blocks": b'<svg><metadata>a</metadata><circle/><metadata>b</metadata></svg>',
    "unclosed_metadata": b'<svg><metadata><metadata><metadata><circle/></svg>',
    "metadata_close_before_open": b'<svg></metadata><metadata>x</metadata></svg>',
    "ai_comment": b'<svg xmlns="http://www.w3.org/2000/svg"><!-- generated by Claude --><circle r="1"/></svg>',
    "benign_comment": b'<svg xmlns="http://www.w3.org/2000/svg"><!-- drawn by hand --><circle r="1"/></svg>',
    "ai_comment_bang_close": b'<svg><!-- openai --!><circle r="1"/></svg>',
    "empty": b"",
    "not_xml_at_all": b"just some bytes, not markup",
    "c2pa_marker_bytes": b'<svg xmlns="http://www.w3.org/2000/svg"><desc>c2pa</desc></svg>',
    # Not valid UTF-8: surrogateescape has to carry these through clean_svg
    # untouched, and inspect has to decode them with "replace" instead.
    "invalid_utf8": b'<svg xmlns="http://www.w3.org/2000/svg"><text>\xff\xfe\x80 caf\xe9</text><metadata>x</metadata></svg>',
    "truncated_utf8_tail": b'<svg><text>\xe4\xb8</text></svg>',
    "embedded_png": b'<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,'
                    + base64.b64encode(PNG_AI) + b'"/></svg>',
    "embedded_png_clean": b'<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,'
                          + base64.b64encode(PNG_CLEAN) + b'"/></svg>',
}

URI_TEXTS = {
    "none": "<p>nothing here</p>",
    "png_b64": '<img src="data:image/png;base64,' + base64.b64encode(PNG_AI).decode() + '">',
    "png_b64_clean": '<img src="data:image/png;base64,' + base64.b64encode(PNG_CLEAN).decode() + '">',
    "png_b64_newlines": '<img src="data:image/png;base64,'
                        + "\n".join(base64.b64encode(PNG_AI).decode()[i:i + 40]
                                    for i in range(0, len(base64.b64encode(PNG_AI)), 40)) + '">',
    "png_b64_unpadded": '<img src="data:image/png;base64,'
                        + base64.b64encode(PNG_AI).decode().rstrip("=") + '">',
    "png_percent": '<img src="data:image/png,' + urllib.parse.quote_from_bytes(PNG_AI) + '">',
    "jpeg_b64": '<img src="data:image/jpeg;base64,' + base64.b64encode(JPEG_AI).decode() + '">',
    "many_params": '<img src="data:image/png;charset=utf-8;foo=bar;base64,'
                   + base64.b64encode(PNG_AI).decode() + '">',
    "nested_svg": '<img src="data:image/svg+xml;base64,'
                  + base64.b64encode(SVGS["metadata_block"]).decode() + '">',
    "corrupt_payload": '<img src="data:image/png;base64,!!!!not base64!!!!">',
    "empty_payload": '<img src="data:image/png;base64,">',
    "no_comma": '<img src="data:image/png;base64">',
    "mime_only": '<img src="data:image/">',
    "redos_flood": "data:image/+;" * 400,
    "break_char_flood": 'data:image/png;base64,"' * 200,
    "two_uris": ('<img src="data:image/png;base64,' + base64.b64encode(PNG_AI).decode() + '">'
                 '<img src="data:image/png;base64,' + base64.b64encode(PNG_CLEAN).decode() + '">'),
    "stray_percent_in_b64": '<img src="data:image/png;base64,'
                            + base64.b64encode(PNG_AI).decode()[:8] + "%"
                            + base64.b64encode(PNG_AI).decode()[8:] + '">',
}

BLOBS = {
    "empty": b"",
    "plain": b"an ordinary caption",
    "c2pa": b"...c2pa...",
    "mixed_case": b"C2PA and DigitalSourceType",
    "both": b"c2pa jumbf trainedAlgorithmicMedia",
    "repeated": b"c2pa " * 40,
}

NAMED_VALUES = [
    ("generator", "Claude"),
    ("generator", "WordPress 6.4"),
    ("Generator", "ChatGPT"),
    ("creator", "Midjourney"),
    ("producer", "a person"),
    ("description", "Claude Monet painted this"),
    ("description", "contains c2pa manifest"),
    ("summary", "a static site generator"),
    ("title", "trained algorithmic media"),
    ("software", "Stable Diffusion"),
    ("tool", "aigc"),
    ("notes", "aigc"),
    ("notes", "this is not aigcx"),
    ("author", "synthid"),
]

B64_CASES = [
    "QUJD", "QUJ", "QU", "Q", "QUJDRA==", "QUJDRA=", "QUJDRA", "QU%JD", "QUJD====",
    "=QUJD", "QUJD=RA==", "QQ==QQ==", "QQ==", "QQ=A", "QQ=%=", "QUJDR=", "QUJDR==",
    "QUJDR=A", "QQ", "QQ=", "QUJDRA===", "A===", "QQ==A", "QQ==AA==", "", "====",
    "SGVsbG8sIHdvcmxkIQ==",
]


def _rand_bytes(n: int, seed: int) -> bytes:
    rng = random.Random(seed)
    return bytes(rng.randrange(0, 256) for _ in range(n))


# --------------------------------------------------------------------------
# the CPython behaviours the port reimplements
# --------------------------------------------------------------------------

DECODE_BLOBS = {
    "ascii": b"plain ascii",
    "utf8": "café 中文 \U0001f600".encode(),
    "lone_high": b"\xff\xfe",
    "truncated_2": b"\xe4\xb8",
    "truncated_3": b"\xf0\x9f\x98",
    "overlong": b"\xc0\xaf",
    "surrogate_encoded": b"\xed\xa0\x80",
    "above_max": b"\xf5\x80\x80\x80",
    "continuation_alone": b"\x80\x81\x82",
    "mixed": b"ok \xff then \xe4\xb8\xad more \xc3",
    "e0_bad_second": b"\xe0\x80\x80",
    "f4_bad_second": b"\xf4\x90\x80\x80",
    **{f"random{i}": _rand_bytes(64, i) for i in range(12)},
}


@pytest.mark.parametrize("errors", ["surrogateescape", "replace"])
@pytest.mark.parametrize("name", sorted(DECODE_BLOBS))
def test_decode_utf8_matches_cpython(name: str, errors: str) -> None:
    data = DECODE_BLOBS[name]
    expected = data.decode("utf-8", errors=errors)
    assert _js({"mode": "decode", "file": base64.b64encode(data).decode(), "errors": errors})["text"] == expected


@pytest.mark.parametrize("name", sorted(DECODE_BLOBS))
def test_encode_utf8_round_trips_every_byte(name: str) -> None:
    data = DECODE_BLOBS[name]
    text = data.decode("utf-8", errors="surrogateescape")
    got = base64.b64decode(_js({"mode": "encode", "text": text})["file"])
    assert got == text.encode("utf-8", errors="surrogateescape") == data


@pytest.mark.parametrize("case", B64_CASES)
def test_b64decode_matches_cpython(case: str) -> None:
    try:
        expected = base64.b64decode(case)
    except binascii.Error:
        expected = None
    got = _js({"mode": "b64decode", "s": case})
    if expected is None:
        assert "error" in got, (case, got)
    else:
        assert "error" not in got, (case, got)
        assert base64.b64decode(got["data"]) == expected


@pytest.mark.parametrize("name", sorted(DECODE_BLOBS))
def test_quote_from_bytes_matches_cpython(name: str) -> None:
    data = DECODE_BLOBS[name]
    assert _js({"mode": "quote", "file": base64.b64encode(data).decode()})["text"] \
        == urllib.parse.quote_from_bytes(data)


@pytest.mark.parametrize("text", ["", "abc", "a%41b", "%ff%FE", "%zz", "100%", "a+b%2Fc", "%e4%b8%ad"])
def test_unquote_to_bytes_matches_cpython(text: str) -> None:
    got = base64.b64decode(_js({"mode": "unquote", "text": text})["file"])
    assert got == urllib.parse.unquote_to_bytes(text)


# --------------------------------------------------------------------------
# the ported functions
# --------------------------------------------------------------------------

@pytest.mark.parametrize("name", sorted(BLOBS))
def test_blob_hits_parity(name: str) -> None:
    data = BLOBS[name]
    has_c2pa, has_ai, findings = container_meta._blob_hits(data)
    got = _js({"mode": "blob_hits", "file": base64.b64encode(data).decode()})
    assert got == {"has_c2pa": has_c2pa, "has_ai": has_ai, "findings": findings}


@pytest.mark.parametrize("name,value", NAMED_VALUES)
def test_named_value_is_ai_parity(name: str, value: str) -> None:
    expected = container_meta.named_value_is_ai(name, value)
    assert _js({"mode": "named_value", "name": name, "value": value})["is_ai"] == expected


@pytest.mark.parametrize("name", sorted(URI_TEXTS))
def test_inspect_embedded_data_uris_parity(name: str) -> None:
    text = URI_TEXTS[name]
    has_c2pa, has_ai, findings = container_meta._inspect_embedded_data_uris(text)
    got = _js({"mode": "uri_inspect", "text": text})
    assert got == {"has_c2pa": has_c2pa, "has_ai": has_ai, "findings": findings}


@pytest.mark.parametrize("strip_all", [True, False])
@pytest.mark.parametrize("name", sorted(URI_TEXTS))
def test_clean_embedded_data_uris_parity(name: str, strip_all: bool) -> None:
    text = URI_TEXTS[name]
    expected_text, expected_actions = container_meta._clean_embedded_data_uris(
        text, strip_all_metadata=strip_all)
    got = _js({"mode": "uri_clean", "text": text, "options": {"stripAllMetadata": strip_all}})
    assert got["text"] == expected_text
    assert got["actions"] == expected_actions


@pytest.mark.parametrize("name", sorted(SVGS))
def test_inspect_svg_parity(name: str) -> None:
    data = SVGS[name]
    has_c2pa, has_ai, findings, _details = container_meta.inspect_svg(data)
    got = _js({"mode": "svg_inspect", "file": base64.b64encode(data).decode()})
    assert got == {"has_c2pa": has_c2pa, "has_ai": has_ai, "findings": findings}


@pytest.mark.parametrize("name", sorted(SVGS))
def test_clean_svg_parity(name: str) -> None:
    data = SVGS[name]
    expected_bytes, expected_actions = container_meta.clean_svg(data)
    got = _js({"mode": "svg_clean", "file": base64.b64encode(data).decode()})
    assert base64.b64decode(got["data"]) == expected_bytes
    assert got["actions"] == expected_actions


def test_clean_svg_preserves_bytes_that_are_not_utf8() -> None:
    """The reason clean_svg decodes with surrogateescape rather than replace.

    Without it every invalid byte comes back as U+FFFD and the file is
    rewritten rather than cleaned.
    """
    data = SVGS["invalid_utf8"]
    got = base64.b64decode(_js({"mode": "svg_clean", "file": base64.b64encode(data).decode()})["data"])
    assert b"\xff\xfe\x80" in got
    assert b"caf\xe9" in got
