"""Customer registration/session checks; creates and cleans up only a generated test account."""
import http.cookiejar
import json
import os
import subprocess
import uuid
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor

base = os.environ.get('BASE_URL', 'http://localhost:4200').rstrip('/')
username = 'test_' + uuid.uuid4().hex
password = uuid.uuid4().hex
jar = http.cookiejar.CookieJar()
client = build_opener(HTTPCookieProcessor(jar))
csrf = ''

def request(path, method='GET', body=None, expected=200, headers=None):
    headers = dict(headers or {})
    if body is not None:
        body = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    try:
        response = client.open(Request(base + path, data=body, method=method, headers=headers), timeout=30)
    except HTTPError as error:
        response = error
    with response:
        data = response.read()
        assert response.status == expected, f'{method} {path}: expected {expected}, got {response.status}: {data[:150]!r}'
        return (json.loads(data) if 'application/json' in response.headers.get('Content-Type', '') else data), response.headers

try:
    credentials = {'username':username, 'password':password, 'password_confirmation':password}
    request('/api/auth/session', expected=401)
    request('/api/auth/register', 'POST', {**credentials, 'password_confirmation':'mismatch'}, 400)
    request('/api/auth/register', 'POST', {**credentials, 'password':'short', 'password_confirmation':'short'}, 400)
    request('/api/auth/register', 'POST', credentials, 403, {'Origin':'https://untrusted.invalid'})
    session, headers = request('/api/auth/register', 'POST', credentials, 201)
    assert session['username'] == username and headers['Cache-Control'] == 'no-store'
    assert all(part in headers['Set-Cookie'] for part in ('HttpOnly','SameSite=Strict','Path=/api/auth'))
    csrf = session['csrf_token']
    assert request('/api/auth/session')[0] == session
    request('/api/auth/register', 'POST', {**credentials, 'username':username.upper()}, 409)
    customer_cookie = next(c.value for c in jar if c.name == 'tt_customer')
    # Explicitly send the customer cookie to admin endpoints to prove role isolation.
    request('/api/admin/session', expected=401, headers={'Cookie':'tt_customer=' + customer_cookie})
    request('/api/admin/products', 'POST', {}, 401, {'Cookie':'tt_customer=' + customer_cookie, 'X-CSRF-Token':csrf})
    request('/api/auth/logout', 'POST', {}, 403)
    request('/api/auth/logout', 'POST', {}, 204, {'X-CSRF-Token':csrf})
    request('/api/auth/session', expected=401, headers={'Cookie':'tt_customer=' + customer_cookie})
    request('/api/auth/login', 'POST', {**credentials, 'password':'incorrect-password'}, 401)
    session, _ = request('/api/auth/login', 'POST', {**credentials, 'username':username.upper()})
    assert session['username'] == username
    request('/api/auth/logout', 'POST', {}, 204, {'X-CSRF-Token':session['csrf_token']})
    print('PASS: registration, confirmation, duplicates, login, session, logout, CSRF and admin isolation')
finally:
    assert username.startswith('test_') and username[5:].isalnum()
    sql = "DELETE FROM customers WHERE username_key = '" + username + "'; DELETE FROM customer_auth_throttle WHERE key = 'username:" + username + "';"
    subprocess.run(['docker','compose','exec','-T','postgres','sh','-c','psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'], input=sql, text=True, check=True, stdout=subprocess.DEVNULL)
    print('Temporary customer account and sessions removed.')
