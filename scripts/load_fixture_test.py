"""Temporary local catalog fixture + CPU-limited benchmark, cleaned up in finally."""
import os,json,uuid,subprocess
from pathlib import Path
prefix='load-'+uuid.uuid4().hex
def sql(text):
 return subprocess.check_output(['docker','compose','exec','-T','postgres','sh','-c','psql -XqAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],input=text,text=True).strip()
container=subprocess.check_output(['docker','compose','ps','-q','backend'],text=True).strip()
old=json.loads(subprocess.check_output(['docker','inspect',container],text=True))[0]['HostConfig']['NanoCpus']/1e9
try:
 sql(f"""BEGIN;
 INSERT INTO products(name,price_cents,category,brands,sizes,description,theme,images,is_demo,sold)
 SELECT '{prefix}-'||i,10000+i,(ARRAY['sneakers','t-shirts','hoodies','longsleeves','accessories','headwear','sweatshirts'])[1+i%7],
 ARRAY['Fixture brand '||(i%20)],ARRAY['EU '||(35+i%12),'US '||(5+i%8)],repeat('Synthetic load-test description. ',40),'Test',
 COALESCE((SELECT images FROM products ORDER BY id LIMIT 1),'[]'::jsonb),false,i%10=0
 FROM generate_series(1,1000) i;
 UPDATE catalog_revision SET version=version+1;
 ANALYZE products;
 COMMIT;""")
 print('Created 1000 disposable catalog rows',flush=True)
 plan=sql("""EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM products WHERE NOT sold AND catalog_terms(brands) && ARRAY['fixture brand 1'] AND catalog_terms(sizes) && ARRAY['eu 36'] ORDER BY id LIMIT 8;""")
 Path('/tmp/futba-query-plan.json').write_text(plan)
 subprocess.run(['docker','update','--cpus=1',container],check=True,stdout=subprocess.DEVNULL)
 env={**os.environ,'USERS':'10,50,100,200','THINK_MS':'1000','DURATION':'15','REPORT':'/tmp/futba-load-fixtures.json'}
 subprocess.run(['node','scripts/load_test.mjs'],env=env,check=True)
finally:
 try:
  sql(f"BEGIN; DELETE FROM products WHERE name LIKE '{prefix}-%'; UPDATE catalog_revision SET version=version+1; COMMIT;")
 finally:
  if old == 0:
   # Docker update may omit zero NanoCpus; recreation restores Compose defaults.
   subprocess.run(['docker','compose','up','-d','--no-deps','--force-recreate','--wait','backend'],check=True,stdout=subprocess.DEVNULL)
  else:
   subprocess.run(['docker','update','--cpus='+str(old),container],check=True,stdout=subprocess.DEVNULL)
 print('Removed only generated fixtures; restored backend CPU limit',flush=True)
