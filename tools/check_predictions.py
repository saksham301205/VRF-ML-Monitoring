import urllib.request, json

def get(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.load(r)

preds = get('http://localhost:5000/api/db/predictions?limit=5&source=real')
print('predictions_count_sample=', len(preds))
for p in preds:
    print(p.get('id'), p.get('timestamp'), p.get('anomaly_detected'), p.get('fault_predicted'), p.get('source'))
    print('  current_power_kw=', p.get('current_power_kw'), 'optimized=', p.get('optimized_power_kw'), 'ready? ', p.get('created_at'))
