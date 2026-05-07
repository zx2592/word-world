import json
import re
from pathlib import Path

import pdfplumber

PDF_PATH = Path(
    r"C:\Users\Hengshi\Desktop\Vocabulary workshop. [Grade 4], Level orange (Shostak, Jerome, Sadlier-Oxford (Firm)) (z-library.sk, 1lib.sk, z-lib.sk).pdf"
)
OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "workshop-orange.js"


def clean(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "")
    return text.strip(" ;,.")


def split_terms(text: str) -> list[str]:
    text = clean(text)
    text = re.sub(r"\([^)]*\)", "", text)
    text = text.replace(";", ",")
    text = re.sub(r"\bto\s+", "", text)
    parts = [clean(p) for p in re.split(r",|\bor\b", text)]
    parts = [re.sub(r"^(?:a|an|the)\s+", "", p, flags=re.I) for p in parts]
    return [p for p in parts if 1 <= len(p) <= 28 and not re.search(r"\d|www|visit|word", p, re.I)]


def extract_entries(text: str) -> list[dict]:
    entries = []
    pattern = re.compile(
        r"(?:^|\n)\s*(\d{1,2})\.\s+([A-Za-z][A-Za-z'-]*)\s+(?:\([^)]*\)\s*){0,3}"
        r"(?P<body>.*?)(?=\n\s*\d{1,2}\.\s+[A-Za-z][A-Za-z'-]*\s+|\Z)",
        re.S,
    )
    for m in pattern.finditer(text):
        word = m.group(2).lower()
        body = clean(m.group("body"))
        if len(word) < 3 or word in {"definitions", "remember"}:
            continue
        pos_match = re.search(r"\((n|v|adj|adv)\.\)", m.group(0))
        syn_match = re.search(r"SYNONYMS?:\s*(.*?)(?:ANTONYMS?:|$)", body, re.I)
        ant_match = re.search(r"ANTONYMS?:\s*(.*?)(?:SYNONYMS?:|$)", body, re.I)
        syn = split_terms(syn_match.group(1) if syn_match else "")
        ant = split_terms(ant_match.group(1) if ant_match else "")
        if not syn and not ant:
            continue
        entries.append(
            {
                "w": word,
                "ps": (pos_match.group(1) + ".") if pos_match else "word",
                "syn": syn[:8],
                "ant": ant[:8],
            }
        )
    return entries


def merge(entries: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for item in entries:
        cur = merged.setdefault(item["w"], {"w": item["w"], "ps": item["ps"], "syn": [], "ant": []})
        if cur["ps"] == "word" and item["ps"] != "word":
            cur["ps"] = item["ps"]
        for key in ("syn", "ant"):
            for term in item[key]:
                if term and term not in cur[key]:
                    cur[key].append(term)
    return sorted(
        [x for x in merged.values() if x["syn"] or x["ant"]],
        key=lambda x: x["w"],
    )


def main() -> None:
    all_entries = []
    with pdfplumber.open(str(PDF_PATH)) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            all_entries.extend(extract_entries(text))
    words = merge(all_entries)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(words, ensure_ascii=False, indent=2)
    OUT_PATH.write_text(
        "// Generated from the local Vocabulary Workshop Level Orange PDF.\n"
        "// Contains vocabulary relationship facts only; exercises are generated in-app.\n"
        f"window.WORKSHOP_ORANGE = {payload};\n",
        encoding="utf-8",
    )
    print(f"Extracted {len(words)} words to {OUT_PATH}")


if __name__ == "__main__":
    main()
