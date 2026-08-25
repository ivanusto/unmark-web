"""Cross-engine parity: js/layer_a.js must match upstream text_unicode.py.

Requires `node` and an upstream checkout (WATERMARKS_UPSTREAM_DIR, default
../watermarks-remover). Skips cleanly when either is missing.
"""
from __future__ import annotations

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
    NODE is None or not (SCRIPTS / "text_unicode.py").is_file(),
    reason="needs node and an upstream checkout (WATERMARKS_UPSTREAM_DIR)",
)

if (SCRIPTS / "text_unicode.py").is_file():
    sys.path.insert(0, str(SCRIPTS))
    import text_unicode  # type: ignore  # noqa: E402

CASES = [
    "plain ascii",
    "zero​width​space and­soft­hyphen ﻿ bom",
    "bidi ‮evil‬ and ⁦iso⁩ and ‎‏ marks",
    "emoji glue: ❤️ ⚠️ \U0001F468‍\U0001F469‍\U0001F467 ❤️‍\U0001F525 keycap 1️⃣",
    "flag: \U0001F3F4\U000E0067\U000E0062\U000E0073\U000E0063\U000E0074\U000E007F end",
    "persian می‌روم devanagari क्‍ष isolated‌ joiner",
    "mongolian ᠠ᠋ letter, isolated ᠋; khmer ក឴ ok, stray ឴; hangul ᄀᅠ ok, stray ᅠ",
    "arabic cf ؀١ ۝٢ syriac ܏ kaithi \U000110bd",
    "spaces: nbsp thin　ideo narrow figure",
    "confusables: АВС аео ＡＢＣ ａｂｃ",
    "vs: a︀b️c \U000E0100d \U000E01EF; tags \U000E0001\U000E0041; pua \U000F0000\U00100000",
    "other cf: \U0001BCA0 shorthand, \U00013430 egyptian,   not cf",
    "nfkc: ＡＢ 　 ① ﬁ",
    "mixed ​😀️‍💩​ end \U0001F3F4\U000E0067 stray\U000E0067",
    # upstream #133: late-assigned carriers, noncharacters, reserved ignorables
    # and visible-layout Cf controls. Each layout case pairs the control next to
    # its own script (kept) with the same control adrift in Latin text (stripped),
    # so one case exercises both branches.
    "mongolian fvs4 \u1820\u180f ok, stray \u180f",
    "hangul filler \u3131\u3164 ok, stray \u3164; halfwidth \uffa1\uffa0 ok, stray \uffa0",
    "noncharacters \ufdd0 \ufffe \U0001FFFF end",
    "reserved ignorable \u2065 \ufff0 \U000E0000 \U000E0080 \U000E01F0 end",
    "egyptian \U00013000\U00013430\U00013001 vs floating \U00013430 here",
    "duployan \U0001BC00\U0001BCA0\U0001BC01 vs floating \U0001BCA0 here",
    "musical \U0001D100\U0001D173\U0001D101 vs floating \U0001D173 here",
    # upstream #200: Emoji=Yes singletons outside the block ranges. A VS16
    # after one of them is presentation, not a carrier, so it is kept; the
    # same selector adrift after a plain letter is still stripped.
    "singletons \u203c\ufe0f \u2049\ufe0f \u2139\ufe0f \u2934\ufe0f \u2935\ufe0f, "
    "zwj \u2139\ufe0f\u200d\U0001F4A1, stray a\ufe0f here",
]

OPTION_SETS = [
    {},
    {"nfkc": True},
    {"aggressive_homoglyphs": True},
    {"normalize_spaces": False},
    {"strip_emoji_glue": True},
    {"nfkc": True, "aggressive_homoglyphs": True, "strip_emoji_glue": True},
]

JS_KEYS = {"nfkc": "nfkc", "aggressive_homoglyphs": "aggressiveHomoglyphs",
           "normalize_spaces": "normalizeSpaces", "strip_emoji_glue": "stripEmojiGlue"}


def _js(mode: str, text: str, options: dict) -> dict:
    req = {"mode": mode, "text": text, "options": {JS_KEYS.get(k, k): v for k, v in options.items()}}
    proc = subprocess.run([NODE, str(ROOT / "tests" / "layer_a_cli.js")], input=json.dumps(req),
                          capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


@pytest.mark.parametrize("text", CASES)
@pytest.mark.parametrize("options", OPTION_SETS, ids=lambda o: "+".join(o) or "default")
def test_clean_parity(text: str, options: dict) -> None:
    py_cleaned, py_stats = text_unicode.clean_text(text, **options)
    js = _js("clean", text, options)
    assert js["cleaned"] == py_cleaned, (text, options)
    assert js["stats"]["removed_count"] == py_stats["removed_count"]
    assert js["stats"]["replaced_count"] == py_stats["replaced_count"]
    assert js["stats"]["input_length"] == py_stats["input_length"]
    assert js["stats"]["output_length"] == py_stats["output_length"]
    # NFKC bookkeeping
    assert js["stats"]["replaced"].get("NFKC_normalize") == py_stats["replaced"].get("NFKC_normalize")


@pytest.mark.parametrize("text", CASES)
@pytest.mark.parametrize("aggressive", [False, True])
@pytest.mark.parametrize("glue", [False, True])
def test_inspect_parity(text: str, aggressive: bool, glue: bool) -> None:
    py = text_unicode.inspect_text(text, aggressive=aggressive, strip_emoji_glue=glue).to_dict()
    js = _js("inspect", text, {"aggressive": aggressive, "stripEmojiGlue": glue})
    assert js["length"] == py["length"]
    assert js["suspicious_total"] == py["suspicious_total"]
    strip = lambda hits: [(h["codepoint"], h["count"], h["kind"], h["confidence"], h["sample_offsets"]) for h in hits]
    assert strip(js["hits"]) == strip(py["hits"])
