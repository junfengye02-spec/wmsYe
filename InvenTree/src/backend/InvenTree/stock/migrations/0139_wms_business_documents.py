"""Attach private evidence and safely bind unambiguous contract projects."""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def bind_contract_projects(apps, schema_editor):
    """Leave historical mixed or unknown project attribution untouched."""
    Contract = apps.get_model('stock', 'WmsContract')
    Receipt = apps.get_model('stock', 'WmsReceipt')
    Detail = apps.get_model('stock', 'WmsReceiptDetail')
    db = schema_editor.connection.alias
    for contract in Contract.objects.using(db).iterator():
        projects = set(
            Receipt.objects.using(db)
            .filter(contract_id=contract.pk)
            .values_list('project_code_id', flat=True)
        )
        projects.update(
            Detail.objects.using(db)
            .filter(contract_id=contract.pk)
            .values_list('project_code_id', flat=True)
        )
        if len(projects) == 1 and None not in projects:
            Contract.objects.using(db).filter(pk=contract.pk).update(
                project_id=projects.pop()
            )


class Migration(migrations.Migration):
    """Add optional document evidence without touching inventory balances."""

    dependencies = [
        ('stock', '0138_reusable_inbound_labels'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.AddField(
            model_name='wmscontract',
            name='project',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='wms_contracts',
                to='common.projectcode',
            ),
        ),
        migrations.RunPython(bind_contract_projects, migrations.RunPython.noop),
        migrations.CreateModel(
            name='WmsBusinessAttachment',
            fields=[
                (
                    'id',
                    models.AutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name='ID',
                    ),
                ),
                ('name', models.CharField(max_length=200)),
                ('content', models.BinaryField()),
                ('size', models.PositiveIntegerField()),
                ('content_type', models.CharField(max_length=100)),
                ('note', models.CharField(blank=True, max_length=1000)),
                ('uploader_name', models.CharField(max_length=200)),
                ('uploaded_at', models.DateTimeField(auto_now_add=True)),
                (
                    'request',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name='business_attachments',
                        to='stock.scanstockapprovalrequest',
                    ),
                ),
                (
                    'uploaded_by',
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={'ordering': ['uploaded_at', 'pk']},
        ),
    ]
