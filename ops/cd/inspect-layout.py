"""Read-only release preconditions; never print environment values or host paths."""
import json,subprocess,re,stat,shutil
from pathlib import Path
DATABASE_FILES = {
    name + suffix
    for name in ("everplain.db", "everplain-retrieval.db")
    for suffix in ("", "-wal", "-shm", "-journal")
}

def require(condition, message="checked release precondition failed"):
    if not condition:
        raise RuntimeError(message)

def data_entries(source):
    """Only regular files and directories inside the existing product mount are data."""
    entries = []
    pending = sorted(source.iterdir(), reverse=True)
    while pending:
        path = pending.pop()
        info = path.lstat()
        require(path.resolve() == path)
        require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode))
        if stat.S_ISDIR(info.st_mode):
            require(path.parent != source or path.name not in DATABASE_FILES)
            pending.extend(sorted(path.iterdir(), reverse=True))
        else:
            require(info.st_nlink == 1)
        entries.append((path, info))
    return entries

def data_bytes(source):
    return sum(info.st_size for _, info in data_entries(source) if stat.S_ISREG(info.st_mode))

r={}
containers={}
for role,port,inside in [('api','8297','8297/tcp'),('web','5196','8080/tcp')]:
 v=json.loads(subprocess.run(['docker','inspect','everplain-'+role],capture_output=True,text=True,check=True,timeout=20).stdout)[0]
 containers[role]=v
 r[role+'_name']=v['Name']=='/everplain-'+role
 r[role+'_running_unprivileged']=v['State']['Running'] and not v['HostConfig'].get('Privileged')
 r[role+'_restart']=v['HostConfig'].get('RestartPolicy',{}).get('Name') in {'unless-stopped','no'}
 r[role+'_ports']=v['HostConfig']['PortBindings']=={inside:[{'HostIp':'127.0.0.1','HostPort':port}]}
 r[role+'_network_single']=len(v['NetworkSettings']['Networks'])==1
api,web=containers['api'],containers['web']
a=list(api['NetworkSettings']['Networks']); w=list(web['NetworkSettings']['Networks'])
r['same_network']=a==w
r['everplain_network']=len(a)==1 and (a[0]=='bridge' or a[0].startswith('everplain'))
m=api['Mounts']; r['api_mount_single']=len(m)==1
r['data_mount_present']=len([x for x in m if x['Destination']=='/data'])==1
r['extra_api_mounts_readonly']=all(not x['RW'] for x in m if x['Destination']!='/data')
r['extra_api_mount_count']=sum(x['Destination']!='/data' for x in m)
for x in m:
 if x['Destination']!='/data': continue
 r['data_writable']=x['RW']; r['data_mount_type']=x['Type'] in {'volume','bind'}
 r['data_volume_identity']=x['Type']!='volume' or x.get('Name','').startswith('everplain')
 p=Path(x['Source']); r['data_absolute_canonical']=p.is_absolute() and p.resolve()==p
 r['data_product_path']=any(t.startswith('everplain') for t in p.parts)
 r['database_present']=(p/'everplain.db').is_file()
 try:
  data_entries(p)
  r['recursive_data_safe']=True
  r['recursive_data_budget_sufficient']=shutil.disk_usage('/srv/everplain-updates').free > 6*1024**3+data_bytes(p)*3+512*1024**2
 except Exception:
  r['recursive_data_safe']=False
  r['recursive_data_budget_sufficient']=False
 allowed={n+s for n in ['everplain.db','everplain-retrieval.db'] for s in ['','-wal','-shm','-journal']}
 r['data_entries_allowed']=all(t.is_file() and not t.is_symlink() and t.name in allowed for t in p.iterdir())
 extras=[t for t in p.iterdir() if t.name not in allowed]
 r['unexpected_data_count']=len(extras)
 r['extra_data_all_regular']=all(t.is_file() and not t.is_symlink() for t in extras)
 r['extra_data_directory_count']=sum(t.is_dir() for t in extras)
 r['extra_data_sqlite_count']=sum(t.is_file() and not t.is_symlink() and t.open('rb').read(16)==b'SQLite format 3\x00' for t in extras)
 for known in ['everplain.db.bak','everplain-retrieval.db.bak','everplain.db.backup','everplain-retrieval.db.backup','uploads','imports','backups','.DS_Store','everplain-tokenizer-cache','tokenizer-cache']:
  r['data_known_'+known.replace('.','_')]=(p/known).exists()
e=dict(t.split('=',1) for t in api['Config']['Env'])
for k,v in [('EVERPLAIN_RUNTIME_MODE','base'),('EVERPLAIN_DATABASE_URL','sqlite:////data/everplain.db'),('EVERPLAIN_RETRIEVAL_INDEX_PATH','/data/everplain-retrieval.db')]: r[k.lower()+'_matches']=e.get(k)==v
r['no_other_product_env']=not any(k.startswith('QUNXUE_') for k in e)
r['environment_format']=all(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',k) and '\n' not in v for k,v in e.items())
r['release_revision_valid']=bool(re.fullmatch(r'[0-9a-f]{40}',e.get('EVERPLAIN_RELEASE_REVISION','')))
print(json.dumps(r,sort_keys=True))
