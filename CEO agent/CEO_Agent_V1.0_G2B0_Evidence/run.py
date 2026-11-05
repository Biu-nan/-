import subprocess,os,sys,json,time
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
w=Path(__file__).resolve().parents[3];e=Path(__file__).resolve().parent
label=sys.argv[1];cmd=sys.argv[2:]
env={k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','SYSTEMDRIVE','COMSPEC','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA'}}
tmp=Path(r'F:\tmp\ceog2b0-20261105-isolated');tmp.mkdir(parents=True,exist_ok=True)
env.update({'TEMP':str(tmp),'TMP':str(tmp),'USER_DATA_DIR':str(tmp/'user'),'NODE_NO_WARNINGS':'1','NO_PROXY':'127.0.0.1,localhost','CEOG1_ALLOWED_ROOTS':str(w)+';'+str(tmp),'NODE_OPTIONS':'--import '+(e/'test-safety.mjs').as_uri()})
for name in ['user.npmrc','global.npmrc']:(tmp/name).write_text('',encoding='utf-8')
env['NPM_CONFIG_USERCONFIG']=str(tmp/'user.npmrc');env['NPM_CONFIG_GLOBALCONFIG']=str(tmp/'global.npmrc')
start=time.time();p=subprocess.run(cmd,cwd=w,env=env,capture_output=True)
(e/(label+'.stdout.log')).write_bytes(p.stdout);(e/(label+'.stderr.log')).write_bytes(p.stderr)
record={'label':label,'cwd':str(w),'command':cmd,'exitCode':p.returncode,'seconds':round(time.time()-start,3)}
(e/(label+'.result.json')).write_text(json.dumps(record,indent=2),encoding='utf-8')
(e/(label+'.tracked.diff')).write_bytes(subprocess.run(['git','diff','--binary'],cwd=w,capture_output=True).stdout)
print(json.dumps(record));out=p.stdout.decode('utf-8',errors='replace');print(chr(10).join(x for x in out.splitlines() if x.startswith(chr(8505)) or x.startswith(chr(10006)))[-2500:]);print(p.stderr.decode('utf-8',errors='replace')[-800:])
sys.exit(0)
