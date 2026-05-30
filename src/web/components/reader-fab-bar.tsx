import { ActionIcon, Affix, Stack, Tooltip } from '@mantine/core';

interface ReaderFabBarProps {
  items: Array<{
    key: string;
    label: string;
    ariaLabel: string;
    onClick: () => void;
    accent?: boolean;
  }>;
}

/**
 * 阅读器悬浮按钮栏——统一管理所有 FAB，使用 Mantine Affix 固定右下角。
 * 新增按钮只需在 items 数组追加即可。
 */
export function ReaderFabBar({ items }: ReaderFabBarProps) {
  return (
    <Affix position={{ bottom: 80, right: 24 }} withinPortal>
      <Stack gap="xs" role="toolbar" aria-label="阅读器快捷操作">
        {items.map((item) => (
          <Tooltip key={item.key} label={item.label} position="left" withArrow>
            <ActionIcon
              variant={item.accent ? 'filled' : 'light'}
              color={item.accent ? 'orange.5' : 'gray.4'}
              size="lg"
              radius="xl"
              aria-label={item.ariaLabel}
              onClick={item.onClick}
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
            >
              {item.label.slice(0, 2)}
            </ActionIcon>
          </Tooltip>
        ))}
      </Stack>
    </Affix>
  );
}
