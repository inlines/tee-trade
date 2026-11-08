"""Local API integration: ordering, cache invalidation, pagination and access control."""
import http.cookiejar, json, uuid
from pathlib import Path
from urllib.request import Request, build_opener, HTTPCookieProcessor
from urllib.error import HTTPError
from urllib.parse import urlencode
BASE='http://localhost:4200'
env=dict(line.split('=',1) for line in Path('.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
client=build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
anon=build_opener();csrf='';created=[];original=None

def req(path,method='GET',body=None,expected=200,guest=False,token=True):
    headers={'Content-Type':'application/json'}
    if token and csrf:headers['X-CSRF-Token']=csrf
    try:r=(anon if guest else client).open(Request(BASE+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method),timeout=15)
    except HTTPError as e:r=e
    with r:
        data=r.read();assert r.status==expected,(path,r.status,data[:200])
        return json.loads(data) if data and 'application/json' in r.headers.get('Content-Type','') else None

def all_ids():return [p['id'] for p in req('/api/products',guest=True) if not p['sold']]
def order(before,after,**kwargs):return req('/api/admin/products/order','PUT',{'original_ids':before,'ids':after},expected=kwargs.pop('expected',204),**kwargs)
def page(sort='default',offset=0):return req(f'/api/products/page?limit=4&offset={offset}&sort={sort}',guest=True)['items']
try:
    csrf=req('/api/admin/login','POST',{'username':env.get('ADMIN_USERNAME','arzamas'),'password':env['ADMIN_PASSWORD']})['csrf_token']
    marker='order-'+uuid.uuid4().hex
    for i in range(8):
        p=req('/api/admin/products','POST',{'name':marker+str(i),'category':'t-shirts','brands':[marker],'sizes':['L'],'description':'','theme':'','images':[],'price_cents':(8-i)*100,'is_demo':True,'sold':False},201)
        created.append(p['id'])
    original=all_ids();assert original[-8:]==created
    prefix=original[:-4];changed=prefix[:-4]+list(reversed(prefix[-4:]))
    price_before=[p['id'] for p in page('price-asc')]
    page();order(prefix,changed,guest=True,expected=401);order(prefix,changed,token=False,expected=403)
    order(prefix,[prefix[0]]*len(prefix),expected=400)
    order(prefix,changed)
    expected=changed+original[-4:];assert all_ids()==expected
    assert [p['id'] for p in page()]==expected[:4]
    assert [p['id'] for p in page(offset=4)]==expected[4:8]
    assert [p['id'] for p in page('price-asc')]==price_before
    admin=req('/api/admin/products/page?limit=4&offset=0')['items'];assert [p['id'] for p in admin]==expected[:4]
    order(prefix,changed,expected=409)
    filtered=req('/api/products/page?'+urlencode({'limit':8,'offset':0,'category':'t-shirts','brands':json.dumps([marker])}),guest=True)['items']
    assert [p['id'] for p in filtered]==[id for id in expected if id in created]
    p=req('/api/admin/products','POST',{'name':marker+'new','category':'','brands':[],'sizes':[],'description':'','theme':'','images':[],'price_cents':None,'is_demo':True,'sold':False},201);created.append(p['id'])
    assert all_ids()==expected+[p['id']]
    order(all_ids(),original+[p['id']]);original=None
    print('PASS: initial order, partial-page reorder, unchanged tail, admin/public equality, cache invalidation, price sorting, append, authorization, CSRF, malformed order, concurrent conflict')
finally:
    if original is not None:
        current=all_ids();order(current,original+[i for i in current if i not in original])
    for id in created:req('/api/admin/products/'+str(id),'DELETE',expected=204)
