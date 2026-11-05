"""Tests for web backend functionality."""

import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from django.test import SimpleTestCase, override_settings

from InvenTree.config import get_frontend_settings

from .templatetags import spa_helper


class TemplateTagTest(SimpleTestCase):
    """Tests for the template tag code."""

    def assertSettings(self, settings_data):
        """Helper to test if needed args are in the settings."""
        self.assertIn('debug', settings_data)
        self.assertIn('server_list', settings_data)
        self.assertIn('show_server_selector', settings_data)
        self.assertIn('environment', settings_data)

    @override_settings(STATIC_URL='/static/')
    def test_spa_bundle(self):
        """Render CSS/static preloads once, leaving lazy modules to runtime."""
        manifest_data = {
            'index.html': {
                'file': 'assets/index.js',
                'css': ['assets/index.css'],
                'imports': ['shared', 'other'],
                'dynamicImports': ['lazy'],
            },
            'shared': {
                'file': 'assets/shared.js',
                'css': ['assets/shared.css'],
                'imports': ['deep'],
            },
            'deep': {
                'file': 'assets/deep.js',
                'css': ['assets/deep.css', 'assets/index.css'],
                'imports': ['shared'],
            },
            'other': {'file': 'assets/other.js', 'imports': ['deep']},
            'lazy': {'file': 'assets/lazy.js', 'css': ['assets/lazy.css']},
        }
        with TemporaryDirectory() as directory:
            manifest = Path(directory) / 'manifest.json'
            manifest.write_text(json.dumps(manifest_data))
            resp = spa_helper.spa_bundle(manifest)
        self.assertEqual(resp.count('<script '), 1)
        self.assertIn(
            '<script type="module" src="/static/web/assets/index.js"></script>', resp
        )
        for filename in ['index.css', 'deep.css', 'shared.css']:
            self.assertEqual(resp.count(f'/static/web/assets/{filename}'), 1)
        for filename in ['deep.js', 'shared.js', 'other.js']:
            self.assertIn(
                f'<link rel="modulepreload" href="/static/web/assets/{filename}">', resp
            )
            self.assertEqual(resp.count(f'/static/web/assets/{filename}'), 1)
        self.assertNotIn('lazy', resp)
        self.assertLess(resp.index('index.css'), resp.index('deep.css'))
        self.assertLess(resp.index('shared.css'), resp.index('<script '))

    @override_settings(STATIC_URL='/static/')
    def test_spa_bundle_entry_without_imports(self):
        """An entry alone still includes its stylesheet and app prefix."""
        with TemporaryDirectory() as directory:
            manifest = Path(directory) / 'manifest.json'
            manifest.write_text(
                json.dumps(
                    {
                        'index.html': {
                            'file': 'assets/index.js',
                            'css': ['assets/index.css'],
                        }
                    }
                )
            )
            resp = spa_helper.spa_bundle(manifest, app='plugin')
        self.assertEqual(
            resp,
            '<link rel="stylesheet" href="/static/plugin/assets/index.css">'
            '<script type="module" src="/static/plugin/assets/index.js"></script>',
        )

    def test_spa_bundle_invalid_manifest(self):
        """Invalid input is handled without touching the deployed manifest."""
        with TemporaryDirectory() as directory:
            manifest = Path(directory) / 'manifest.json'
            for contents in ['broken', '{}', '[]']:
                manifest.write_text(contents)
                self.assertEqual(spa_helper.spa_bundle(manifest), '')

    def test_spa_bundle_missing_manifest(self):
        """The missing frontend marker is retained without renaming real assets."""
        with mock.patch.object(Path, 'exists', return_value=False):
            self.assertEqual(spa_helper.spa_bundle(), 'NOT_FOUND')

    def test_spa_settings(self):
        """Test the 'spa_settings' template tag."""
        resp = spa_helper.spa_settings()
        self.assertTrue(resp.startswith('<script>window.INVENTREE_SETTINGS='))
        settings_data_string = resp.replace(
            '<script>window.INVENTREE_SETTINGS=', ''
        ).replace('</script>', '')
        settings_data = json.loads(settings_data_string)
        self.assertSettings(settings_data)

    def test_get_frontend_settings(self):
        """Test frontend settings retrieval."""
        # Normal run for priming
        rsp = get_frontend_settings()
        self.assertSettings(rsp)

        # No base_url
        envs = {'INVENTREE_FRONTEND_URL_BASE': ''}
        with mock.patch.dict(os.environ, envs):
            rsp = get_frontend_settings()
            self.assertSettings(rsp)

        # No debug, no serverlist -> selector
        rsp = get_frontend_settings(False)
        self.assertSettings(rsp)
        self.assertTrue(rsp['show_server_selector'])

        # No debug, serverlist -> no selector
        envs = {
            'INVENTREE_FRONTEND_SETTINGS': json.dumps({'server_list': ['aa', 'bb']})
        }
        with mock.patch.dict(os.environ, envs):
            rsp = get_frontend_settings(False)
            self.assertNotIn('show_server_selector', rsp)
            self.assertEqual(rsp['server_list'], ['aa', 'bb'])
