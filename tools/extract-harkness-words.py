import json
import re
from pathlib import Path

import pdfplumber

PDF_PATH = Path(r"C:\Users\Hengshi\Desktop\temp\words\1.pdf")
OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "harkness-words.js"


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip(" ,，;；.")


def split_terms(text: str) -> list[str]:
    text = clean(text).replace("，", ",").replace("；", ",").replace("、", ",")
    parts = [clean(p) for p in re.split(r",|;|\bor\b", text)]
    return [p for p in parts if 1 <= len(p) <= 32 and not re.search(r"[\u4e00-\u9fff]|\d|wechat|list", p, re.I)]


def parse_line(line: str) -> dict | None:
    line = clean(line)
    if not line or re.match(r"^(LIST\d+|\d+|Harkness Academy|Tom&Jerry|wechat)", line, re.I):
        return None
    m = re.match(r"^([A-Za-z][A-Za-z'-]{2,})\s+(.+)$", line)
    if not m:
        return None
    word, rest = m.group(1).lower(), clean(m.group(2))
    if not re.search(r"[\u4e00-\u9fff]", rest):
        return None
    cm = re.match(r"^([\u4e00-\u9fff，,、；;\s（）()]+)\s*(.*)$", rest)
    if not cm:
        return None
    meaning = clean(cm.group(1))
    english = clean(cm.group(2))
    syn = split_terms(english)
    return {"w": word, "ms": meaning, "syn": syn[:8]}


def main() -> None:
    entries: dict[str, dict] = {}
    with pdfplumber.open(str(PDF_PATH)) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            for line in text.splitlines():
                item = parse_line(line)
                if not item:
                    continue
                cur = entries.setdefault(item["w"], {"w": item["w"], "ms": item["ms"], "syn": []})
                if len(item["ms"]) > len(cur["ms"]):
                    cur["ms"] = item["ms"]
                for term in item["syn"]:
                    if term not in cur["syn"]:
                        cur["syn"].append(term)
    words = sorted(entries.values(), key=lambda x: x["w"])
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        "// Generated from the local Harkness vocabulary PDF.\n"
        "// Contains word, Chinese meaning, and synonym/definition cues.\n"
        "window.HARKNESS_WORDS = "
        + json.dumps(words, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Extracted {len(words)} words to {OUT_PATH}")


if __name__ == "__main__":
    main()
