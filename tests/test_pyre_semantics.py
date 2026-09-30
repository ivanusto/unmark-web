"""js/pyre.js against CPython's `re`, directly rather than through a port.

js/stylometry.js and js/container_meta.js both build their patterns with
compilePy, so every one of their parity tests depends on this translation being
right. None of them would notice a rule that no shipping pattern happens to
use: the literal `i` was widened to also match `ı` and `İ` whether or not the
pattern asked for IGNORECASE, and the only reason that was not a live defect is
that no case-sensitive pattern in this repository contains an `i`.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="needs node")

# (pattern, ignore_case, subject)
CASES = [
    # The i/ı/İ equivalence, which holds under IGNORECASE and only there.
    ("i", False, "i"), ("i", False, "I"), ("i", False, "İ"), ("i", False, "ı"),
    ("i", True, "i"), ("i", True, "I"), ("i", True, "İ"), ("i", True, "ı"),
    ("I", False, "i"), ("I", False, "I"), ("I", False, "İ"), ("I", False, "ı"),
    ("I", True, "i"), ("I", True, "I"), ("I", True, "İ"), ("I", True, "ı"),
    ("[il]", False, "ı"), ("[il]", True, "ı"), ("[il]", False, "l"),
    ("digital", False, "a DIGITAL thing"), ("digital", True, "a DIGITAL thing"),
    ("digital", True, "a DİGİTAL thing"),
    # Python's \b is Unicode-aware; JS's own \b is not.
    ("\\baigc\\b", True, "aigc"), ("\\baigc\\b", True, "xaigc"), ("\\baigc\\b", True, "中aigc"),
    ("\\baigc\\b", True, "aigcx"), ("\\baigc\\b", True, " aigc "),
    ("\\bc2pa\\b", True, "a c2pa manifest"), ("\\bc2pa\\b", True, "xc2pa"),
    # Python's \s and \w sets.
    ("a\\s+b", False, "a b"), ("a\\s+b", False, "a b"), ("a\\s+b", False, "a﻿b"),
    ("a\\s+b", False, "a\x1cb"), ("a\\s+b", False, "a \t b"),
    ("\\w+", False, "中文"), ("\\w+", False, "__x"), ("\\w+", False, "!!"),
    ("[\\w-]+", False, "a-b_c"),
    # Python's `.` without DOTALL refuses only "\n"; JS's also refuses "\r",
    # U+2028 and U+2029. Upstream #366 and #373 are the first patterns here to
    # lean on it: `dall.?e`, `content.?credential`, and a tempered dot that
    # reads an attribute value up to its closing quote.
    ("a.b", False, "a\rb"), ("a.b", False, "a\u2028b"), ("a.b", False, "a\u2029b"),
    ("a.b", False, "a\nb"), ("a.b", False, "a\x85b"), ("a[.]b", False, "axb"), ("a\\.b", False, "axb"),
    ("content.?credential", True, "Content\rCredential"),
    ("(\"|')((?:(?!\\1).)*)\\1", False, '"Bob\'s\rline"'),
    ("(\"|')((?:(?!\\1).)*)\\1", False, '"Bob\'s\nline"'),
    # Python's `\d` in a str pattern is any Unicode decimal digit.
    ("\\bgpt-?\\d", True, "gpt-\u0664"), ("\\bgpt-?\\d", True, "GPT\uff15"),
    ("\\bgpt-?\\d", True, "gpt-\u00b2"), ("[\\d]+", False, "\u0967\u0968"),
    # The marker alternation this port actually ships.
    ("\\b(?:generated|created|made|written|produced|authored)\\s+(?:with|by|using)\\b", True,
     "Generated with Claude Code"),
    ("\\b(?:generated|created|made|written|produced|authored)\\s+(?:with|by|using)\\b", True,
     "regenerated with care"),
    ("\\b(?:generated|created|made|written|produced|authored)\\s+(?:with|by|using)\\b", True,
     "written  by hand"),
]


def _js(cases: list[tuple[str, bool, str]]) -> list[int | None]:
    proc = subprocess.run([NODE, str(ROOT / "tests" / "pyre_cli.js")],
                          input=json.dumps({"cases": cases}), capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)["found"]


@pytest.mark.parametrize("pattern,ignore_case,subject", CASES)
def test_compile_py_matches_cpython(pattern: str, ignore_case: bool, subject: str) -> None:
    m = re.compile(pattern, re.IGNORECASE if ignore_case else 0).search(subject)
    expected = m.start() if m else None
    assert _js([(pattern, ignore_case, subject)])[0] == expected
