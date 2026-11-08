"""Check ranking against temporary tables without changing shop data."""
import json
import subprocess
from pathlib import Path
root = Path(__file__).resolve().parents[1]
query = (root/'backend/src/business_product_views.sql').read_text().replace('$1', '604800').strip().rstrip(';')
sql = """
BEGIN;
CREATE TEMP TABLE products(id int PRIMARY KEY, name text, is_demo boolean);
CREATE TEMP TABLE product_views(product_id int, customer_id bigint, created_at timestamptz);
INSERT INTO products VALUES (1,'First',false),(2,'Second',false),(3,'Demo',true);
INSERT INTO product_views VALUES
 (1,NULL,now()),(1,10,now()),(1,NULL,now()),(2,NULL,now()),
 (2,10,now()-interval '8 days'),(3,NULL,now()),(999,NULL,now());
"""
def run(body):
    output = subprocess.check_output(['docker','compose','exec','-T','postgres','sh','-c',
        'psql -X -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'],
        input=body+f'\nSELECT json_agg(t) FROM ({query}) t;\nROLLBACK;',text=True,cwd=root)
    return json.loads(output)
assert run(sql) == [{'id':1,'name':'First','views':3},{'id':2,'name':'Second','views':1}]
rows = run(sql+"INSERT INTO products SELECT n,'Product '||n,false FROM generate_series(10,40) n; INSERT INTO product_views SELECT n,NULL,now() FROM generate_series(10,40) n;")
assert len(rows) == 20 and rows[0]['id'] == 1 and rows[-1]['id'] == 27
print('PASS: guest and authenticated views, time window, ranking, deleted/demo exclusion, top-20 bound')
