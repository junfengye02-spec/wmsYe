import { t } from '@lingui/core/macro';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { ErrorBoundary, type FallbackRender } from '@sentry/react';
import { IconExclamationCircle, IconInfoCircle } from '@tabler/icons-react';
import { type ReactNode, useCallback, useState } from 'react';

function isResourceLoadError(message: string | null): boolean {
  return (
    !!message &&
    /^(Unable to preload CSS for |Failed to fetch dynamically imported module:|Importing a module script failed|error loading dynamically imported module|Loading (?:CSS )?chunk .+ failed)/i.test(
      message
    )
  );
}

export function DefaultFallback({
  title,
  error
}: Readonly<{ title: string; error: string | null }>): ReactNode {
  const resourceFailure = isResourceLoadError(error);
  return (
    <>
      <Alert
        color='red'
        icon={<IconExclamationCircle />}
        title={`INVE-E17: ${t`Error rendering component`}: ${title}`}
      >
        <Stack gap='xs'>
          <Text size='sm'>
            {resourceFailure
              ? t`页面资源加载失败，请确认网络连接后重新加载。`
              : t`An error occurred while rendering this component.`}
          </Text>
          <Text size='sm'>
            {resourceFailure
              ? t`不会自动刷新页面。重新加载前，请先保存或复制尚未提交的内容。`
              : t`Try reloading the page, or contact your administrator if the problem persists.`}
          </Text>
          {resourceFailure && (
            <Button
              variant='light'
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                // A rejected React.lazy import is cached. A user-approved full
                // reload resets it and Vite's failed CSS preload cache together.
                if (
                  window.confirm(
                    t`重新加载将清除当前页面未提交的内容。确认已保存或复制后继续？`
                  )
                ) {
                  window.location.reload();
                }
              }}
            >{t`重新加载页面资源`}</Button>
          )}
        </Stack>
      </Alert>
      {error && (
        <Alert color='red' icon={<IconInfoCircle />} title={t`Error Details`}>
          <Text size='sm'>{error}</Text>
        </Alert>
      )}
    </>
  );
}

export function Boundary({
  children,
  label,
  fallback
}: Readonly<{
  children: ReactNode;
  label: string;
  fallback?: React.ReactElement<any> | FallbackRender;
}>): ReactNode {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onError = useCallback(
    (error: unknown, componentStack: string | undefined, eventId: string) => {
      console.error(`ERR: Error rendering component: ${label}`);
      console.error(error);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    },
    []
  );

  return (
    <ErrorBoundary
      fallback={
        fallback ?? <DefaultFallback title={label} error={errorMessage} />
      }
      onError={onError}
    >
      {children}
    </ErrorBoundary>
  );
}
