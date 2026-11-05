import { Boundary } from '@lib/components/Boundary';
import useTable from '@lib/hooks/UseTable';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { Button, MantineProvider, Stack, TextInput } from '@mantine/core';
import '@mantine/core/styles.css';
import 'mantine-datatable/styles.css';
import { QueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { ApiProvider } from '../../../src/contexts/ApiContext';

i18n.load('zh-CN', {});
i18n.activate('zh-CN');
const { InvenTreeTableInternal } = await import(
  '../../../src/components/tables/InvenTreeTable'
);
const api = axios.create();
const client = new QueryClient();
function TableFixture() {
  const tableState = useTable('recovery');
  const navigate = useNavigate();
  return (
    <Stack p='md'>
      <TextInput
        aria-label='Fixture search'
        value={tableState.searchTerm}
        onChange={(event) =>
          tableState.setSearchTerm(event.currentTarget.value)
        }
      />
      <Button
        onClick={() => void client.refetchQueries({ queryKey: ['tabledata'] })}
      >
        Background refresh
      </Button>
      <Button onClick={() => tableState.refreshTable()}>Refresh fixture</Button>
      <InvenTreeTableInternal
        url='/api/recovery/'
        tableState={tableState}
        columns={[{ accessor: 'name', title: '设备名称' }]}
        props={{ noHeader: true }}
        api={api}
        navigate={navigate}
      />
    </Stack>
  );
}
createRoot(document.getElementById('root')!).render(
  <I18nProvider i18n={i18n}>
    <MantineProvider>
      <MemoryRouter>
        <ApiProvider api={api} client={client}>
          <Boundary label='PanelContent-stock-items'>
            <TableFixture />
          </Boundary>
        </ApiProvider>
      </MemoryRouter>
    </MantineProvider>
  </I18nProvider>
);
