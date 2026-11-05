import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { I18nProvider } from '@lingui/react';
import { MantineProvider, Stack, Textarea } from '@mantine/core';
import '@mantine/core/styles.css';
import { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { Boundary } from '../../../lib/components/Boundary';

i18n.load('zh-CN', {
  [msg`重新加载页面资源`.id]: '重新加载页面资源',
  [msg`重新加载将清除当前页面未提交的内容。确认已保存或复制后继续？`.id]:
    '重新加载将清除当前页面未提交的内容。确认已保存或复制后继续？',
  [msg`页面资源加载失败，请确认网络连接后重新加载。`.id]:
    '页面资源加载失败，请确认网络连接后重新加载。',
  [msg`不会自动刷新页面。重新加载前，请先保存或复制尚未提交的内容。`.id]:
    '不会自动刷新页面。重新加载前，请先保存或复制尚未提交的内容。'
});
i18n.activate('zh-CN');
const Page = lazy(() => import('./page'));
createRoot(document.getElementById('root')!).render(
  <I18nProvider i18n={i18n}>
    <MantineProvider>
      <Stack p='md'>
        <Textarea label='Unsubmitted form' />
        <Boundary label='layout'>
          <Suspense fallback='Loading'>
            <Page />
          </Suspense>
        </Boundary>
      </Stack>
    </MantineProvider>
  </I18nProvider>
);
