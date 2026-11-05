import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { MantineProvider, Stack } from '@mantine/core';
import '@mantine/core/styles.css';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api, queryClient } from '../../../src/App';
import { ApiProvider } from '../../../src/contexts/ApiContext';
import WmsBatchDetailPage from '../../../src/pages/stock/WmsBatchDetailPage';
import { WmsContractManager } from '../../../src/pages/stock/WmsContractManager';
import { useGlobalSettingsState } from '../../../src/states/SettingsStates';
import { useUserState } from '../../../src/states/UserState';

i18n.load('zh-CN', {});
i18n.activate('zh-CN');
const { default: WmsStatisticsPage } = await import(
  '../../../src/pages/stock/WmsStatisticsPage'
);
queryClient.setDefaultOptions({ queries: { retry: false } });
useGlobalSettingsState.setState({
  lookup: { SCAN_APPROVAL_ENABLED: 'true' },
  loaded: true
});
useUserState.setState({
  is_authed: true,
  user: {
    pk: 1,
    is_staff: false,
    permissions: { stockitem: ['view', 'change'] }
  } as any
});
createRoot(document.getElementById('root')!).render(
  <I18nProvider i18n={i18n}>
    <MantineProvider>
      <MemoryRouter>
        <ApiProvider api={api} client={queryClient}>
          <Stack p='md'>
            {new URLSearchParams(window.location.search).get('view') ===
            'contracts' ? (
              <WmsContractManager />
            ) : (
              <Routes>
                <Route path='/' element={<WmsStatisticsPage />} />
                <Route
                  path='/stock/statistics/'
                  element={<WmsStatisticsPage />}
                />
                <Route
                  path='/stock/statistics/batch/:requestId/'
                  element={<WmsBatchDetailPage />}
                />
              </Routes>
            )}
          </Stack>
        </ApiProvider>
      </MemoryRouter>
    </MantineProvider>
  </I18nProvider>
);
