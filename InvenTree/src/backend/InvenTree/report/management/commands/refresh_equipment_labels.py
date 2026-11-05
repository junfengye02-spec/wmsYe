"""Install the shipped equipment label layout without overwriting old files."""

import hashlib
import json
from pathlib import Path

from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from report.local_print_templates import resolve_local_print_template
from report.management.commands.configure_local_print_templates import template_identity
from report.models import LabelTemplate


class Command(BaseCommand):
    """Preview by default; keep original files and require a rollback manifest."""

    help = 'Refresh the three standard equipment labels; preview unless --apply is set'

    def add_arguments(self, parser):
        """Expose explicit apply and rollback options."""
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--backup', type=Path)
        parser.add_argument('--restore', type=Path)

    @transaction.atomic
    def handle(self, *args, **options):
        """Save new template files and retain the original files for rollback."""
        if options['backup'] and options['restore']:
            raise CommandError('--backup and --restore cannot be combined')
        if options['apply'] and not (options['backup'] or options['restore']):
            raise CommandError('--apply requires --backup or --restore')
        list(LabelTemplate.objects.select_for_update().values_list('pk', flat=True))
        try:
            if options['restore']:
                self.restore(options['restore'], options['apply'])
                return
            source = Path(__file__).resolve().parents[2] / 'templates' / 'label'
            changes = []
            for model in ('part', 'stockitem', 'wmsreceiptdetail'):
                template = resolve_local_print_template(model, require_enabled=False)
                filename = (
                    'wms_complete_receipt.html'
                    if model == 'wmsreceiptdetail'
                    else 'product_ipn_qr.html'
                )
                content = (source / filename).read_bytes()
                record = {
                    **template_identity(template),
                    'installed_sha256': hashlib.sha256(content).hexdigest(),
                }
                changes.append((template, content, record))
                self.stdout.write(
                    f'{model}: {template.name} -> equipment name / brand / specification / model / company'
                )
            if not options['apply']:
                self.stdout.write('Preview only; no changes written')
                return
            with options['backup'].open('x', encoding='utf-8') as backup:
                json.dump(
                    {'version': 1, 'records': [row[2] for row in changes]},
                    backup,
                    indent=2,
                )
                backup.write('\n')
            for template, content, _ in changes:
                # Storage chooses a fresh filename; the old file stays intact.
                template.template.save(
                    f'equipment_{template.model_type}.html', ContentFile(content)
                )
            self.stdout.write(
                self.style.SUCCESS('Equipment labels updated; original files retained')
            )
        except (
            OSError,
            ValueError,
            KeyError,
            TypeError,
            ValidationError,
            ObjectDoesNotExist,
        ) as error:
            raise CommandError(str(error)) from error

    def restore(self, path, apply):
        """Reject rollback if either the installed or original file was edited."""
        payload = json.loads(path.read_text(encoding='utf-8'))
        if payload.get('version') != 1 or len(payload.get('records', [])) != 3:
            raise CommandError('Invalid equipment label backup')
        changes = []
        seen = set()
        for record in payload['records']:
            template = LabelTemplate.objects.get(pk=record['pk'])
            current = template_identity(template)
            if template.pk in seen or any(
                current[key] != record[key]
                for key in ('name', 'model_type', 'width', 'height')
            ):
                raise CommandError('Template identity changed; review manually')
            seen.add(template.pk)
            if current['sha256'] not in (record['sha256'], record['installed_sha256']):
                raise CommandError('Template contents changed; review manually')
            with template.template.storage.open(record['template'], 'rb') as original:
                if hashlib.sha256(original.read()).hexdigest() != record['sha256']:
                    raise CommandError('Original template changed; review manually')
            changes.append((template, record['template']))
        if apply:
            for template, filename in changes:
                template.template = filename
                template.save(update_fields=['template'])
        self.stdout.write(
            'Original equipment labels restored'
            if apply
            else 'Rollback preview only; no changes written'
        )
