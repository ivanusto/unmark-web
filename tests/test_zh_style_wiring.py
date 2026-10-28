"""zh_style.js must be loaded wherever the other engine modules are."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_engine_script_list_includes_zh_style() -> None:
    src = (ROOT / "js" / "engine.js").read_text(encoding="utf-8")
    block = src[src.index("ENGINE_SCRIPTS = ["):]
    block = block[:block.index("];")]
    assert '"zh_style.js"' in block
    assert block.index('"zh_style.js"') < block.index('"engine_ops.js"')


def test_worker_imports_zh_style() -> None:
    src = (ROOT / "js" / "worker.js").read_text(encoding="utf-8")
    block = src[src.index("importScripts("):]
    block = block[:block.index(");")]
    assert '"zh_style.js"' in block
    assert block.index('"zh_style.js"') < block.index('"engine_ops.js"')


def test_engine_ops_exposes_zh_style_op() -> None:
    assert "zhStyleScore" in (ROOT / "js" / "engine_ops.js").read_text(encoding="utf-8")
