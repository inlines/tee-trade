"""Local Redis outage/recovery probe; always restarts Redis."""
import json,subprocess,time
from urllib.request import urlopen
base='http://localhost:8080'
def get(path):
 with urlopen(base+path,timeout=4) as r:return r.read()
def hits():
 text=get('/metrics').decode()
 return float(next(l.split()[-1] for l in text.splitlines() if l.startswith('tee_catalog_cache_total{result="hit"} ')))
expected=get('/api/products/page?limit=8')
try:
 subprocess.run(['docker','compose','stop','redis'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 start=time.monotonic()
 actual=get('/api/products/page?limit=8')
 latency=time.monotonic()-start
 assert json.loads(actual)==json.loads(expected)
 assert latency<3
finally:
 subprocess.run(['docker','compose','start','redis'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
start=time.monotonic()
while time.monotonic()-start<40:
 before=hits()
 get('/api/products/page?limit=8');get('/api/products/page?limit=8')
 if hits()>before:break
 time.sleep(1)
else:raise AssertionError('Cache did not reconnect')
result={'fallback_seconds':latency,'recovery_seconds':time.monotonic()-start,'result':'PASS'}
open('/tmp/futba-redis-recovery.json','w').write(json.dumps(result,indent=2))
print('PASS: Redis outage falls back to DB with identical response; cache reconnects automatically',result)
