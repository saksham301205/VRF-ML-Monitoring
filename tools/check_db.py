import urllib.request, json

def get(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.load(r)

frames = get('http://localhost:5000/api/db/protocol_frames?limit=3&source=real')
readings = get('http://localhost:5000/api/db/readings?limit=3&source=real')
print('protocol_frames_count_sample=', len(frames))
for f in frames:
    print('FRAME id=', f.get('id'), 'parsed_ok=', f.get('parsed_ok'), 'present_field_count=', f.get('present_field_count'))

print('\nparsed_readings_count_sample=', len(readings))
for r in readings:
    print('READING id=', r.get('id'), 'timestamp=', r.get('timestamp'), 'source=', r.get('source'))
    keys = [k for k in r.keys() if k not in ('id','timestamp','source','created_at')]
    print('  fields:', keys[:10])
