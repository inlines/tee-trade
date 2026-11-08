"""Local Compose integration test. Creates its own fixtures and removes them in finally.
Credentials come from environment variables or the ignored local .env, never from source.
Run from the repository root while the local Docker Compose stack is running.
"""
import copy
import http.cookiejar
import json
import os
from pathlib import Path
import struct
import subprocess
import uuid
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor
import zlib
from urllib.parse import urlencode

BASE = os.environ.get('BASE_URL', 'http://localhost:4200').rstrip('/')
config = {}
if Path('.env').exists():
    config = dict(line.split('=', 1) for line in Path('.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
username = os.environ.get('ADMIN_USERNAME', config.get('ADMIN_USERNAME', 'arzamas'))
password = os.environ.get('ADMIN_PASSWORD', config.get('ADMIN_PASSWORD', ''))
assert password, 'Set ADMIN_PASSWORD in your environment or local .env'
jar = http.cookiejar.CookieJar()
client = build_opener(HTTPCookieProcessor(jar))
anonymous = build_opener()
csrf = ''
created_products = []
created_media = []
original_settings = None
fixture_user = 'archive-' + uuid.uuid4().hex

def sql(statement):
    return subprocess.check_output(['docker', 'compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1'], input=statement, text=True).strip()



def request(path, method='GET', body=None, expected=200, auth=True, use_csrf=True, extra_headers=None):
    headers = dict(extra_headers or {})
    if body is not None and not isinstance(body, bytes):
        body = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    if use_csrf and csrf:
        headers['X-CSRF-Token'] = csrf
    req = Request(BASE + path, data=body, method=method, headers=headers)
    try:
        response = (client if auth else anonymous).open(req, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        data = response.read()
        assert response.status == expected, f'{method} {path}: expected {expected}, got {response.status}: {data[:250]!r}'
        if 'application/json' in response.headers.get('Content-Type', ''):
            data = json.loads(data)
        return data, response.headers


def upload(content, expected=201, filename='test.png'):
    boundary = 'test-' + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: image/png\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    result, _ = request('/api/admin/uploads', 'POST', body, expected, extra_headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    if expected == 201:
        created_media.append(result['url'].rsplit('/', 1)[-1])
        return result['url']


def png(width=2, height=2):
    def chunk(kind, content):
        return struct.pack('!I', len(content)) + kind + content + struct.pack('!I', zlib.crc32(kind + content) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\0' + b'\x80\x90\x70' * width) * height)) + chunk(b'IEND', b'')


try:
    for path in ('session', 'products', 'storefront'):
        request('/api/admin/' + path, expected=401, auth=False)
    request('/api/admin/products', 'POST', {}, 401, auth=False)
    request('/api/admin/products/1', 'PUT', {}, 401, auth=False)
    request('/api/admin/products/1', 'DELETE', expected=401, auth=False)
    request('/api/admin/storefront', 'PUT', {}, 401, auth=False)
    request('/api/admin/uploads', 'POST', b'not a file', 401, auth=False)
    request('/api/admin/login', 'POST', {'username': username, 'password': 'incorrect-test-password'}, 401)
    session, headers = request('/api/admin/login', 'POST', {'username': username, 'password': password})
    csrf = session['csrf_token']
    assert session['username'] == username
    assert all(value in headers['Set-Cookie'] for value in ('HttpOnly', 'SameSite=Strict', 'Path=/api/admin'))
    assert headers['Cache-Control'] == 'no-store'
    restored, _ = request('/api/admin/session')
    assert restored == session
    request('/api/admin/products', 'POST', {}, 403, use_csrf=False)
    request('/api/admin/products', 'POST', {}, 403, extra_headers={'Origin': 'https://untrusted.invalid'})
    print('PASS: authentication, protected routes, session and CSRF checks')

    upload(b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 400, 'unsafe.svg')
    upload(b'not an image', 400)
    empty, _ = request('/api/admin/products', 'POST', {}, 201)
    created_products.append(empty['id'])
    assert empty['images'] == [] and empty['name'] == ''
    assert empty['price_cents'] is None and empty['sizes'] == []
    public_empty, _ = request(f"/api/products/{empty['id']}", auth=False)
    assert public_empty == empty
    request(f"/api/admin/products/{empty['id']}", 'PUT', {})
    request(f"/api/admin/products/{empty['id']}", 'DELETE', expected=204)
    print('PASS: create, retrieve and edit an entirely empty product')
    category_product, _ = request('/api/admin/products', 'POST', {'name':fixture_user, 'category':'sweatshirts'}, 201)
    created_products.append(category_product['id'])
    for category, other in [('sweatshirts','longsleeves'),('longsleeves','sweatshirts')]:
        updated, _ = request(f"/api/admin/products/{category_product['id']}", 'PUT', {'name':fixture_user,'category':category})
        assert updated['category']==category
        assert any(p['id']==updated['id'] for p in request('/api/products?category='+category,auth=False)[0])
        assert all(p['id']!=updated['id'] for p in request('/api/products?category='+other,auth=False)[0])
        page=request('/api/products/page?category='+category+'&limit=4',auth=False)[0]
        assert any(p['id']==updated['id'] for p in page['items'])
    request(f"/api/admin/products/{category_product['id']}", 'DELETE', expected=204)
    print('PASS: sweatshirts and longsleeves creation, editing and separate catalog filters')
    paging_ids = []
    for i in range(10):
        item, _ = request('/api/admin/products', 'POST', {'name':f'Paging {i}', 'category':'hoodies', 'brands':[f'{fixture_user} Brand {i%2}'], 'price_cents':(10-i)*100, 'sizes':[str(40+i),f'{fixture_user} size {i%2}']}, 201)
        paging_ids.append(item['id']); created_products.append(item['id'])
    for sort, key in [('default',lambda p:(p['id'],)), ('price-asc',lambda p:(p['price_cents'] is None,p['price_cents'] or 0,p['id'])), ('price-desc',lambda p:(p['price_cents'] is None,-(p['price_cents'] or 0),p['id']))]:
        expected = sorted(request('/api/products?category=hoodies',auth=False)[0],key=key)
        for size in [4,8]:
            loaded=[]
            for offset in range(0,len(expected)+size,size):
                page,_=request(f'/api/products/page?category=hoodies&limit={size}&offset={offset}&sort={sort}',auth=False)
                assert page['total']==len(expected)
                assert page['items']==expected[offset:offset+size]
                loaded.extend(page['items'])
            assert loaded==expected
    for size in [4,8]:
        loaded=[]
        for offset in range(0,12,size):
            page=request('/api/admin/products/page?'+urlencode({'limit':size,'offset':offset,'search':fixture_user}),auth=True)[0]
            assert page['total']==10
            loaded.extend(p['id'] for p in page['items'])
        assert loaded==list(reversed(paging_ids))
    request('/api/admin/products/page?limit=8',expected=401,auth=False)
    request('/api/admin/products/page?limit=100',expected=400)
    assert request(f'/api/admin/products/{paging_ids[0]}')[0]['id']==paging_ids[0]
    assert len(request('/api/admin/products/labels?'+urlencode({'ids':json.dumps(paging_ids)}))[0])==10
    assert f'{fixture_user} Brand 0' in request('/api/admin/products/brands')[0]
    size_a=f'{fixture_user} size 0'; size_b=f'{fixture_user} size 1'
    def sizes_page(values, brands=None, offset=0):
        params={'category':'hoodies','limit':4,'offset':offset,'sizes':json.dumps(values)}
        if brands is not None: params['brands']=json.dumps(brands)
        return request('/api/products/page?'+urlencode(params),auth=False)[0]
    assert size_a in request('/api/admin/products/sizes')[0]
    for values, ids in [([size_a],paging_ids[::2]),([size_b],paging_ids[1::2]),([size_a,size_b],paging_ids)]:
        loaded=[]
        for offset in range(0,len(ids),4):
            page=sizes_page(values,offset=offset)
            assert page['total']==len(ids)
            loaded.extend(p['id'] for p in page['items'])
        assert loaded==ids
    assert sizes_page([size_a])==sizes_page([' '+size_a.upper()+' ',size_a])
    assert sizes_page([size_a],[f'{fixture_user} Brand 1'])['total']==0
    assert sizes_page([size_a])['brands']==[f'{fixture_user} Brand 0']
    assert size_b not in sizes_page([],[f'{fixture_user} Brand 0'])['sizes']
    request('/api/products/page?'+urlencode({'limit':4,'sizes':'not-json'}),expected=400,auth=False)
    request('/api/products/page?'+urlencode({'limit':4,'sizes':json.dumps(['x'*101])}),expected=400,auth=False)
    print('PASS: size multi-selection, normalization, pagination, combined brand facets and cached queries')
    print('PASS: admin 4/8 product pages, server search, detail, labels and brands independent of page')
    facet_base='/api/products/page?category=hoodies&limit=4&'
    all_facets=request(facet_base,auth=False)[0]['brands']
    brand_a=f'{fixture_user} Brand 0'; brand_b=f'{fixture_user} Brand 1'
    for selected,expected_count in [([brand_a],5),([brand_a,brand_b],10),([brand_a.upper()],5),(['unknown-brand'],0)]:
        page=request(facet_base+urlencode({'brands':json.dumps(selected)}),auth=False)[0]
        assert page['total']==expected_count
        assert page['brands']==all_facets, 'Brand selection must not shrink its own facet'
        assert all(any(b.lower() in [v.lower() for v in selected] for b in p['brands']) for p in page['items'])
    other,_=request('/api/admin/products','POST',{'category':'sneakers','brands':[fixture_user+' Other']},201)
    created_products.append(other['id'])
    assert fixture_user+' Other' not in request(facet_base,auth=False)[0]['brands']
    assert brand_a not in request('/api/products/page?category=sneakers&limit=4',auth=False)[0]['brands']
    request(f"/api/admin/products/{other['id']}",'DELETE',expected=204)
    request(facet_base+urlencode({'brands':'not-json'}),expected=400,auth=False)
    print('PASS: multi-brand OR filter, case-insensitivity, facet scope and cache isolation')
    for query in ['limit=3','limit=8&offset=-1','limit=8&sort=invalid','limit=8&category=invalid']:
        request('/api/products/page?'+query,expected=400,auth=False)
    request(f'/api/admin/products/{paging_ids[0]}/archive','POST',{})
    assert paging_ids[0] not in [p['id'] for p in request('/api/products/page?category=hoodies&limit=8',auth=False)[0]['items']]
    assert paging_ids[0] in [p['id'] for p in request('/api/products/page?category=hoodies&sold=true&limit=8&sort=price-asc',auth=False)[0]['items']]
    for pid in paging_ids: request(f'/api/admin/products/{pid}','DELETE',expected=204)
    print('PASS: 4/8 item pages, stable global sorting, limits, archive and page cache invalidation')
    if os.environ.get('TEST_UPLOAD_LIMIT') == '1':
        # Padding exercises the transport limit without allocating a huge decoded bitmap.
        boundary_image = png().ljust(35 * 1024 * 1024, b'\0')
        large_url = upload(boundary_image)
        stored, _ = request(large_url, auth=False)
        assert stored.startswith(b'\xff\xd8') and len(stored) < len(boundary_image)
        upload(boundary_image + b'\0', 413)
        print('PASS: 35 MiB accepted and recompressed; 35 MiB + 1 byte rejected')
    main_url = upload(png(800,600))
    label_url = upload(png())
    for _ in range(4): upload(png(800,600))
    print('PASS: six sequential photo uploads')
    content, headers = request(main_url, auth=False)
    assert content.startswith(b'\xff\xd8') and headers['Content-Type'] == 'image/jpeg'
    assert headers['X-Content-Type-Options'] == 'nosniff'
    def dimensions(jpeg):
        # The encoder emits baseline JPEG (SOF0).
        offset = 2
        while offset < len(jpeg):
            marker = jpeg[offset:offset+2]
            size = struct.unpack('!H', jpeg[offset+2:offset+4])[0]
            if marker == b'\xff\xc0':
                height, width = struct.unpack('!HH', jpeg[offset+5:offset+9])
                return width, height
            offset += size + 2
        raise AssertionError('JPEG dimensions missing')
    preview, preview_headers = request(main_url + '/preview', auth=False)
    assert dimensions(content) == (2400,1800)
    assert dimensions(preview) == (480,360)
    assert len(preview) < len(content) and 'immutable' in preview_headers['Cache-Control']
    media_id = main_url.rsplit('/',1)[-1]
    assert len(media_id)==64 and all(c in '0123456789abcdef' for c in media_id)
    assert sql(f"SELECT content IS NULL AND preview IS NULL FROM media WHERE id='{media_id}'") == 't'
    assert preview_headers.get('X-Media-Storage') == 'filesystem'
    assert request(main_url, auth=False)[0] == content
    request('/api/media/invalid/preview', expected=404, auth=False)
    print('PASS: file-only uploads, static previews, immutable caching, unchanged large image')

    product = {'name': 'Integration test ' + uuid.uuid4().hex, 'category':'t-shirts', 'brands':['Test', 'Collab'], 'sizes':[' XL ', 'xl', 'EU 42'],
               'description':'Temporary integration fixture', 'theme':'Test', 'price_cents':12345, 'is_demo':False,
               'images':[{'url':main_url, 'alt':'Test front', 'kind':'front'}, {'url':label_url, 'alt':'Test gallery', 'kind':'detail', 'carousel':True}]}
    invalid = copy.deepcopy(product); invalid['images'][0]['carousel'] = True
    request('/api/admin/products', 'POST', invalid, 400)
    invalid = copy.deepcopy(product); invalid['images'][1]['kind'] = 'front'
    request('/api/admin/products', 'POST', invalid, 400)
    invalid = copy.deepcopy(product); invalid['images'][0]['url'] = 'https://example.com/arbitrary.jpg'
    request('/api/admin/products', 'POST', invalid, 400)
    single = copy.deepcopy(product); single['images'] = [single['images'][0]]
    single['images'][0]['alt'] = ''
    one_photo, _ = request('/api/admin/products', 'POST', single, 201)
    created_products.append(one_photo['id'])
    saved, _ = request('/api/admin/products', 'POST', product, 201)
    request(f"/api/admin/products/{one_photo['id']}", 'DELETE', expected=204)
    product_id = saved['id']; created_products.append(product_id)
    assert saved['brands'] == ['Test', 'Collab']
    assert saved['sizes'] == ['XL', 'EU 42'] and 'release_year' not in saved
    for brand in ['Test', 'Collab']:
        page=request('/api/products/page?'+urlencode({'limit':8,'brands':json.dumps([brand])}),auth=False)[0]
        assert any(p['id']==product_id for p in page['items'])
    incomplete_url='/api/admin/products/page?'+urlencode({'limit':4,'incomplete':'true','search':product['name']})
    assert request(incomplete_url)[0]['total']==0
    partial={**product,'sizes':[],'brands':[' Test ','test','Collab']}
    normalized=request(f'/api/admin/products/{product_id}','PUT',partial)[0]
    assert normalized['brands']==['Test','Collab']
    assert request(incomplete_url)[0]['total']==1
    assert request(incomplete_url)[0]['items'][0]['id']==product_id
    request('/api/products?category=t-shirts')  # Warm the old cache before editing.
    product['name'] += ' edited'; product['category'] = 'accessories'; product['price_cents'] = 54321
    product['sizes'] = ['42–44', 'oversize']
    updated, _ = request(f'/api/admin/products/{product_id}', 'PUT', product)
    public, _ = request(f'/api/products/{product_id}', auth=False)
    assert updated == public and public['name'] == product['name']
    assert public['sizes'] == product['sizes']
    assert request(incomplete_url)[0]['total']==0
    request('/api/admin/products', 'POST', {**product, 'sizes':['x'*101]}, 400)
    assert public['images'][1]['carousel'] is True and public['images'][0]['carousel'] is False
    archived_draft = {**product, 'category':'hoodies', 'sold':True}
    pid = public['id']
    request(f'/api/admin/products/{pid}', 'PUT', archived_draft)
    assert all(p['id'] != pid for p in request('/api/products', auth=False)[0])
    assert any(p['id'] == pid for p in request('/api/products?sold=true&category=hoodies', auth=False)[0])
    assert request(f'/api/products/{pid}', auth=False)[0]['sold'] is True
    request(f'/api/admin/products/{pid}', 'PUT', {**product, 'sold':False})
    assert all(p['id'] != pid for p in request('/api/products?sold=true', auth=False)[0])
    assert any(p['id'] == pid for p in request('/api/products', auth=False)[0])
    print('PASS: hoodie category, sold archive, catalog cache isolation, restoring availability')

    old_category, _ = request('/api/products?category=t-shirts', auth=False)
    new_category, _ = request('/api/products?category=accessories', auth=False)
    assert all(p['id'] != product_id for p in old_category)
    assert any(p['id'] == product_id and p['price_cents'] == 54321 for p in new_category)
    print('PASS: image upload, invalid files, image validation, create/edit and cache freshness')

    original_settings, _ = request('/api/admin/storefront')
    settings = copy.deepcopy(original_settings)
    settings['carousel_product_ids'] = [product_id]
    settings['featured_product_ids'] = [product_id]
    settings['arrivals_title'] = 'Integration storefront test'
    settings['categories'] = ['accessories']
    request('/api/storefront', auth=False)  # Warm previous revision before changing settings.
    request('/api/admin/storefront', 'PUT', settings)
    home, _ = request('/api/storefront', auth=False)
    assert home['settings'] == settings
    assert [p['id'] for p in home['carousel']] == [product_id]
    assert next(image['url'] for image in home['carousel'][0]['images'] if image['carousel']) == label_url
    assert [p['id'] for p in home['featured']] == [product_id]
    invalid = copy.deepcopy(settings); invalid['carousel_product_ids'] = [2147483647]
    request('/api/admin/storefront', 'PUT', invalid, 400)
    request(f'/api/admin/products/{product_id}', 'DELETE', expected=403, use_csrf=False)
    request('/api/admin/products/2147483647', 'DELETE', expected=404)
    remaining = [p['id'] for p in request('/api/products')[0] if p['id'] != product_id][:2]
    settings['featured_product_ids'] = remaining + [product_id]
    settings['carousel_enabled'] = True
    request('/api/admin/storefront', 'PUT', settings)
    shared = copy.deepcopy(product)
    shared_label = upload(png())
    shared['images'][1]['url'] = shared_label
    shared_product, _ = request('/api/admin/products', 'POST', shared, 201)
    shared_id = shared_product['id']; created_products.append(shared_id)
    request('/api/products?category=accessories')  # Warm cache before deletion.
    request(f'/api/admin/products/{product_id}/archive', 'POST', {}, 401, auth=False)
    request(f'/api/admin/products/{product_id}/archive', 'POST', {}, 403, use_csrf=False)
    archived, _ = request(f'/api/admin/products/{product_id}/archive', 'POST', {})
    assert archived['sold'] and archived['name'] == product['name']
    assert all(p['id'] != product_id for p in request('/api/products', auth=False)[0])
    assert any(p['id'] == product_id for p in request('/api/products?sold=true', auth=False)[0])
    assert all(p['id'] != product_id for p in request('/api/storefront', auth=False)[0]['carousel'])
    sql(f"""
      INSERT INTO customers(username,username_key,password_hash) VALUES ('{fixture_user}','{fixture_user}','fixture-only');
      INSERT INTO chats(customer_id,product_id,product_name)
        SELECT id,{product_id},'Archive test' FROM customers WHERE username='{fixture_user}';
      INSERT INTO chat_messages(chat_id,is_admin,client_id,body)
        SELECT id,false,'fixture','Test message' FROM chats WHERE product_id={product_id};
      INSERT INTO purchase_requests(customer_id,chat_id,product_id,product_name,last_name,first_name,contact,city)
        SELECT customer_id,id,product_id,product_name,'Test','Test','Test','Test' FROM chats WHERE product_id={product_id};
      INSERT INTO purchase_request_events(request_id,for_admin,status)
        SELECT id,true,'new' FROM purchase_requests WHERE product_id={product_id};
      INSERT INTO product_views(product_id,visitor_hash,bucket) VALUES ({product_id},'fixture',now());
    """)
    sql(f"""INSERT INTO purchase_requests(customer_id,chat_id,product_id,product_name,last_name,first_name,contact,city,status)
      SELECT c.customer_id,c.id,c.product_id,c.product_name,'Test','Test','Test','Test','completed'
      FROM chats c CROSS JOIN generate_series(1,10) n WHERE c.product_id={product_id};""")
    for archived in ['false','true']:
        expected_ids=sql("SELECT id FROM purchase_requests WHERE (status='completed')="+archived+" ORDER BY id DESC").splitlines()
        for size in [4,8]:
            loaded=[]
            for offset in range(0,len(expected_ids)+size,size):
                page=request(f'/api/admin/requests/page?archive={archived}&limit={size}&offset={offset}')[0]
                assert page['total']==len(expected_ids)
                loaded.extend(str(r['id']) for r in page['items'])
            assert loaded==expected_ids
    request('/api/admin/requests/page?limit=8',expected=401,auth=False)
    request('/api/admin/requests/page?limit=100',expected=400)
    first_id=int(sql(f'SELECT min(id) FROM purchase_requests WHERE product_id={product_id}'))
    assert request(f'/api/admin/requests/{first_id}')[0]['id']==first_id
    request(f'/api/admin/requests/{first_id}',expected=401,auth=False)
    print('PASS: admin request pages, active/archive counts and direct detail outside loaded page')
    chat_ids = sql(f'SELECT id FROM chats WHERE product_id={product_id}')
    request_ids = ','.join(sql(f'SELECT id FROM purchase_requests WHERE product_id={product_id}').splitlines())
    request(f'/api/admin/products/{product_id}', 'DELETE', expected=204)
    for table,condition in [
        ('chats',f'product_id={product_id}'), ('purchase_requests',f'product_id={product_id}'),
        ('product_views',f'product_id={product_id}'), ('chat_messages',f'chat_id IN ({chat_ids})'),
        ('purchase_request_events',f'request_id IN ({request_ids})')]:
        assert sql(f'SELECT count(*) FROM {table} WHERE {condition}') == '0', table
    print('PASS: archive endpoint, public cache invalidation and complete related-data deletion')

    request(f'/api/products/{product_id}', expected=404, auth=False)
    request(label_url, expected=404, auth=False)
    request(main_url, auth=False)  # Shared photo must remain available.
    request(shared_label, auth=False)
    request(f'/api/admin/products/{shared_id}', 'DELETE', expected=204)
    request(main_url, expected=404, auth=False)
    request(shared_label, expected=404, auth=False)
    print('PASS: product photos removed, shared photos retained until last product deletion')
    request(f'/api/admin/products/{product_id}', 'DELETE', expected=404)
    for path in ['/api/products', '/api/products?category=accessories', '/api/admin/products']:
        assert all(p['id'] != product_id for p in request(path)[0])
    home, _ = request('/api/storefront', auth=False)
    assert home['carousel'] == [] and not home['settings']['carousel_enabled']
    assert home['settings']['carousel_product_ids'] == []
    assert home['settings']['featured_product_ids'] == remaining
    assert [p['id'] for p in home['featured']] == remaining
    request('/api/admin/storefront', 'PUT', settings, 400)  # Stale selections cannot restore deleted IDs.
    print('PASS: deletion, authorization, cache invalidation and storefront cleanup')
    request('/api/admin/storefront', 'PUT', original_settings)
    original_settings = None
    print('PASS: storefront changes are public, ordered and validated')

    # Retain the old cookie to prove logout revokes the server-side session, too.
    old_cookie = next(c.value for c in jar if c.name == 'tt_session')
    request('/api/admin/logout', 'POST', {}, 204)
    request('/api/admin/session', expected=401, auth=False, extra_headers={'Cookie': 'tt_session=' + old_cookie})
    request('/api/admin/products', 'POST', product, 401)
    print('PASS: logout revokes the session')
finally:
    if original_settings is not None:
        request('/api/admin/storefront', 'PUT', original_settings)
    # Delete only fixtures created by this run, using generated numeric / hex IDs.
    if created_products or created_media:
        assert all(isinstance(value, int) for value in created_products)
        assert all(len(value) == 64 and all(c in '0123456789abcdef' for c in value) for value in created_media)
        statements = ['BEGIN;']
        if created_products:
            statements.append('DELETE FROM products WHERE id IN (' + ','.join(map(str, created_products)) + ');')
            statements.append('UPDATE catalog_revision SET version = version + 1;')
        if created_media:
            statements.append('DELETE FROM media WHERE id IN (' + ','.join("'" + value + "'" for value in created_media) + ');')
        statements.append(f"DELETE FROM customers WHERE username='{fixture_user}';")
        statements.append('COMMIT;')
        subprocess.run(['docker', 'compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'], input='\n'.join(statements), text=True, check=True, stdout=subprocess.DEVNULL)
        print('Temporary test records and images removed.')
