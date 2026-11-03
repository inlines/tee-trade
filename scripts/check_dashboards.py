"""Validate every provisioned PromQL expression against the running local Prometheus."""
import concurrent.futures,json,subprocess,urllib.parse
from pathlib import Path
root=Path(__file__).resolve().parents[1]
env=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
queries=[]
for path in (root/'infra/grafana/dashboards').glob('*.json'):
 d=json.loads(path.read_text())
 assert len({p['id'] for p in d['panels']})==len(d['panels'])
 for panel in d['panels']:
  for target in panel.get('targets',[]):
   expr=target['expr']
   for key,value in [('$__rate_interval','1m'),('$__range','1h'),('$route','.*'),('$database',env.get('POSTGRES_DB','tee_trade')),('$window','7d')]:expr=expr.replace(key,value)
   queries.append((d['title'],panel['title'],expr))
def check(item):
 title,panel,expr=item
 url='http://prometheus:9090/api/v1/query?'+urllib.parse.urlencode({'query':expr})
 result=subprocess.check_output(['docker','compose','exec','-T','grafana','wget','-qO-',url],cwd=root,text=True)
 data=json.loads(result)
 assert data['status']=='success',(title,panel,data)
 return len(data['data']['result'])>0
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 results=list(pool.map(check,queries))
print(f'PASS: {len(queries)} dashboard expressions parsed and executed; {sum(results)} currently have data')
