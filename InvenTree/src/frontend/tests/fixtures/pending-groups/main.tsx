import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { Button, MantineProvider, Stack } from '@mantine/core';
import '@mantine/core/styles.css';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { api, queryClient } from '../../../src/App';
import { ApiProvider } from '../../../src/contexts/ApiContext';
import { useUserState } from '../../../src/states/UserState';
i18n.load('zh-CN', {});
i18n.activate('zh-CN');
const { ScanApprovalRequestDetails } = await import(
  '../../../src/pages/stock/ScanApprovalRequestDetails'
);
queryClient.setDefaultOptions({ queries: { retry: false } });
useUserState.setState({
  is_authed: true,
  user: { pk: 1, permissions: { stockitem: ['view', 'change'] } } as any
});
createRoot(document.getElementById('root')!).render(
  <I18nProvider i18n={i18n}>
    <MantineProvider>
      <MemoryRouter>
        <ApiProvider api={api} client={queryClient}>
          <Stack p='md'>
            <Button
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: ['scan-stock-request']
                })
              }
            >
              Refresh fixture
            </Button>
            <ScanApprovalRequestDetails
              compact={
                !new URLSearchParams(window.location.search).has('review')
              }
              requestId={1}
            />
          </Stack>
        </ApiProvider>
      </MemoryRouter>
    </MantineProvider>
  </I18nProvider>
);
