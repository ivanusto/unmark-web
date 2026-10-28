"""js/zh_style.js: the repo-owned CJK heuristic. No upstream counterpart, so these
are behavioural checks rather than parity checks. Requires node; skips without it."""
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

# Written in Simplified so the fold has real work to do; TRAD is the same text in Traditional.
AI_SIMP = (
    "在当今数字化时代，人工智能正在深刻改变我们的生活。值得一提的是，这项技术不仅提高了效率，更为各行各业提供了坚实的基础。\n"
    "首先，它降低了成本。其次，它缩短了周期。最后，它让决策更加精准。毫无疑问，这些变化至关重要。\n"
    "与此同时，我们也面临挑战与机遇。这不是一场简单的技术升级，而是一次深刻的变革。\n"
    "总而言之，只有拥抱变化，才能在未来立于不败之地。让我们一起开启新篇章，未来可期。"
)
AI_TRAD = (
    "在當今數位化時代，人工智慧正在深刻改變我們的生活。值得一提的是，這項技術不僅提高了效率，更為各行各業提供了堅實的基礎。\n"
    "首先，它降低了成本。其次，它縮短了週期。最後，它讓決策更加精準。毫無疑問，這些變化至關重要。\n"
    "與此同時，我們也面臨挑戰與機遇。這不是一場簡單的技術升級，而是一次深刻的變革。\n"
    "總而言之，只有擁抱變化，才能在未來立於不敗之地。讓我們一起開啟新篇章，未來可期。"
)
# fold only maps a fixed set of characters; the simplified text above must be made of those
# for the identical-score check to be meaningful, so the pair differs only where fold knows.
PLAIN = (
    "浙江省位於中國東南沿海，面積約十點五萬平方公里，二零二零年常住人口約六千四百五十七萬人。"
    "省會杭州。下轄十一個地級市，其中寧波與溫州的人口都超過九百萬。"
    "境內多山地丘陵，最高峰黃茅尖海拔一千九百一十七公尺。"
    "錢塘江自西向東流入東海，全長約四百零二公里。每年農曆八月，江口會出現湧潮。"
    "稻米、茶葉與蠶絲是主要農產品，龍井茶產於西湖周邊。"
    "寧波舟山港在二零二三年的貨物吞吐量超過十三億噸，居全球首位。"
    "杭州於二零二二年舉辦第十九屆亞洲運動會。"
    "全省鐵路營運里程逾三千公里，高速公路通車里程約五千公里，兩者在近十年內都增加了一倍以上。"
    "人口以漢族為主。"
)


def run(text: str) -> dict:
    proc = subprocess.run([NODE, str(ROOT / "tests" / "zh_style_cli.js")],
                          input=json.dumps({"text": text}), capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def cjk(text: str) -> int:
    return len(re.findall(r"[㐀-䶿一-鿿豈-﫿]", text))


def labels(rep: dict) -> list[str]:
    return sorted(m["label"] for m in rep["matched"]) + sorted(s["label"] for s in rep["structure"])


def test_fold_keeps_length() -> None:
    r = run(AI_SIMP)
    assert r["folded_len"] == r["input_len"]


def test_simplified_and_traditional_agree() -> None:
    s, t = run(AI_SIMP)["report"], run(AI_TRAD)["report"]
    assert s["status"] == t["status"] == "ok"
    assert s["score"] == t["score"]
    assert labels(s) == labels(t)


def test_english_is_not_applicable() -> None:
    r = run("This is an English paragraph. " * 30)
    assert r["report"]["status"] == "not_applicable"
    assert r["report"]["score"] is None
    assert r["applies"] is False


def test_short_chinese_is_insufficient_length() -> None:
    text = "值得一提的是，總而言之，這是一段很短的中文。" * 2
    assert 20 <= cjk(text) < 120
    rep = run(text)["report"]
    assert rep["status"] == "insufficient_length"
    assert rep["score"] is None


def test_stock_ai_paragraph_scores_high() -> None:
    assert cjk(AI_TRAD) >= 120
    rep = run(AI_TRAD)["report"]
    assert rep["status"] == "ok"
    assert rep["score"] >= 0.35, rep["score"]
    got = set(labels(rep))
    for want in ("值得一提的是", "在當今……時代", "總而言之", "不是……而是", "首先／其次／最後"):
        assert want in got, (want, sorted(got))


def test_plain_factual_paragraph_scores_low() -> None:
    assert cjk(PLAIN) >= 120
    rep = run(PLAIN)["report"]
    assert rep["status"] == "ok"
    assert rep["score"] < 0.35, (rep["score"], labels(rep))


# Nine sentences of 18-22 characters each: sentence-length CV is far below 0.35, so the
# structure list gets the "句長均一" item; the 500-character density floor must keep a
# paragraph this short from being flagged by that single hit.
UNIFORM = (
    "浙江省位於中國東南沿海地區，面積約十點五萬平方公里。"
    "省會杭州市位於錢塘江下游北岸，人口約一千二百萬人。"
    "寧波市是浙江省最大的港口城市，港區吞吐量居全球首位。"
    "溫州市位於浙江省南部沿海，轄區內擁有大量民營企業。"
    "境內西部多山地丘陵，最高峰黃茅尖海拔一千九百多公尺。"
    "錢塘江自西向東流入東海，全長約四百公里左右。"
    "龍井茶主要產於西湖周邊，採摘季節集中在春季前後。"
    "全省鐵路營運里程超過三千公里，高速公路網相當密集。"
    "舟山群島位於浙江省東部海域，島嶼數量居全國第一。"
)


def test_short_uniform_paragraph_is_not_flagged() -> None:
    assert 150 <= cjk(UNIFORM) < 500
    rep = run(UNIFORM)["report"]
    assert rep["status"] == "ok"
    assert any(s["label"].startswith("句長均一") for s in rep["structure"]), labels(rep)
    assert rep["score"] < 0.35, (rep["score"], labels(rep))


def test_spans_are_valid_on_the_original_text() -> None:
    r = run(AI_SIMP)
    spans = r["report"]["spans"]
    assert spans
    assert all(t for t in r["span_texts"])
    assert all(s["end"] > s["start"] for s in spans)
    assert [s["start"] for s in spans] == sorted(s["start"] for s in spans)


def test_residual_sentences_are_whole_sentences() -> None:
    r = run(AI_SIMP)
    sentences = r["sentences"]
    assert sentences
    for s in sentences:
        assert s in AI_SIMP
        assert s[-1] in "。！？" or AI_SIMP.rstrip().endswith(s), s
        assert any(span in s for span in r["span_texts"]), s
