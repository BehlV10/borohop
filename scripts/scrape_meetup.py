#!/usr/bin/env python3
"""
scripts/scrape_meetup.py
Automated Meetup scraper for Borough Hoppers (https://www.meetup.com/borough-hoppers/).

Extracts active events directly from Meetup's server-rendered __NEXT_DATA__
Apollo cache without requiring headless browsers or API keys.
Merges new and updated events into data/events.json.
"""

import sys
import re
import json
import urllib.request
from datetime import datetime
from typing import Dict, Any, List, Optional

MEETUP_URL = "https://www.meetup.com/borough-hoppers/events/"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
EVENTS_JSON_PATH = "data/events.json"

CATEGORY_RULES = [
    ("Board Games", [r"board game", r"catan", r"scrabble", r"chess", r"trivia", r"🎲"]),
    ("Sports", [r"soccer", r"clasico", r"football", r"epl", r"baseball", r"tennis", r"marathon", r"volleyball", r"basketball", r"runners?", r"watch party", r"⚽", r"🏃"]),
    ("Concerts", [r"concert", r"juilliard", r"symphony", r"orchestra", r"jazz", r"live music", r"acoustic", r"choir", r"🎸", r"🎷", r"🥁", r"🎹"]),
    ("Theatre", [r"rockettes", r"theatre", r"theater", r"broadway", r"musical", r"play\b", r"drama", r"comedy", r"standup", r"🎭"]),
    ("Dance", [r"salsa", r"bachata", r"tango", r"swing dance", r"dance class", r"ballet", r"💃"]),
    ("EDM", [r"\bedm\b", r"techno", r"house music", r"rave", r"dj set", r"dance party", r"🎧"]),
    ("Film", [r"movie", r"film", r"screening", r"cinema", r"documentary", r"🎬"]),
    ("Museums", [r"museum", r"gallery", r"exhibition", r"art show", r"moma", r"met museum", r"whitney", r"guggenheim", r"🏛️"]),
    ("Nature", [r"governors island", r"rockefeller", r"botanical", r"park\b", r"garden\b", r"hike", r"trail", r"foliage", r"beach", r"preserve", r"walk\b", r"⛴️", r"🥾", r"🍂", r"🌳"]),
    ("Food", [r"tapas", r"feast", r"dinner", r"lunch", r"brunch", r"coffee", r"tea & sympathy", r"tea\b", r"food", r"bakery", r"restaurant", r"eat\b", r"burger", r"pizza", r"sushi", r"drinks", r"bar\b", r"tasting", r"brewery", r"nar", r"vatan", r"boqueria", r"dar lbahja", r"arabica", r"devoción", r"variety", r"🍔", r"☕", r"🫖", r"😋", r"🇪🇸", r"🇹🇷", r"🇮🇳", r"🇬🇧"]),
    ("Culture", [r"diwali", r"halloween", r"parade", r"literature", r"festival", r"heritage", r"celebration", r"mixer", r"tour\b", r"craft", r"🎨", r"📚", r"🎃", r"🪔", r"🌸"]),
]

BOROUGH_NAMES = {
    "manhattan": "Manhattan",
    "brooklyn": "Brooklyn",
    "queens": "Queens",
    "bronx": "Bronx",
    "staten island": "Staten Island"
}

KNOWN_VENUES = {
    "The Hugh": {"borough": "Manhattan", "neighborhood": "Midtown East", "lines": ["6", "E", "M"], "station": "Lexington Av/51-53 St", "lat": 40.7578, "lng": -73.9712},
    "Smithfield Hall": {"borough": "Manhattan", "neighborhood": "Chelsea", "lines": ["1", "2"], "station": "28 St", "lat": 40.7468, "lng": -73.9930},
    "Governors Island Ferry": {"borough": "Manhattan", "neighborhood": "Financial District", "lines": ["1", "R", "W"], "station": "South Ferry", "lat": 40.7018, "lng": -74.0135, "ferry": "Ferry to Governors Island"},
    "Boqueria Flatiron": {"borough": "Manhattan", "neighborhood": "Flatiron", "lines": ["F", "M", "PATH"], "station": "19 St / 23 St", "lat": 40.7402, "lng": -73.9926},
    "The Juilliard School": {"borough": "Manhattan", "neighborhood": "Upper West Side", "lines": ["1"], "station": "66 St–Lincoln Center", "lat": 40.7738, "lng": -73.9829},
    "Ukrainian Institute of America": {"borough": "Manhattan", "neighborhood": "Upper East Side", "lines": ["4", "5", "6"], "station": "77 St", "lat": 40.7766, "lng": -73.9632},
    "Rockefeller State Park Preserve Visitor Center": {"region": "nearby", "town": "Pleasantville, NY", "lat": 41.1118, "lng": -73.8322, "transitText": "Metro-North Hudson Line to Tarrytown or Philipse Manor"},
    "Jack Doyle's": {"borough": "Manhattan", "neighborhood": "Midtown", "lines": ["B", "D", "F", "M", "N", "Q", "R", "W"], "station": "34 St–Herald Sq", "lat": 40.7513, "lng": -73.9892},
    "Tea & Sympathy": {"borough": "Manhattan", "neighborhood": "West Village", "lines": ["1", "2", "3", "A", "C", "E"], "station": "14 St", "lat": 40.7368, "lng": -74.0028},
    "Radio City Music Hall": {"borough": "Manhattan", "neighborhood": "Midtown", "lines": ["B", "D", "F", "M"], "station": "47-50 Sts–Rockefeller Ctr", "lat": 40.7600, "lng": -73.9799},
    "Czech Center New York": {"borough": "Manhattan", "neighborhood": "Upper East Side", "lines": ["6", "Q"], "station": "72 St", "lat": 40.7702, "lng": -73.9575},
    "NAR | Modern Turkish & Mediterranean": {"borough": "Manhattan", "neighborhood": "Flatiron", "lines": ["4", "6", "N", "R"], "station": "23 St", "lat": 40.7410, "lng": -73.9856},
    "Bhakti Center": {"borough": "Manhattan", "neighborhood": "East Village", "lines": ["F"], "station": "2 Av", "lat": 40.7233, "lng": -73.9877},
    "Vatan": {"borough": "Manhattan", "neighborhood": "Kips Bay", "lines": ["6"], "station": "28 St", "lat": 40.7423, "lng": -73.9806},
    "NYBG Ticket Counter": {"borough": "Bronx", "neighborhood": "Belmont / Fordham", "transitText": "Metro-North to Botanical Garden or B/D/4 to Bedford Park Blvd", "lat": 40.8624, "lng": -73.8797},
}

def infer_categories(title: str, description: str) -> List[str]:
    combined = (title + " " + description).lower()
    matched = []
    for cat, patterns in CATEGORY_RULES:
        for p in patterns:
            if re.search(p, combined, re.IGNORECASE):
                matched.append(cat)
                break
    if not matched:
        matched.append("Culture")
    # Return at most 2 primary categories
    return matched[:2]

def fetch_meetup_events() -> List[Dict[str, Any]]:
    req = urllib.request.Request(MEETUP_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req) as resp:
        html = resp.read().decode("utf-8")

    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
    if not match:
        raise ValueError("Could not find __NEXT_DATA__ in Meetup response.")

    page_data = json.loads(match.group(1))
    cache = page_data.get("props", {}).get("pageProps", {}).get("__APOLLO_STATE__", {})

    events = []
    for key, item in cache.items():
        if key.startswith("Event:") and item.get("status") == "ACTIVE":
            events.append(item)

    print(f"Discovered {len(events)} active events from Meetup Apollo cache.")
    parsed_events = []

    for ev in events:
        title = ev.get("title", "")
        event_url = ev.get("eventUrl", "")
        if not event_url and ev.get("id"):
            event_url = f"https://www.meetup.com/borough-hoppers/events/{ev.get('id')}/"
        description = ev.get("description", "") or ""

        # Dates & times (e.g. 2026-11-08T18:45:00-05:00)
        dt_str = ev.get("dateTime", "")
        end_dt_str = ev.get("endTime", "")
        start_date = dt_str[:10] if dt_str else ""
        start_time = dt_str[11:16] if dt_str and len(dt_str) >= 16 else "19:00"
        end_date = end_dt_str[:10] if end_dt_str else start_date
        end_time = end_dt_str[11:16] if end_dt_str and len(end_dt_str) >= 16 else "21:00"

        # Venue
        venue_ref = ev.get("venue", {}).get("__ref") if isinstance(ev.get("venue"), dict) else None
        venue_data = cache.get(venue_ref, {}) if venue_ref else {}
        venue_name = venue_data.get("name", "")
        venue_addr = venue_data.get("address", "") or venue_name

        # Photo
        photo_ref = None
        for pfield in ("featuredEventPhoto", "displayPhoto"):
            pobj = ev.get(pfield)
            if isinstance(pobj, dict) and pobj.get("__ref"):
                photo_ref = pobj["__ref"]
                break
        photo_data = cache.get(photo_ref, {}) if photo_ref else {}
        photo_url = photo_data.get("highResUrl") or photo_data.get("baseUrl") or ""

        # RSVPs and spots
        going_count = ev.get("going", {}).get("totalCount", 0) if isinstance(ev.get("going"), dict) else 0
        max_tickets = ev.get("maxTickets", 0) or 0
        spots_left = (max_tickets - going_count) if max_tickets > 0 else None

        # Categorize
        types = infer_categories(title, description)

        # Borough / location heuristics
        addr_lower = (venue_addr + " " + venue_name + " " + description).lower()
        borough = "Manhattan"
        region = "nyc"
        town = None
        neighborhood = "NYC"

        # Check known venue presets first
        known = KNOWN_VENUES.get(venue_name)
        if not known:
            for kv_name, kv_data in KNOWN_VENUES.items():
                if kv_name.lower() in venue_name.lower() or kv_name.lower() in venue_addr.lower():
                    known = kv_data
                    break

        transit_lines = []
        transit_station = None
        transit_text = None
        ferry_note = None
        lat = 40.7580
        lng = -73.9855

        if known:
            if "region" in known:
                region = known["region"]
            if "town" in known:
                town = known["town"]
            if "borough" in known:
                borough = known["borough"]
            if "neighborhood" in known:
                neighborhood = known["neighborhood"]
            if "lines" in known:
                transit_lines = known["lines"]
            if "station" in known:
                transit_station = known["station"]
            if "transitText" in known:
                transit_text = known["transitText"]
            if "ferry" in known:
                ferry_note = known["ferry"]
            if "lat" in known:
                lat = known["lat"]
            if "lng" in known:
                lng = known["lng"]
        else:
            for b_key, b_val in BOROUGH_NAMES.items():
                if b_key in addr_lower:
                    borough = b_val
                    break
            neighborhood = borough

        # Price heuristics from description
        price = 0
        price_detail = []
        price_match = re.search(r'\$(\d+)(?:\s*(?:to|-)\s*\$?(\d+))?', description)
        if price_match:
            p1 = int(price_match.group(1))
            p2 = int(price_match.group(2)) if price_match.group(2) else None
            price = p1
            if p2:
                price_detail.append(f"${p1} to ${p2}")
            else:
                price_detail.append(f"${p1}")

        # Summary note (things to know)
        things_to_know = ""
        lines = [l.strip() for l in description.split("\n") if l.strip()]
        for l in lines:
            if any(term in l.lower() for term in ("price", "$", "deposit", "rule", "fee", "cost", "note", "venmo", "zelle")):
                things_to_know = l.replace("\\", "")[:240]
                break

        event_obj = {
            "name": title,
            "types": types,
            "region": region,
            "borough": borough,
            "neighborhood": neighborhood,
            "transitLines": transit_lines,
            "transitStation": transit_station,
            "start": start_date,
            "end": end_date if end_date != start_date else None,
            "startTime": start_time,
            "endTime": end_time,
            "price": price,
            "address": venue_addr,
            "lat": lat,
            "lng": lng,
            "locationName": venue_name,
            "rsvpUrl": event_url,
            "rsvpCount": going_count,
            "spotsLeft": spots_left,
            "spotsLeftChecked": True,
            "customImage": photo_url,
            "thingsToKnow": things_to_know
        }
        if price_detail:
            event_obj["priceDetail"] = price_detail
        if transit_text:
            event_obj["transitText"] = transit_text
        if ferry_note:
            event_obj["ferryNote"] = ferry_note
        if town:
            event_obj["town"] = town

        parsed_events.append(event_obj)

    return parsed_events

def sync_events():
    try:
        with open(EVENTS_JSON_PATH, "r", encoding="utf-8") as f:
            existing = json.load(f)
    except Exception as e:
        print(f"Warning: Could not open {EVENTS_JSON_PATH}: {e}")
        existing = []

    print(f"Existing events in database: {len(existing)}")
    meetup_events = fetch_meetup_events()

    # Index existing events by rsvpUrl
    existing_by_url = {ev.get("rsvpUrl"): ev for ev in existing if ev.get("rsvpUrl")}

    updated_count = 0
    added_count = 0

    for m_ev in meetup_events:
        url = m_ev.get("rsvpUrl")
        if url in existing_by_url:
            cur = existing_by_url[url]
            # Update live stats and details
            cur["rsvpCount"] = m_ev.get("rsvpCount", cur.get("rsvpCount"))
            cur["spotsLeft"] = m_ev.get("spotsLeft", cur.get("spotsLeft"))
            cur["spotsLeftChecked"] = True
            cur["start"] = m_ev.get("start", cur.get("start"))
            cur["startTime"] = m_ev.get("startTime", cur.get("startTime"))
            cur["endTime"] = m_ev.get("endTime", cur.get("endTime"))
            if not cur.get("customImage") and m_ev.get("customImage"):
                cur["customImage"] = m_ev.get("customImage")
            updated_count += 1
        else:
            m_ev["id"] = len(existing)
            existing.append(m_ev)
            existing_by_url[url] = m_ev
            added_count += 1

    # Re-index all IDs sequentially
    for idx, ev in enumerate(existing):
        ev["id"] = idx

    with open(EVENTS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2)

    print(f"Sync complete: {added_count} new events added, {updated_count} events updated. Total events: {len(existing)}")

if __name__ == "__main__":
    sync_events()
