#!/usr/bin/env python3
"""Verify every manifest JS/CSS/asset against a deployed origin, including bytes.

Example: --build InvenTree/tmp/contract-warranty/frontend-build
 --origin https://172.16.130.22:18443 --ca inventree-deploy/certificates/public/wms-ca.crt
No credentials or certificate bypass are used. Any redirect or HTML fallback fails.
"""
import argparse
import concurrent.futures
import hashlib
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', type=Path, required=True)
    parser.add_argument('--origin', required=True)
    parser.add_argument('--ca', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--direct', action='store_true', help='Connect directly (use for LAN origins instead of system proxy)')
    args = parser.parse_args()
    manifest = json.loads((args.build / '.vite/manifest.json').read_text())
    assets = set()
    for item in manifest.values():
        assets.add(item['file'])
        assets.update(item.get('css', []))
        assets.update(item.get('assets', []))
    context = ssl.create_default_context(cafile=str(args.ca) if args.ca else None)
    def verify(name):
        try:
            path = args.build / name
            if not path.resolve().is_relative_to(args.build.resolve()):
                raise ValueError('asset outside build directory')
            expected = path.read_bytes()
            url = args.origin.rstrip('/') + '/static/web/' + urllib.parse.quote(name, safe='/')
            handlers = [NoRedirect(), urllib.request.HTTPSHandler(context=context)]
            if args.direct:
                handlers.append(urllib.request.ProxyHandler({}))
            opener = urllib.request.build_opener(*handlers)
            with opener.open(url, timeout=15) as response:
                body = response.read()
                mime = response.headers.get_content_type()
                if name.endswith('.css') and mime != 'text/css':
                    raise ValueError('CSS returned ' + mime)
                if name.endswith('.js') and mime not in ('text/javascript', 'application/javascript'):
                    raise ValueError('JS returned ' + mime)
                if hashlib.sha256(body).digest() != hashlib.sha256(expected).digest():
                    raise ValueError('content differs from build')
            return None
        except Exception as error:
            return {'asset': name, 'error': str(error)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        failures = [item for item in pool.map(verify, sorted(assets)) if item]
    report = {'origin': args.origin, 'checked': len(assets), 'passed': len(assets)-len(failures), 'failures': failures}
    if args.output:
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({**report, 'failures': failures[:10]}, ensure_ascii=False, indent=2))
    raise SystemExit(1 if failures else 0)

if __name__ == '__main__':
    main()
