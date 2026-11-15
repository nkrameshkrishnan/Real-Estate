#!/usr/bin/env python3
"""Give every Ontario publicly funded school a coordinate, so the app can list schools
without calling Overpass at runtime.

1. Download all amenity=school features in Ontario from OpenStreetMap (one Overpass query).
2. Match them to data/schools-on.json by normalised name + city / postal code.
3. Geocode the rest with Nominatim (structured search, 1 request/second, per its usage policy).
Results are kept in data/school-coords.json ({school_number: [lat, lon, source]}) so later runs
only geocode new schools. Run in CI (GitHub Actions); takes ~10-40 minutes the first time.

Usage: python3 scripts/school_coords.py [--max-geocode N]
"""
import json, re, sys, time, unicodedata, urllib.parse, urllib.request

UA = "OntarioHomeInsight/1.0 (https://github.com/nkrameshkrishnan/Real-Estate)"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
MAX_GEOCODE = int(sys.argv[sys.argv.index("--max-geocode") + 1]) if "--max-geocode" in sys.argv else 10000

STOP = r"\b(ecole|elementaire|secondaire|catholique|publique|intermediaire|jr & sr|junior and senior|junior & senior|alternative|french immersion|public school|ps|elementary school|catholic school|cs|catholic elementary school|ces|junior|jr|senior|sr|middle school|ms|secondary school|ss|collegiate institute|ci|high school|school|the|and|of|catholic|elementary|public|secondary|collegiate|institute|academy)\b"
def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\b(st\.?|saint)\b", "st", s).replace("&", " and ")
    s = re.sub(STOP, " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()
def cityk(s): return re.sub(r"[^a-z]", "", (s or "").lower())
def pc(s): return re.sub(r"\s", "", (s or "").upper())

def http(url, data=None, timeout=300):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

def overpass_schools():
    q = '[out:json][timeout:600];area["ISO3166-2"="CA-ON"][admin_level=4]->.on;nwr(area.on)[amenity=school];out center tags;'
    for attempt in range(6):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            d = http(url, urllib.parse.urlencode({"data": q}).encode(), timeout=700)
            if d.get("elements"): return d["elements"]
        except Exception as e:
            print("overpass", url, e, file=sys.stderr)
        time.sleep(20 * (attempt + 1))
    raise SystemExit("Overpass unavailable")

schools = json.load(open("data/schools-on.json"))["schools"]
try: coords = json.load(open("data/school-coords.json"))
except FileNotFoundError: coords = {}

# 1. OSM matching
osm = []
for el in overpass_schools():
    t = el.get("tags", {})
    c = (el["lat"], el["lon"]) if el["type"] == "node" else (el.get("center", {}).get("lat"), el.get("center", {}).get("lon"))
    if not c[0]: continue
    names = {norm(t.get(k)) for k in ("name", "official_name", "alt_name", "name:en", "name:fr") if t.get(k)}
    osm.append({"names": names, "city": cityk(t.get("addr:city")), "pc": pc(t.get("addr:postcode")), "lat": c[0], "lon": c[1]})
by_name = {}
for o in osm:
    for n in o["names"]:
        if n: by_name.setdefault(n, []).append(o)
print(f"OSM schools in Ontario: {len(osm)}")

matched = 0
for s in schools:
    if s["id"] in coords and coords[s["id"]][2] in ("osm", "nominatim"): continue
    cands = by_name.get(norm(s["n"]), [])
    hit = None
    if len(cands) == 1 and sum(1 for x in schools if norm(x["n"]) == norm(s["n"])) == 1:
        hit = cands[0]   # unique name in both datasets
    else:
        hit = next((o for o in cands if o["pc"] and o["pc"] == pc(s["pc"])), None) or \
              next((o for o in cands if o["city"] and o["city"] == cityk(s["c"])), None)
    if hit:
        coords[s["id"]] = [round(hit["lat"], 6), round(hit["lon"], 6), "osm"]; matched += 1
print(f"matched via OSM this run: {matched}")
json.dump(coords, open("data/school-coords.json", "w"), separators=(",", ":"))

# 2. Nominatim for the rest
todo = [s for s in schools if s["id"] not in coords][:MAX_GEOCODE]
print(f"geocoding {len(todo)} schools with Nominatim")
for i, s in enumerate(todo):
    street = re.sub(r"^(\d+)[A-Z]?\b", r"\1", s["st"])
    for params in ({"street": street, "city": s["c"], "postalcode": s["pc"], "state": "Ontario", "country": "Canada"},
                   {"street": street, "city": s["c"], "state": "Ontario", "country": "Canada"},
                   {"postalcode": s["pc"], "country": "Canada"}):
        time.sleep(1.1)
        try:
            r = http("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({**params, "format": "jsonv2", "limit": 1}), timeout=60)
        except Exception as e:
            print("nominatim", s["id"], e, file=sys.stderr); continue
        if r:
            coords[s["id"]] = [round(float(r[0]["lat"]), 6), round(float(r[0]["lon"]), 6), "nominatim" if "street" in params else "postal"]
            break
    if i % 100 == 0:
        print(f"  {i}/{len(todo)}"); json.dump(coords, open("data/school-coords.json", "w"), separators=(",", ":"))

json.dump(coords, open("data/school-coords.json", "w"), separators=(",", ":"))
have = sum(1 for s in schools if s["id"] in coords)
print(f"coordinates for {have}/{len(schools)} schools")
