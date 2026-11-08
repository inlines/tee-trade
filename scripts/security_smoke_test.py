"""Local-only negative probes. No credentials, real records, or remote targets."""
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode
base='http://localhost:4200'
def get(path, method='GET', data=None, headers=None):
    req=Request(base+path,method=method,data=data,headers=headers or {})
    try:
        with urlopen(req,timeout=5) as r:return r.status,r.headers,r.read()
    except HTTPError as e:return e.code,e.headers,e.read()
for path in ['/api/admin/products','/api/admin/products/1','/api/admin/products/sizes','/api/admin/storefront','/api/auth/chats','/api/auth/requests']:
    assert get(path)[0]==401,path
assert get('/api/admin/products','POST',b'{}',{'Content-Type':'application/json'})[0]==401
assert get('/api/auth/register','POST',b'{}',{'Content-Type':'application/json','Origin':'https://attacker.invalid'})[0] in [400,403,422]
assert get('/api/auth/login','POST',json.dumps({'username':'test','password':'x'}).encode(),{'Content-Type':'application/json','Origin':'https://attacker.invalid'})[0]==403
assert get('/metrics')[0]==404
for path in ['/','/catalog','/images/futba-logo.svg']:
    status,headers,body=get(path);assert status==200
    assert headers.get('X-Frame-Options')=='DENY',path
    assert headers.get('X-Content-Type-Options')=='nosniff',path
    assert "frame-ancestors 'none'" in headers.get('Content-Security-Policy',''),path
assert get('/api/products/page?limit=1000000')[0]==400
assert get('/api/products/page?'+urlencode({'limit':4,'sort':'id; DROP TABLE products'}))[0]==400
code,_,body=get('/api/products/page?'+urlencode({'limit':4,'brands':json.dumps(["' OR TRUE --"])}))
assert code==200 and json.loads(body)['total']==0
assert get('/api/products/page?'+urlencode({'limit':4,'sizes':json.dumps(['x'*101])}))[0]==400
assert get('/api/media/'+'a'*64)[0]==404
print('PASS: protected endpoints, anonymous mutations, foreign Origin, hidden metrics, security headers, SQL-injection probes, pagination/filter bounds, missing media')
