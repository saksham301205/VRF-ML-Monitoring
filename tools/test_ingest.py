import urllib.request
import urllib.error
import json

INGEST_URL = "http://localhost:5000/api/protocol/ingest"
FRAMES = [
    "*PC0C0101E0180A0#",
    "*DR000E02XXX0A0675#",
]

def post_json(url, data):
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'),
                                 headers={"Content-Type": "application/json"}, method='POST')
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.read().decode('utf-8'), resp.getcode()

def get_json(url):
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.load(resp), resp.getcode()

for raw in FRAMES:
    payload = {"raw": raw, "source": "manual", "frame_name": None}
    try:
        body, status = post_json(INGEST_URL, payload)
        print("POST", raw, "->", status)
        try:
            print(json.dumps(json.loads(body), indent=2))
        except Exception:
            print(body)
    except Exception as e:
        print("ERROR posting", raw, e)

# fetch recent frames and readings
try:
    frames, _ = get_json("http://localhost:5000/api/db/protocol_frames?limit=5&source=real")
    readings, _ = get_json("http://localhost:5000/api/db/readings?limit=5&source=real")
    print("\nRecent protocol_frames:")
    print(json.dumps(frames, indent=2))
    print("\nRecent parsed_readings:")
    print(json.dumps(readings, indent=2))
except Exception as e:
    print("ERROR fetching db rows", e)
