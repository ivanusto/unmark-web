"""The three dictionaries and index.html must agree on the same key set.

A missing translation is invisible at runtime: t() falls back, so the page just
quietly shows English (or the key itself) in one locale. These checks are the
only thing that notices.
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


def _data() -> dict:
    proc = subprocess.run([NODE, str(ROOT / "tests" / "i18n_keys_cli.js")],
                          capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def test_every_locale_has_every_key() -> None:
    dicts = _data()["dict"]
    assert set(dicts) >= {"en", "zh-Hant", "zh-Hans"}
    en = set(dicts["en"])
    assert en, "the English dictionary is empty; the shim failed to load it"
    for lang, keys in dicts.items():
        if lang == "en":
            continue
        assert set(keys) == en, (lang, sorted(en - set(keys)), sorted(set(keys) - en))


def test_markup_only_references_known_keys() -> None:
    data = _data()
    en = set(data["dict"]["en"])
    unknown = sorted(k for k in data["used"] if k not in en)
    assert not unknown, unknown
