import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import insert_ml_prediction
from datetime import datetime

insert_ml_prediction(datetime.now().isoformat(), {"anomaly": True, "score": 0.5, "severity": 0.2}, {"fault": "none", "confidence": 0.0}, {"current_power_kw": 1.2, "optimized_power_kw": 1.0, "savings_pct": 16.7, "recommended_params": {}}, source="manual")
print('done')
