import { RowDeleteAction, RowEditAction } from '@lib/components/RowActions';
import { StylishText } from '@lib/components/StylishText';
import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { UserRoles } from '@lib/enums/Roles';
import { apiUrl } from '@lib/functions/Api';
import useTable from '@lib/hooks/UseTable';
import { AddItemButton } from '@lib/index';
import type { TableColumn } from '@lib/types/Tables';
import { t } from '@lingui/core/macro';
import { type ChartTooltipProps, LineChart } from '@mantine/charts';
import {
  Accordion,
  Alert,
  Center,
  Divider,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text
} from '@mantine/core';
import dayjs from 'dayjs';
import { useCallback, useMemo, useState } from 'react';
import {
  DateColumn,
  DecimalColumn
} from '../../components/tables/ColumnRenderers';
import { InvenTreeTable } from '../../components/tables/InvenTreeTable';
import { formatDate, formatPriceRange } from '../../defaults/formatters';
import { partStocktakeFields } from '../../forms/PartForms';
import {
  useCreateApiFormModal,
  useDeleteApiFormModal,
  useEditApiFormModal
} from '../../hooks/UseForm';
import { useUserState } from '../../states/UserState';
import { canViewStockHistory } from '../../functions/wms';
import { StockTrackingTable } from '../../tables/stock/StockTrackingTable';

/*
 * Render a tooltip for the chart, with correct date information
 */
function ChartTooltip({ label, payload }: Readonly<ChartTooltipProps>) {
  const formattedLabel: string = useMemo(() => {
    if (label && typeof label === 'number') {
      return formatDate(dayjs(label).format('YYYY-MM-DD')) ?? label;
    } else if (!!label) {
      return label.toString();
    } else {
      return '';
    }
  }, [label]);

  if (!payload) {
    return null;
  }

  const quantity = payload.find((item) => item.name == 'quantity');
  const value_min = payload.find((item) => item.name == 'value_min');
  const value_max = payload.find((item) => item.name == 'value_max');

  return (
    <Paper px='md' py='sm' withBorder shadow='md' radius='md'>
      <Text key='title'>{formattedLabel}</Text>
      <Divider />
      <Text key='quantity' fz='sm'>
        {t`Quantity`} : {quantity?.value}
      </Text>
      <Text key='values' fz='sm'>
        {t`Value`} : {formatPriceRange(value_min?.value, value_max?.value)}
      </Text>
    </Paper>
  );
}

export function PartStocktakePanel({
  partId,
  units
}: Readonly<{ partId: number; units?: string }>) {
  const user = useUserState();
  const table = useTable('part-stocktake');

  const stocktakeFields = useMemo(() => partStocktakeFields(), []);

  const [selectedStocktake, setSelectedStocktake] = useState<
    number | undefined
  >(undefined);

  const editStocktakeEntry = useEditApiFormModal({
    pk: selectedStocktake,
    url: ApiEndpoints.part_stocktake_list,
    title: t`Edit Stocktake Entry`,
    fields: stocktakeFields,
    table: table
  });

  const deleteStocktakeEntry = useDeleteApiFormModal({
    pk: selectedStocktake,
    url: ApiEndpoints.part_stocktake_list,
    title: t`Delete Stocktake Entry`,
    table: table
  });

  const newStocktakeEntry = useCreateApiFormModal({
    title: t`Generate Stocktake Report`,
    url: apiUrl(ApiEndpoints.part_stocktake_generate),
    fields: {
      part: {
        value: partId,
        disabled: true
      },
      generate_entry: {
        value: true,
        hidden: true
      }
    },
    submitText: t`Generate`,
    successMessage: t`Stocktake report scheduled for generation`
  });

  const tableColumns: TableColumn[] = useMemo(() => {
    return [
      DateColumn({}),
      DecimalColumn({
        accessor: 'item_count',
        title: t`库存明细条数`,
        switchable: true,
        sortable: false
      }),
      DecimalColumn({
        accessor: 'quantity',
        title: units ? t`实物库存数量（${units}）` : t`实物库存数量`,
        sortable: false,
        switchable: false
      }),
      {
        accessor: 'cost',
        title: t`Stock Value`,
        sortable: false,
        render: (record: any) => {
          return formatPriceRange(record.cost_min, record.cost_max, {
            currency: record.cost_min_currency
          });
        }
      }
    ];
  }, [units]);

  const rowActions = useCallback(
    (record: any) => {
      return [
        RowEditAction({
          hidden: !user.hasChangeRole(UserRoles.part) || !user.isSuperuser(),
          onClick: () => {
            setSelectedStocktake(record.pk);
            editStocktakeEntry.open();
          }
        }),
        RowDeleteAction({
          hidden: !user.hasDeleteRole(UserRoles.part),
          onClick: () => {
            setSelectedStocktake(record.pk);
            deleteStocktakeEntry.open();
          }
        })
      ];
    },
    [user]
  );

  const chartData = useMemo(() => {
    const records =
      table.records?.map((record: any) => {
        return {
          date: new Date(record.date).valueOf(),
          quantity: Number(record.quantity),
          value_min: Number.parseFloat(record.cost_min),
          value_max: Number.parseFloat(record.cost_max)
        };
      }) ?? [];

    // Sort records to ensure correct date order
    return records.sort((a, b) => {
      return a.date - b.date;
    });
  }, [table.records]);

  // Calculate the date limits of the chart
  const chartLimits: number[] = useMemo(() => {
    let min_date = new Date();
    let max_date = new Date();

    if (chartData.length > 0) {
      min_date = new Date(chartData[0].date);
      max_date = new Date(chartData[chartData.length - 1].date);
    }

    // Expand limits by one day on either side
    min_date.setDate(min_date.getDate() - 1);
    max_date.setDate(max_date.getDate() + 1);

    return [min_date.valueOf(), max_date.valueOf()];
  }, [chartData]);

  const tableActions = useMemo(() => {
    return [
      <AddItemButton
        hidden={!user.hasAddRole(UserRoles.part)}
        key='add-stocktake'
        tooltip={t`Generate Stocktake Entry`}
        onClick={() => newStocktakeEntry.open()}
      />
    ];
  }, [user]);

  return (
    <>
      {newStocktakeEntry.modal}
      {editStocktakeEntry.modal}
      {deleteStocktakeEntry.modal}
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <InvenTreeTable
          url={apiUrl(ApiEndpoints.part_stocktake_list)}
          tableState={table}
          columns={tableColumns}
          props={{
            enableSelection: true,
            enableBulkDelete: true,
            enableDownload: true,
            params: {
              part: partId,
              ordering: '-date'
            },
            rowActions: rowActions,
            tableActions: tableActions
          }}
        />
        {table.isLoading ? (
          <Center>
            <Loader />
          </Center>
        ) : (
          <LineChart
            data={chartData}
            h={350}
            mah={'500px'}
            dataKey='date'
            withLegend
            withYAxis
            withRightYAxis
            yAxisLabel={units ? t`实物量（${units}）` : t`实物量`}
            rightYAxisLabel={t`Stock Value`}
            tooltipProps={{
              content: ({ label, payload }) => (
                <ChartTooltip label={label} payload={payload as any} />
              )
            }}
            yAxisProps={{
              yAxisId: 'left',
              allowDataOverflow: false
            }}
            rightYAxisProps={{
              allowDataOverflow: false
            }}
            xAxisProps={{
              scale: 'time',
              type: 'number',
              domain: chartLimits,
              tickFormatter: (value: number) => {
                return formatDate(dayjs(value).format('YYYY-MM-DD'));
              }
            }}
            series={[
              {
                name: 'quantity',
                label: t`实物库存数量`,
                color: 'blue.6',
                yAxisId: 'left'
              },
              {
                name: 'value_min',
                label: t`Minimum Value`,
                color: 'yellow.6',
                yAxisId: 'right'
              },
              {
                name: 'value_max',
                label: t`Maximum Value`,
                color: 'teal.6',
                yAxisId: 'right'
              }
            ]}
          />
        )}
      </SimpleGrid>
    </>
  );
}

export default function PartStockHistoryDetail({
  partId,
  units
}: Readonly<{ partId: number; units?: string }>) {
  const user = useUserState();
  if (!canViewStockHistory(user.user)) return null;
  return (
    <Stack>
      <Alert color='blue'>{t`此处展示该设备跨项目、合同及库位的实物库存快照，包含变体设备；不扣除冻结数量，不代表可用库存，也不是期间出入库数量。历史快照从启用后开始积累，不自动补算过去余额。库存价值为原生估算值，未维护价格时可能为零。`}</Alert>
      <Accordion multiple defaultValue={['stocktake']}>
        <Accordion.Item value='tracking'>
          <Accordion.Control>
            <StylishText size='lg'>{t`库存流水`}</StylishText>
          </Accordion.Control>
          <Accordion.Panel>
            <StockTrackingTable partId={partId} />
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value='stocktake'>
          <Accordion.Control>
            <StylishText size='lg'>{t`库存历史快照`}</StylishText>
          </Accordion.Control>
          <Accordion.Panel>
            <PartStocktakePanel partId={partId} units={units} />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
