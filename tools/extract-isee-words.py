"""Extract ISEE Lower / Upper vocabulary from the books/0530 source files.

Outputs two data bundles consumed by index.html:
  data/isee-lower.js  -> window.ISEE_LOWER  (from the two "lower 单词" PDFs)
  data/isee-upper.js  -> window.ISEE_UPPER  (from the docx + 精选词 PDF sources)

Each entry: {"w": word, "ms": Chinese meaning, "syn": [english cues], "ph": "/ipa/"?}.

Dedup rules:
  * within a bundle: same word merged (synonyms unioned, longest meaning kept)
  * across bundles: any word present in Lower is removed from Upper
  * "3500wordList Harkness.pdf" is intentionally skipped: it already ships as
    data/harkness-words.js (also ISEE Upper), so re-extracting would duplicate it.
"""

import json
import re
from pathlib import Path

import docx
import pdfplumber

BOOKS = Path(__file__).resolve().parents[1] / "books" / "0530"
DATA = Path(__file__).resolve().parents[1] / "data"

CN = "一-鿿"
CN_RE = re.compile(f"[{CN}]")
# watermark letters sprinkled through 精选词 599.pdf ("NANJING ..." stamp)
WATERMARK = re.compile(r"(?<![A-Za-z])[NAUXGIJ](?![A-Za-z])")


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip(" ,，;；.、")


POS = r"(?:adj|adv|prep|conj|pron|interj|vt|vi|v|n|a)"


def clean_cn(text: str) -> str:
    """Keep only the Chinese-meaning portion, dropping part-of-speech tags."""
    text = clean(text)
    text = re.sub(rf"\b{POS}\b\.?", "", text, flags=re.I)
    return clean(text)


def def_to_cue(eng: str) -> str:
    """Turn an English dictionary definition into a short synonym-style cue."""
    eng = clean(eng)
    # strip leading part-of-speech tags (possibly several) and articles
    while True:
        new = re.sub(rf"^{POS}\.\s+", "", eng, flags=re.I)
        new = re.sub(r"^(to|a|an|the)\s+", "", new, flags=re.I)
        if new == eng:
            break
        eng = new
    cue = " ".join(eng.split()[:4])
    # reject fragments that still carry a pos remnant or are non-english
    if not cue or "." in cue or CN_RE.search(cue) or len(cue) < 3:
        return ""
    return cue


def split_syn(text: str) -> list[str]:
    text = clean(text).replace("，", ",").replace("；", ";").replace("、", ",")
    parts = re.split(r"[,;]|\bor\b", text)
    out = []
    for p in parts:
        p = clean(p)
        # keep short english cues; drop empties, numerics, chinese, over-long phrases
        if p and 1 <= len(p) <= 28 and "." not in p and not CN_RE.search(p) and len(p.split()) <= 3:
            if p.lower() not in (x.lower() for x in out):
                out.append(p)
    return out


def add(store: dict, word: str, ms: str, syn: list[str], ph: str = "") -> None:
    word = (word or "").strip().lower()
    if not word or not re.fullmatch(r"[a-z][a-z'-]*", word) or len(word) < 2:
        return
    cur = store.setdefault(word, {"w": word, "ms": "", "syn": [], "ph": ""})
    if ms and len(ms) > len(cur["ms"]):
        cur["ms"] = ms
    for s in syn:
        if s.lower() not in (x.lower() for x in cur["syn"]):
            cur["syn"].append(s)
    if ph and not cur["ph"]:
        cur["ph"] = ph


# ---------------------------------------------------------------- ISEE Lower
def parse_lower(store: dict, pdf_path: Path) -> None:
    # "12. experience=knowledge 经历"  /  "87.thwart= frustrate 阻碍"
    line_re = re.compile(
        rf"^\s*\d+\s*\.?\s*([A-Za-z][A-Za-z'-]*)\s*=\s*([A-Za-z][A-Za-z' -]*?)\s+([{CN}].*)$"
    )
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").splitlines():
                m = line_re.match(clean(line))
                if not m:
                    continue
                word, syn, cn = m.group(1), clean(m.group(2)), clean_cn(m.group(3))
                add(store, word, cn, split_syn(syn))


# ---------------------------------------------------------------- ISEE Upper
def parse_upper_docx_paras(store: dict, docx_path: Path) -> None:
    # "abandon /əˈbændən/ = forsake, desert 放弃；遗弃"
    line_re = re.compile(
        rf"^([A-Za-z][A-Za-z'-]*)\s*(/[^/]*/)?\s*=\s*([^={CN}]+?)\s*([{CN}].*)$"
    )
    for para in docx.Document(str(docx_path)).paragraphs:
        m = line_re.match(clean(para.text))
        if not m:
            continue
        word, ph, syn, cn = m.group(1), m.group(2) or "", clean(m.group(3)), clean_cn(m.group(4))
        add(store, word, cn, split_syn(syn), ph.strip())


def parse_upper_docx_table(store: dict, docx_path: Path) -> None:
    # table rows: [word, "v. 中文释义", "english definition"]
    for table in docx.Document(str(docx_path)).tables:
        for row in table.rows:
            cells = [clean(c.text) for c in row.cells]
            if len(cells) < 2:
                continue
            word = cells[0]
            if not re.fullmatch(r"[A-Za-z][A-Za-z'-]*", word):
                continue  # skips "list 1" header rows
            ms = clean_cn(cells[1])
            cue = def_to_cue(cells[2]) if len(cells) > 2 else ""
            add(store, word, ms, [cue] if cue else [])


def parse_upper_599(store: dict, pdf_path: Path) -> None:
    # alternating "word english_cue" then "<num> 中文", with stray watermark caps.
    word_re = re.compile(r"^([a-z][a-z'-]+)\s+([A-Za-z].*)$")
    cn_re = re.compile(rf"^\d+\s+([{CN}].*)$")
    pending = None  # (word, syn)
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            for raw in (page.extract_text() or "").splitlines():
                line = clean(WATERMARK.sub(" ", raw))
                if not line or line.startswith("单词"):
                    continue
                wm = word_re.match(line)
                if wm and not CN_RE.search(line):
                    pending = (wm.group(1), split_syn(wm.group(2)))
                    continue
                cm = cn_re.match(line)
                if cm and pending:
                    add(store, pending[0], clean_cn(cm.group(1)), pending[1])
                    pending = None


def dump(store: dict, var: str, out_path: Path, banner: str) -> int:
    words = sorted(store.values(), key=lambda x: x["w"])
    for w in words:
        if not w["ph"]:
            w.pop("ph")  # let phonetics.js fill it in later
        if not w["syn"]:
            w["syn"] = ["related idea"]
    out_path.write_text(
        f"{banner}window.{var} = " + json.dumps(words, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    return len(words)


def main() -> None:
    lower: dict = {}
    parse_lower(lower, BOOKS / "lower 单词1.pdf")
    parse_lower(lower, BOOKS / "lower 单词2.pdf")

    upper: dict = {}
    parse_upper_docx_paras(upper, BOOKS / "2026 ISEE upper单词1.docx")
    parse_upper_docx_table(upper, BOOKS / "196单词list1-54(4).docx")
    parse_upper_599(upper, BOOKS / "精选词  599.pdf")

    # cross-bundle dedup: a word in Lower stays in Lower only
    for w in list(upper):
        if w in lower:
            del upper[w]

    n_lower = dump(
        lower, "ISEE_LOWER", DATA / "isee-lower.js",
        "// Generated by tools/extract-isee-words.py from the two 'lower 单词' PDFs.\n"
        "// ISEE Lower vocabulary: word, Chinese meaning, synonym cue.\n",
    )
    n_upper = dump(
        upper, "ISEE_UPPER", DATA / "isee-upper.js",
        "// Generated by tools/extract-isee-words.py from the ISEE upper docx + 精选词 PDF.\n"
        "// ISEE Upper vocabulary: word, Chinese meaning, synonym cues, phonetic when known.\n"
        "// (3500wordList Harkness.pdf is omitted; it already ships as harkness-words.js.)\n",
    )
    print(f"ISEE Lower: {n_lower} words -> data/isee-lower.js")
    print(f"ISEE Upper: {n_upper} words -> data/isee-upper.js")


if __name__ == "__main__":
    main()
