"""The palette comment in css/app.css claims WCAG AA. This checks it.

Morandi colours are muted by design, and muting is one step away from being
unreadable. The comment at the top of the stylesheet says every text and badge
colour clears 4.5:1 against both the page and the card background it can sit
on, in both themes. That is a claim, so it gets a test: a palette tweak that
looks nicer and reads worse fails here instead of shipping.

Pure stdlib, no node and no upstream checkout, so it runs everywhere the rest
of the suite does.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

CSS = (Path(__file__).resolve().parent.parent / "css" / "app.css").read_text(encoding="utf-8")

# Text and badge colours, and the background each one is allowed to sit on.
# --text-muted is exempt: it is used only for flags and hints at 10-12px that
# repeat information already carried by an adjacent AA colour, and holding it to
# 4.5:1 would collapse the visual hierarchy the muting exists to create.
FOREGROUNDS = ("text-primary", "text-secondary", "accent", "success", "warning", "danger")
BACKGROUNDS = ("bg-primary", "bg-secondary", "bg-card")
AA = 4.5


def _block(selector: str) -> dict[str, str]:
    m = re.search(re.escape(selector) + r"\s*\{(.*?)\n\}", CSS, re.S)
    assert m, f"no {selector} block in css/app.css"
    return dict(re.findall(r"--([a-z0-9-]+):\s*([^;]+);", m.group(1)))


DARK = _block(":root")
LIGHT = {**DARK, **_block('[data-theme="light"]')}  # light overrides only some tokens


def _rgba(value: str) -> tuple[float, float, float, float]:
    value = value.strip()
    if value.startswith("#"):
        h = value.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return (*(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)), 1.0)
    m = re.match(r"rgba?\(([^)]+)\)", value)
    assert m, f"cannot parse colour {value!r}"
    parts = [p.strip() for p in m.group(1).split(",")]
    r, g, b = (int(p) / 255 for p in parts[:3])
    return (r, g, b, float(parts[3]) if len(parts) > 3 else 1.0)


def _over(fg: tuple[float, ...], bg: tuple[float, ...]) -> tuple[float, float, float, float]:
    """Composite a translucent colour over an opaque one."""
    a = fg[3]
    return (*(fg[i] * a + bg[i] * (1 - a) for i in range(3)), 1.0)


def _luminance(c: tuple[float, ...]) -> float:
    lin = [(x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4) for x in c[:3]]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def _contrast(fg: tuple[float, ...], bg: tuple[float, ...]) -> float:
    a, b = _luminance(fg), _luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def _resolve(palette: dict[str, str], token: str) -> tuple[float, float, float, float]:
    c = _rgba(palette[token])
    # Cards are translucent; they sit on the page background.
    return c if c[3] == 1.0 else _over(c, _rgba(palette["bg-primary"]))


@pytest.mark.parametrize("theme", ["dark", "light"])
@pytest.mark.parametrize("bg_token", BACKGROUNDS)
@pytest.mark.parametrize("fg_token", FOREGROUNDS)
def test_text_colours_clear_aa(theme: str, bg_token: str, fg_token: str) -> None:
    palette = DARK if theme == "dark" else LIGHT
    ratio = _contrast(_resolve(palette, fg_token), _resolve(palette, bg_token))
    assert ratio >= AA, f"{theme}: --{fg_token} on --{bg_token} is {ratio:.2f}:1, below {AA}"


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_button_labels_clear_aa_on_their_fill(theme: str) -> None:
    """The one pair where the background is the accent, not the page."""
    palette = DARK if theme == "dark" else LIGHT
    for fill in ("accent", "accent-hover"):
        ratio = _contrast(_resolve(palette, "on-accent"), _resolve(palette, fill))
        assert ratio >= AA, f"{theme}: --on-accent on --{fill} is {ratio:.2f}:1"
    ratio = _contrast(_resolve(palette, "on-brand"), _resolve(palette, "brand-from"))
    assert ratio >= 3.0, f"{theme}: --on-brand on --brand-from is {ratio:.2f}:1"


def test_both_themes_define_the_same_tokens() -> None:
    """A token defined only in :root silently keeps its dark value in light."""
    light_only = _block('[data-theme="light"]')
    colour_tokens = {
        k for k, v in DARK.items()
        if v.strip().startswith("#") or v.strip().startswith("rgb")
    }
    missing = sorted(colour_tokens - set(light_only))
    assert not missing, f"light theme does not override: {missing}"
