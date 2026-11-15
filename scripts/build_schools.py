#!/usr/bin/env python3
"""Convert Ontario's 'Publicly Funded Schools' contact list (pipe-delimited TXT,
Open Government Licence - Ontario) into a compact JSON used by the app.

Usage: python3 scripts/build_schools.py public_school_contact_list_*.txt data/schools-on.json
Source: https://data.ontario.ca/dataset/ontario-public-school-contact-information
"""
import csv, json, sys

src, dst = sys.argv[1], sys.argv[2]
rows = []
with open(src, encoding="utf-8-sig", newline="") as f:
    for r in csv.DictReader(f, delimiter="|"):
        rows.append({
            "id": r["School Number"].strip(),
            "n": r["School Name"].strip(),
            "b": r["Board Name"].strip(),
            "lvl": r["School Level"].strip(),
            "lang": r["School Language"].strip(),
            "t": r["School Type"].strip(),
            "sp": r["School Special Conditions"].strip(),
            "g": r["Grade Range"].strip(),
            "st": r["Street"].strip(),
            "c": r["City"].strip(),
            "pc": r["Postal Code"].strip(),
            "ph": r["Phone"].strip(),
            "w": r["Website"].strip(),
            "bw": r["Board Website"].strip(),
        })
meta = {"source": "Ontario Ministry of Education - Publicly Funded Schools contact list",
        "url": "https://data.ontario.ca/dataset/ontario-public-school-contact-information",
        "licence": "Open Government Licence - Ontario", "count": len(rows)}
with open(dst, "w", encoding="utf-8") as f:
    json.dump({"meta": meta, "schools": rows}, f, ensure_ascii=False, separators=(",", ":"))
print(f"wrote {len(rows)} schools to {dst}")
