#!/usr/bin/env python3
"""Build data/fraser.json from the Fraser Institute Report Card PDFs (Ontario).

Input: a TSV exported from the PDFs' ranking tables, with section markers:
    E                                   <- elementary rows follow
    rank<TAB>school<TAB>city<TAB>rating<TAB>rating5yr<TAB>trend(up|down|)
    S                                   <- secondary rows follow
The TSV is produced by scripts/extract_fraser.js (run in a browser on fraserinstitute.org,
because the PDFs are behind bot protection). Usage:
    python3 scripts/build_fraser.py fraser.tsv data/fraser.json
Ratings (c) Fraser Institute, compareschoolrankings.org. Shown with attribution and links back.
"""
import json, sys

src, dst = sys.argv[1], sys.argv[2]
sec = None
data = {"elementary": [], "secondary": []}
for line in open(src, encoding="utf-8"):
    line = line.rstrip("\n")
    if line in ("E", "S"):
        sec = "elementary" if line == "E" else "secondary"; continue
    if not line.strip() or sec is None: continue
    p = line.split("\t")
    rank, name, city, rating = p[0], p[1], p[2], float(p[3])
    r5 = float(p[4]) if len(p) > 4 and p[4] else None
    trend = p[5] if len(p) > 5 else ""
    data[sec].append([int(rank), name, city, rating, r5, trend])
out = {
    "meta": {
        "source": "Fraser Institute — Report Card on Ontario's Elementary Schools 2025 (2023/24 results) and Report Card on Ontario's Secondary Schools 2025 (2023/24 results)",
        "elementaryUrl": "https://www.fraserinstitute.org/studies/report-card-ontarios-elementary-schools-2025",
        "secondaryUrl": "https://www.fraserinstitute.org/studies/report-card-ontarios-secondary-schools-2025",
        "site": "https://www.compareschoolrankings.org/",
        "elementaryTotal": 3052, "secondaryTotal": 747,
        "columns": ["rank", "school", "city", "rating", "rating5yrAvg", "trend"],
    },
    **data,
}
json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"elementary={len(data['elementary'])} secondary={len(data['secondary'])} -> {dst}")
