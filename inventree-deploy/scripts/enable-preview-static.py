#!/usr/bin/env python3
"""Serve existing public Vite build directly from preview Caddy.

Preserves ports, CA, environment and other mounts. Keeps the previous container
for rollback. Run after adding the /static/web handler to Caddyfile.preview.
"""
import json
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]

def run(*args):
    return subprocess.check_output(args, text=True).strip()

def main():
    name = 'wms-preview-proxy'
    info = json.loads(run('docker', 'inspect', name))[0]
    frontend = DEPLOY.parent / 'InvenTree/tmp/contract-warranty/frontend-build'
    assert (frontend / '.vite/manifest.json').is_file()
    binds = info['HostConfig']['Binds'] or []
    wanted = str(frontend) + ':/var/www/frontend:ro'
    if wanted in binds:
        run('docker', 'exec', name, 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile')
        run('docker', 'exec', name, 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile')
        print('Static frontend mount already configured; Caddy reloaded.')
        return
    assert not any('/var/www/frontend' in item for item in binds)
    binds = [*binds, wanted]
    with tempfile.TemporaryDirectory(prefix='wms-static-') as temp:
        envfile = Path(temp) / 'proxy.env'
        envfile.write_text('\n'.join(info['Config']['Env']) + '\n')
        os.chmod(envfile, 0o600)
        common = ['--network', info['HostConfig']['NetworkMode'], '--env-file', str(envfile)]
        for bind in binds:
            common += ['-v', bind]
        run('docker', 'run', '--rm', *common, info['Image'], 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile')
        previous = name + '-before-static-' + datetime.now().strftime('%Y%m%d%H%M%S')
        run('docker', 'stop', name)
        run('docker', 'rename', name, previous)
        try:
            restart = info['HostConfig']['RestartPolicy']
            policy = restart['Name'] or 'no'
            if policy == 'on-failure' and restart.get('MaximumRetryCount'):
                policy += ':' + str(restart['MaximumRetryCount'])
            args = ['docker', 'create', '--name', name, '--restart', policy, *common]
            for port, bindings in (info['HostConfig']['PortBindings'] or {}).items():
                for bind in bindings:
                    args += ['-p', f"{bind['HostIp']}:{bind['HostPort']}:{port}"]
            for key in ('WorkingDir', 'User'):
                if info['Config'][key]:
                    args += ['-w' if key == 'WorkingDir' else '--user', info['Config'][key]]
            for extra in info['HostConfig'].get('ExtraHosts') or []:
                args += ['--add-host', extra]
            entrypoint = info['Config']['Entrypoint'] or []
            if entrypoint:
                assert len(entrypoint) == 1
                args += ['--entrypoint', entrypoint[0]]
            args += [info['Image'], *(info['Config']['Cmd'] or [])]
            run(*args)
            run('docker', 'start', name)
        except Exception:
            # Only remove the new replacement; the previous container is intact.
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
            run('docker', 'rename', previous, name)
            run('docker', 'start', name)
            raise
    print('Updated preview proxy. Previous container retained:', previous)

if __name__ == '__main__':
    main()
