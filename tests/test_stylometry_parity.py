"""Cross-engine parity: js/stylometry.js must match upstream score_stylometry.py.

Requires `node` and an upstream checkout (WATERMARKS_UPSTREAM_DIR, default
../watermarks-remover). Skips cleanly when either is missing.
"""
from __future__ import annotations

import json
import math
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
    NODE is None or not (SCRIPTS / "score_stylometry.py").is_file(),
    reason="needs node and an upstream checkout (WATERMARKS_UPSTREAM_DIR)",
)

if (SCRIPTS / "score_stylometry.py").is_file():
    sys.path.insert(0, str(SCRIPTS))
    import score_stylometry  # type: ignore  # noqa: E402

HUMAN_PROSE = (
    "I left the house late. The bus was gone, of course, so I walked the two miles along the river "
    "where the herons stand like grey umbrellas and nobody ever seems to be in a hurry except me. "
    "Rain. Then sun. Then that strange in-between light that makes the water look like pewter and "
    "the trees look older than they are. By the time I reached the office my shoes were soaked, my "
    "notes were damp, and I had completely forgotten what the meeting was about, which turned out not "
    "to matter because it had been cancelled an hour earlier without anyone telling me. I bought a "
    "coffee. A terrible one. Sat on the steps outside and watched a man try, for ten full minutes, to "
    "parallel-park a van that was plainly too long for the space, while his passenger read a newspaper "
    "and said nothing at all. Eventually he gave up. So did I, more or less, and went home the long way."
)

LLM_PROSE = (
    "Renewable energy plays a crucial role in the modern economy. Solar panels convert sunlight "
    "into electricity for homes and businesses. Wind turbines harness the power of moving air across "
    "open plains. Hydroelectric dams generate power from flowing water in river systems. Geothermal "
    "plants use heat from deep within the earth to produce steam. Battery storage allows surplus "
    "energy to be saved for later use. Smart grids distribute electricity efficiently across entire "
    "regions. Governments offer incentives to encourage adoption of clean technologies. Companies "
    "invest in research to improve efficiency and reduce costs. Consumers benefit from lower bills "
    "and cleaner air in their communities. Ultimately, renewable energy offers a sustainable path "
    "forward for future generations. In conclusion, the transition to clean power is well underway."
)

MARKER_DENSE = (
    "In today's fast-paced digital world, it is important to note that we must delve into the rich "
    "tapestry of data. AS AN AI, I hope this helps: Delving into a myriad of topics plays a pivotal "
    "role in fostering a sense of community. This serves as a beacon and underscores the importance "
    "of a holistic approach. Furthermore, navigating the complexities seamlessly integrates a paradigm "
    "shift. MOREOVER, the multifaceted nature of harnessing the power of tools is a testament to "
    "progress. Not only does it help, but also serves to highlight growth. In Conclusion, to "
    "summarize, ultimately, DELVES INTO everything. In the ever-evolving landscape we delved into it."
)

CODE_FENCED = (
    "Here is the setup. It only takes a minute.\n\n```python\nimport os\nprint(os.getcwd())\n"
    "for i in range(10):\n    print(i)\n```\n\nAfter running it, check the output. The path should "
    "point at your project root, not at the home directory. If it does not, open a shell, change "
    "into the project, and try again from there. That is usually the whole fix.\n\n```\nmake test\n```\n"
)

BLANK_LINES = (
    "First paragraph sits here and has a handful of words in it\n\n\n"
    "second paragraph starts lowercase and also has a handful of words\n\n"
    "Third paragraph. Has two sentences! And a question? Yes.\n   \n\t\n"
    "Fourth paragraph is the last one and it is a little bit longer than the others so the count differs\n"
)

CJK = (
    "今天天氣很好，我們去公園散步。公園裡有很多人在運動，小孩子在草地上奔跑。"
    "傍晚的時候，天空變成了橘紅色，非常漂亮！我們決定留下來看日落。"
    "回家的路上，我們買了一些水果和麵包。明天應該也會是好天氣吧？"
    "日本語の文も入れます。これはテストです。한국어 문장도 있습니다."
)

CJK_MIXED = (
    "這是一段混合文字 mixed text with English words. 我們 delve into 細節 and it is important to "
    "note 這一點。Furthermore, 中文句子沒有空格所以 \\w 的行為很重要。"
    "Ultimately, 結論在這裡. Another sentence follows here with plenty of ordinary English words "
    "to push the total count well past the thirty word calibration floor for the scorer. 完。"
)

ONE_SENTENCE = (
    "this is a single long run of words with no terminal punctuation at all just words and more "
    "words going on and on for long enough to clear the thirty word minimum so burstiness is none "
    "because there is only one sentence"
)

WINDOWS_EOL = HUMAN_PROSE.replace(". ", ".\r\n") + "\r\n\r\nA trailing paragraph.\r\nAnother line.\r\n"

ODD_WHITESPACE = (
    "Tabs\there\tand\xa0nbsp\xa0here. Line\u2028separator next! Paragraph\u2029sep.\x85NEL here.\x0cForm feed. "
    "\u3000Ideographic space\u3000and\u202fnarrow.\x1cFS\x1dGS\x1eRS\x1fUS word_with_underscore "
    "hyphen-ated it's don't 'quoted' -dash- caf\xe9 na\xefve r\xe9sum\xe9 \u03a9mega \xdf stra\xdfe \ufb01ne 123 4.5 6,7 "
    "and enough words to get past the floor of thirty words for the scorer here now. Done.\ufeff"
)

CASE_FOLD = (
    "ı hope this helps and İ hope this helps, delve ınto it, ſeamleſsly integrates, a teſtament to "
    "KELVIN SIGN: Key role? plays a Key role. Moreover, paradıgm shift happens. "
    "Enough filler words follow here to push the total comfortably past the thirty word floor now."
)

TIE_DENSITY = (
    # 80 words, one marker of weight 0.9 -> density 0.9/0.8 == 1.125 exactly in binary,
    # which Python formats as "1.12" (half-even) where JS toFixed would give "1.13".
    "It is important to note that " + " ".join(f"w{i}" for i in range(74)) + "."
)

CASES = {
    "empty": "",
    "whitespace_only": "  \n\t\r\n  ",
    "short_plain": "Just a few words here.",
    "short_with_markers": "As an AI, I hope this helps. Delve into it. Furthermore, in conclusion, done.",
    "short_cjk": "這是一個短句。",
    "mid_29_words": " ".join(f"word{i}" for i in range(29)) + ".",
    "mid_30_words": " ".join(f"word{i}" for i in range(30)) + ".",
    "mid_65_words": ". ".join(" ".join(f"t{i}{j}" for j in range(5)) for i in range(13)) + ".",
    "mid_99_words": " ".join(f"x{i}" for i in range(99)) + ". And? More! Yes.",
    "exact_100_words": " ".join(f"x{i}" for i in range(96)) + ". Short one. Two words. Three little words.",
    "human_prose": HUMAN_PROSE,
    "llm_prose": LLM_PROSE,
    "marker_dense": MARKER_DENSE,
    "marker_dense_upper": MARKER_DENSE.upper(),
    "marker_dense_x3": (MARKER_DENSE + "\n") * 3,
    "code_fenced": CODE_FENCED,
    "all_in_code_fence": "```\n" + HUMAN_PROSE + "\n```\n",
    "unclosed_fence": "Intro line here. " + HUMAN_PROSE[:200] + "\n```\n" + HUMAN_PROSE,
    "blank_lines": BLANK_LINES,
    "cjk": CJK,
    "cjk_mixed": CJK_MIXED,
    "one_sentence": ONE_SENTENCE,
    "two_sentences_one_empty": ONE_SENTENCE + ". ...",
    "windows_eol": WINDOWS_EOL,
    "windows_eol_llm": LLM_PROSE.replace(". ", ".\r\n"),
    "odd_whitespace": ODD_WHITESPACE,
    "case_fold": CASE_FOLD,
    "tie_density": TIE_DENSITY,
    "uniform_cv_zero": " ".join("alpha beta gamma delta epsilon." for _ in range(12)),
    "repetitive_mattr": " ".join(["the cat sat on the mat"] * 30) + ".",
    "single_word_repeated": " ".join(["word"] * 200),
    "no_word_chars": "!!! ??? ... --- ''' ,,, ;;; :::",
    "quotes_and_brackets": '"Quoted start." (Parenthetical one.) [Bracketed two.] \'Single three.\' 9 lives. x',
    "hyphen_apostrophe_edges": "-start end- 'quoted' rock'n'roll --double-- it's o'clock don't well-known ' - '' --",
}


def _js(text: str, options: dict | None = None) -> dict:
    req = {"text": text, "options": options or {}}
    proc = subprocess.run([NODE, str(ROOT / "tests" / "stylometry_cli.js")], input=json.dumps(req),
                          capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def _assert_same(js: dict, py: dict) -> None:
    assert list(js.keys()) == list(py.keys())
    for key in py:
        a, b = js[key], py[key]
        if isinstance(b, float) and b is not None:
            assert isinstance(a, (int, float)) and math.isclose(a, b, rel_tol=0, abs_tol=1e-9), (key, a, b)
        elif key == "matched_markers":
            assert len(a) == len(b), key
            for ma, mb in zip(a, b):
                assert ma["phrase"] == mb["phrase"]
                assert ma["count"] == mb["count"]
                assert math.isclose(ma["weight"], mb["weight"], rel_tol=0, abs_tol=1e-9)
                assert ma["samples"] == mb["samples"], (ma["phrase"], ma["samples"], mb["samples"])
        else:
            assert a == b, (key, a, b)


@pytest.mark.parametrize("name", list(CASES))
def test_score_parity(name: str) -> None:
    text = CASES[name]
    py = score_stylometry.score_text_stylometry(text).to_dict()
    js = _js(text)
    _assert_same(js, py)


def test_path_option() -> None:
    py = score_stylometry.score_text_stylometry(HUMAN_PROSE, path="notes.md").to_dict()
    js = _js(HUMAN_PROSE, {"path": "notes.md"})
    _assert_same(js, py)


def test_constants_and_marker_table() -> None:
    src = (ROOT / "js" / "stylometry.js").read_text(encoding="utf-8")
    assert f"DEFAULT_THRESHOLD = {score_stylometry.DEFAULT_THRESHOLD}" in src
    assert f"MIN_SAMPLE_WORDS = {score_stylometry.MIN_SAMPLE_WORDS}" in src
    assert f"FULL_WEIGHT_WORDS = {score_stylometry.FULL_WEIGHT_WORDS}" in src
    dump = subprocess.run(
        [NODE, "-e", "process.stdout.write(JSON.stringify(require(process.argv[1]).AI_PHRASE_PATTERNS))",
         str(ROOT / "js" / "stylometry.js")],
        capture_output=True, text=True, check=True,
    ).stdout
    js_table = [tuple(row) for row in json.loads(dump)]
    assert js_table == [tuple(row) for row in score_stylometry.AI_PHRASE_PATTERNS]
