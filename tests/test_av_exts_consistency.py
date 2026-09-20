"""js/app.js owns a copy of the audio/video extension list. It must not drift.

The page routes a dropped file by extension before any engine is loaded, so it
cannot read AvMeta.AV_EXTS to do it. Two lists that must agree and nothing
checking that they do is how a newly supported format ends up read whole into
the tab instead of going through the slice driver, with no error anywhere.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="needs node")


def test_page_av_extensions_match_the_engine() -> None:
    proc = subprocess.run([NODE, str(ROOT / "tests" / "av_exts_cli.js")],
                          capture_output=True, text=True, check=True)
    got = json.loads(proc.stdout)
    assert got["page"] is not None, "could not find AV_EXT in js/app.js"
    assert sorted(got["page"]) == sorted(got["engine"])
