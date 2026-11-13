"""Local search integration test; removes only its own fixtures."""
from pathlib import Path
exec(Path('scripts/catalog_order_test.py').read_text().split('\ntry:\n')[0])
from urllib.parse import urlencode
try:
    csrf=req('/api/admin/login','POST',{'username':env.get('ADMIN_USERNAME','arzamas'),'password':env['ADMIN_PASSWORD']})['csrf_token']
    tag='search-'+uuid.uuid4().hex
    for i in range(6):
        p=req('/api/admin/products','POST',{'name':tag+' '+str(i),'category':'hoodies','brands':[tag+' Бренд'],'sizes':['XL'],'description':tag+' Описание 100%','theme':'','images':[],'price_cents':100+i,'is_demo':True,'sold':False},201)
        created.append(p['id'])
    def search(term,**extra):
        return req('/api/products/page?'+urlencode(dict(limit=4,offset=0,search=term,**extra)),guest=True)
    for term in [tag.upper(),tag+' бренд',tag+' описание 100%']:
        data=search(term);assert data['total']==6 and len(data['items'])==4
        assert data['sizes']==['XL'] and data['brands']==[tag+' Бренд']
        assert search(term)==data
    assert search(tag+' absent')['total']==0
    assert search(tag,category='sneakers')['total']==0
    assert search(tag,sizes=json.dumps(['S']))['total']==0
    assert search(tag,brands=json.dumps([tag+' Бренд']))['total']==6
    tail=req('/api/products/page?'+urlencode(dict(limit=4,offset=4,search=tag)),guest=True)
    assert [p['id'] for p in tail['items']]==created[4:]
    assert search(tag+"' OR 1=1 --")['total']==0
    req('/api/products/page?'+urlencode(dict(limit=4,search='a'*161)),expected=400,guest=True)
    print('PASS: name/brand/description, case-insensitivity, literal percent, facets, combined filters, pagination, cache isolation and input validation')
finally:
    for id in created:req('/api/admin/products/'+str(id),'DELETE',expected=204)
