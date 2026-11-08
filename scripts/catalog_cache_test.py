"""Read-only catalog fixture check; corrupts one Redis key to verify recovery."""
import json
import subprocess
from urllib.request import urlopen

def redis(*args):
    return subprocess.check_output(['docker','compose','exec','-T','redis','redis-cli','--raw',*args],text=True).strip()
def get(path):
    with urlopen('http://localhost:4200'+path,timeout=5) as r:
        return json.load(r)
revision=subprocess.check_output(['docker','compose','exec','-T','postgres','sh','-c','psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version FROM catalog_revision"'],text=True).strip()
products=get('/api/products')
cases=[('/api/products','products:false:all'),('/api/products?sold=true','products:true:all'),('/api/products?category=hoodies','products:false:hoodies'),('/api/storefront','storefront:v2')]
if products: cases.append(('/api/products/'+str(products[0]['id']),'product:'+str(products[0]['id'])))
for path,resource in cases:
    first=get(path);second=get(path)
    assert first==second
    key=f'catalog:v1:{revision}:{resource}'
    assert json.loads(redis('GET',key))==first
    assert 0<int(redis('TTL',key))<=3600
key=f'catalog:v1:{revision}:storefront:v2'
redis('SET',key,'broken-json','EX','60')
try:
    restored=get('/api/storefront')
    assert json.loads(redis('GET',key))==restored
finally:
    if redis('GET',key)=='broken-json':redis('DEL',key)
print('PASS: catalog/category/archive/product/storefront cached, TTL, corrupted JSON recovery')
