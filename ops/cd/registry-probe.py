import base64,json,sys,time,urllib.request,urllib.error
TOKEN=sys.stdin.readline().strip()
BASE='https://ghcr.io'
report={}
headers={'Authorization':'Basic '+base64.b64encode(('huyanxius:'+TOKEN).encode()).decode()}
try:
    request=urllib.request.Request(BASE+'/token?service=ghcr.io&scope=repository:huyanxius/everplain-api:pull',headers=headers)
    with urllib.request.urlopen(request,timeout=20) as r: bearer=json.load(r)['token']
    report['scope_token_http_ok']=True
    headers={'Authorization':'Bearer '+bearer,'Accept':'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'}
    request=urllib.request.Request(BASE+'/v2/huyanxius/everplain-api/manifests/sha256:2003dde7e2be27059e0a9bbb9c183c69f5bfb16feabbc05e09d5715f88fda0af',headers=headers)
    with urllib.request.urlopen(request,timeout=20) as r: manifest=json.load(r)
    report['manifest_http_ok']=True
    layer=max(manifest['layers'],key=lambda p:p['size'])
    headers['Range']='bytes=0-65535'
    request=urllib.request.Request(BASE+'/v2/huyanxius/everplain-api/blobs/'+layer['digest'],headers=headers)
    started=time.monotonic()
    with urllib.request.urlopen(request,timeout=30) as r:
        report['blob_http_ok']=r.status in (200,206)
        report['blob_received_64_kib']=len(r.read(65536))==65536
    report['blob_probe_seconds']=round(time.monotonic()-started,1)
except urllib.error.HTTPError as e:
    report['http_error_status']=e.code
except Exception as e:
    report['error_class']=type(e).__name__
print(json.dumps(report))
