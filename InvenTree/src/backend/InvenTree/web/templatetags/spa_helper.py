"""Template tag to render SPA imports."""

import json
import json.decoder
from pathlib import Path

from django import template
from django.conf import settings
from django.utils.html import format_html, format_html_join
from django.utils.safestring import mark_safe

import structlog

logger = structlog.get_logger('inventree')
register = template.Library()

FRONTEND_SETTINGS = json.dumps(settings.FRONTEND_SETTINGS)


@register.simple_tag
def spa_bundle(manifest_path: str | Path = '', app: str = 'web'):
    """Render SPA bundle."""

    def get_url(file: str) -> str:
        """Get static url for file."""
        return f'{settings.STATIC_URL}{app}/{file}'

    if manifest_path == '':
        manifest = Path(__file__).parent.parent.joinpath(
            'static/web/.vite/manifest.json'
        )
    else:
        manifest = Path(manifest_path)

    if not manifest.exists():
        # Try old path for manifest file
        manifest = Path(__file__).parent.parent.joinpath('static/web/manifest.json')

        # Final check - fail if manifest file not found
        if not manifest.exists():
            logger.error('Manifest file not found')
            return 'NOT_FOUND'

    try:
        with manifest.open() as manifest_file:
            manifest_data = json.load(manifest_file)
    except (TypeError, json.decoder.JSONDecodeError):
        logger.exception('Failed to parse manifest file')
        return ''

    # Follow Vite's backend integration contract: entry CSS, static dependency
    # CSS, one executable entry, then optional static dependency preloads.
    # dynamicImports belong to import() at runtime; executing them here bypasses
    # lazy loading and omits Vite's CSS/dependency loading for those modules.
    index = manifest_data.get('index.html') if isinstance(manifest_data, dict) else None
    if not isinstance(index, dict) or not index.get('file'):
        logger.error('Manifest entry index.html not found')
        return ''

    imported_chunks = []
    seen = {'index.html'}

    def collect_imports(chunk):
        for key in chunk.get('imports', []):
            if key in seen:
                continue
            seen.add(key)
            imported = manifest_data[key]
            collect_imports(imported)
            imported_chunks.append(imported)

    collect_imports(index)
    css_files = dict.fromkeys(
        css_file
        for chunk in [index, *imported_chunks]
        for css_file in chunk.get('css', [])
    )
    css = format_html_join(
        '',
        '<link rel="stylesheet" href="{}">',
        ((get_url(file),) for file in css_files),
    )
    script = format_html(
        '<script type="module" src="{}"></script>', get_url(index['file'])
    )
    preloads = format_html_join(
        '',
        '<link rel="modulepreload" href="{}">',
        (
            (get_url(file),)
            for file in dict.fromkeys(chunk['file'] for chunk in imported_chunks)
        ),
    )
    return format_html('{}{}{}', css, script, preloads)


@register.simple_tag
def spa_settings():
    """Render settings for spa."""
    return mark_safe(
        f"""<script>window.INVENTREE_SETTINGS={FRONTEND_SETTINGS}</script>"""
    )
