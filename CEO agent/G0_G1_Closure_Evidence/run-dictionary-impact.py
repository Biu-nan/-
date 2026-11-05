"""Recheck only the three closure cases using the existing G1 guard and synthetic roots."""
from pathlib import Path
import datetime
import json
import os
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
e = Path(__file__).resolve().parent
w = Path(r'F:\yikuaborder-deploy\.worktrees\ceo-g0-g1-20261105')
tmp = Path(r'F:\tmp\ceog1-20261105-isolated')
assert tmp.is_dir()
guard = w / '.superpowers/sdd/ceo-g0-g1-20261105/test-safety.mjs'
env = {k: v for k, v in os.environ.items() if k.upper() in {
    'PATH', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT',
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA'}}
env.update({'TEMP': str(tmp), 'TMP': str(tmp), 'USER_DATA_DIR': str(tmp / 'user'),
            'NODE_NO_WARNINGS': '1', 'NO_PROXY': '127.0.0.1,localhost',
            'CEOG1_ALLOWED_ROOTS': str(w) + ';' + str(tmp),
            'NODE_OPTIONS': '--import ' + guard.as_uri()})
command = ['node', '--test', str(e / 'dictionary-impact.test.mjs')]
label = 'dictionary-impact-recheck-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f')
start = time.time()
p = subprocess.run(command, cwd=w, env=env, capture_output=True)
(e / (label + '.stdout.log')).write_bytes(p.stdout)
(e / (label + '.stderr.log')).write_bytes(p.stderr)
record = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'command': command,
          'cwd': str(w), 'exitCode': p.returncode, 'seconds': round(time.time() - start, 3)}
(e / (label + '.result.json')).write_text(json.dumps(record, indent=2), encoding='utf-8')
print(json.dumps(record))
print(p.stdout.decode('utf-8', errors='replace'))
print(p.stderr.decode('utf-8', errors='replace'))
sys.exit(p.returncode)
