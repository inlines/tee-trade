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


def png():
    def chunk(kind, content):
        return struct.pack('!I', len(content)) + kind + content + struct.pack('!I', zlib.crc32(kind + content) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 2, 2, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\0' + b'\x80\x90\x70' * 2) * 2)) + chunk(b'IEND', b'')


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
    assert empty['price_cents'] is None and empty['release_year'] is None
    public_empty, _ = request(f"/api/products/{empty['id']}", auth=False)
    assert public_empty == empty
    request(f"/api/admin/products/{empty['id']}", 'PUT', {})
    request(f"/api/admin/products/{empty['id']}", 'DELETE', expected=204)
    print('PASS: create, retrieve and edit an entirely empty product')
    main_url = upload(png())
    label_url = upload(png())
    content, headers = request(main_url, auth=False)
    assert content.startswith(b'\xff\xd8') and headers['Content-Type'] == 'image/jpeg'
    assert headers['X-Content-Type-Options'] == 'nosniff'
    product = {'name': 'Integration test ' + uuid.uuid4().hex, 'category':'t-shirts', 'brand':'Test', 'release_year':2026,
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
    request('/api/products?category=t-shirts')  # Warm the old cache before editing.
    product['name'] += ' edited'; product['category'] = 'accessories'; product['price_cents'] = 54321
    updated, _ = request(f'/api/admin/products/{product_id}', 'PUT', product)
    public, _ = request(f'/api/products/{product_id}', auth=False)
    assert updated == public and public['name'] == product['name']
    assert public['images'][1]['carousel'] is True and public['images'][0]['carousel'] is False
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
    request(f'/api/admin/products/{product_id}', 'DELETE', expected=204)
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
        statements.append('COMMIT;')
        subprocess.run(['docker', 'compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'], input='\n'.join(statements), text=True, check=True, stdout=subprocess.DEVNULL)
        print('Temporary test records and images removed.')
