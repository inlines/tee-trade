"""End-to-end filesystem migration checks on disposable local fixtures only."""
import hashlib, http.cookiejar, json, os, subprocess, uuid
from pathlib import Path
from urllib.request import build_opener, HTTPCookieProcessor, Request
from urllib.error import HTTPError
import struct, zlib
base=os.environ.get('BASE_URL','http://localhost:4200')
env=dict(l.split('=',1) for l in Path('.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
client=build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar())); csrf=''; products=[]; media=[]
def http(path,method='GET',data=None,expected=200,headers=None):
    h=dict(headers or {});h['X-CSRF-Token']=csrf
    if data is not None and not isinstance(data,bytes):data=json.dumps(data).encode();h['Content-Type']='application/json'
    try:r=client.open(Request(base+path,data=data,method=method,headers=h),timeout=30)
    except HTTPError as e:r=e
    with r:
        b=r.read();assert r.status==expected,(path,r.status,b[:100])
        return (json.loads(b) if 'application/json' in r.headers.get('Content-Type','') else b),r.headers

def sql(s):return subprocess.check_output(['docker','compose','exec','-T','postgres','sh','-c','psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1'],input=s,text=True).strip()
def cli(mode,id,success=True):
    r=subprocess.run(['docker','compose','exec','-T','backend','tee-trade-api',mode,id],capture_output=True,text=True)
    assert (r.returncode==0)==success,r.stdout+r.stderr

def png():
    def c(k,b):return struct.pack('!I',len(b))+k+b+struct.pack('!I',zlib.crc32(k+b)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+c(b'IHDR',struct.pack('!2I5B',8,8,8,2,0,0,0))+c(b'IDAT',zlib.compress((b'\0'+b'\x90\x80\x70'*8)*8))+c(b'IEND',b'')
try:
    session,_=http('/api/admin/login','POST',{'username':env.get('ADMIN_USERNAME','arzamas'),'password':env['ADMIN_PASSWORD']});csrf=session['csrf_token']
    boundary='media-test-'+uuid.uuid4().hex
    data=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n').encode()+png()+f'\r\n--{boundary}--\r\n'.encode()
    upload,_=http('/api/admin/uploads','POST',data,201,{'Content-Type':'multipart/form-data; boundary='+boundary})
    new=upload['url'].split('/')[-1];media.append(new)
    content,headers=http(upload['url']);preview,ph=http(upload['url']+'/preview')
    assert headers['X-Media-Storage']==ph['X-Media-Storage']=='filesystem'
    assert headers['Content-Type']=='image/jpeg'
    assert sql(f"SELECT content IS NULL AND preview IS NULL FROM media WHERE id='{new}'")=='t'
    assert sql(f"SELECT content_sha256 FROM media WHERE id='{new}'")==hashlib.sha256(content).hexdigest()
    assert http(upload['url'],headers={'Range':'bytes=0-9'},expected=206)[0]==content[:10]
    legacy=uuid.uuid4().hex+uuid.uuid4().hex;media.append(legacy)
    sql(f"INSERT INTO media(id,content) VALUES('{legacy}',decode('{content.hex()}','hex'))")
    images=[{'url':'/api/media/'+id,'kind':'front' if i==0 else 'detail','alt':'migration test'} for i,id in enumerate([new,legacy])]
    product,_=http('/api/admin/products','POST',{'name':'Temporary media migration test','images':images},201);products.append(product['id'])
    before=http('/api/products/'+str(product['id']))[0]['images']
    # Legacy fallback works before full export and preserves exact original bytes.
    assert http('/api/media/'+legacy)[0]==content
    legacy_preview=http('/api/media/'+legacy+'/preview')[0]
    cli('media-export',legacy);cli('media-export',legacy);cli('media-verify',legacy)
    assert sql(f"SELECT content IS NOT NULL FROM media WHERE id='{legacy}'")=='t'
    # Refuse destructive cleanup if the file is corrupt, then repair from DB bytes.
    subprocess.run(['docker','compose','exec','-T','backend','sh','-c',f"printf corrupt > /data/media/{legacy}.jpg"],check=True)
    cli('media-prune-db',legacy,False)
    assert sql(f"SELECT content IS NOT NULL FROM media WHERE id='{legacy}'")=='t'
    cli('media-export',legacy);cli('media-prune-db',legacy);cli('media-verify',legacy)
    assert sql(f"SELECT content IS NULL AND preview IS NULL FROM media WHERE id='{legacy}'")=='t'
    assert http('/api/media/'+legacy)[0]==content
    assert http('/api/media/'+legacy+'/preview')[0]==legacy_preview
    assert http('/api/products/'+str(product['id']))[0]['images']==before
    http('/api/admin/products/'+str(product['id']),'DELETE',expected=204);products.clear()
    for id in media:
        http('/api/media/'+id,expected=404);http('/api/media/'+id+'/preview',expected=404)
        for suffix in ['.jpg','.preview.jpg']:
            assert subprocess.run(['docker','compose','exec','-T','backend','test','-e','/data/media/'+id+suffix]).returncode==1
    print('PASS: immediate file-only upload, Nginx static/range response, legacy fallback, repeatable export, checksum protection, repair, prune, unchanged product links, both files deleted')
finally:
    for id in products:http('/api/admin/products/'+str(id),'DELETE',expected=204)
    for id in media:
        assert len(id)==64 and all(c in '0123456789abcdef' for c in id)
        sql(f"DELETE FROM media WHERE id='{id}'")
    if csrf:http('/api/admin/logout','POST',{},204)
