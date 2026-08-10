#!/usr/bin/env python3
"""
Pulls the POI records covering the ward out of Overture Maps into
data/overture-places.json, which scripts/import-businesses.ts then matches
against parcels.

    pip install duckdb
    python3 scripts/fetch-places.py            # current release, ward bbox
    python3 scripts/fetch-places.py --release 2026-07-22.0

Why Overture and not OpenStreetMap: OSM knows six businesses in this bbox and
Utah's statewide address points know two. Overture carries the Meta and
Microsoft POI sets and knows about 140, which is most of the industrial park.
Licence is CC BY 4.0 — the map credits it in the parcel panel.

Why a checked-in extract rather than a live query: this reads a few hundred MB
of remote parquet and takes a couple of minutes, to produce ~30 KB that changes
about as often as the businesses themselves do. Re-run it when the ward looks
stale, not on every import.
"""

import argparse
import json
import os
import re
import sys
import urllib.request

# The ward plus roughly a quarter mile of slack, so a POI whose coordinate sits
# just outside a boundary parcel still gets a chance to match by address.
BBOX = {"west": -113.4960, "south": 37.1040, "east": -113.4720, "north": 37.1210}

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "overture-places.json")
BUCKET = "overturemaps-us-west-2"


def latest_release() -> str:
    url = f"https://{BUCKET}.s3.us-west-2.amazonaws.com/?list-type=2&delimiter=/&prefix=release/"
    with urllib.request.urlopen(url, timeout=60) as r:
        body = r.read().decode()
    releases = [p for p in re.findall(r"<Prefix>release/([^<]*)</Prefix>", body) if p.strip("/")]
    if not releases:
        sys.exit("Could not list Overture releases.")
    return releases[-1].strip("/")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", help="Overture release, e.g. 2026-07-22.0. Default: newest.")
    args = ap.parse_args()

    try:
        import duckdb
    except ImportError:
        sys.exit("duckdb is not installed. Run: pip install duckdb")

    release = args.release or latest_release()
    print(f"Overture release {release}")

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    rows = con.execute(
        f"""
        SELECT id,
               names.primary                AS name,
               categories.primary           AS category,
               addresses[1].freeform        AS address,
               confidence,
               ROUND(bbox.xmin::DOUBLE, 7)  AS lng,
               ROUND(bbox.ymin::DOUBLE, 7)  AS lat
        FROM read_parquet('s3://{BUCKET}/release/{release}/theme=places/type=place/*')
        WHERE bbox.xmin BETWEEN {BBOX['west']} AND {BBOX['east']}
          AND bbox.ymin BETWEEN {BBOX['south']} AND {BBOX['north']}
          AND names.primary IS NOT NULL
        ORDER BY names.primary
        """
    ).fetchall()

    places = [
        {
            "id": r[0],
            "name": r[1],
            "category": r[2],
            "address": r[3],
            "confidence": r[4],
            "lng": r[5],
            "lat": r[6],
        }
        for r in rows
    ]

    with open(OUT, "w") as f:
        json.dump({"release": release, "bbox": BBOX, "places": places}, f, indent=1)
        f.write("\n")

    print(f"Wrote {len(places)} places to data/overture-places.json")


if __name__ == "__main__":
    main()
