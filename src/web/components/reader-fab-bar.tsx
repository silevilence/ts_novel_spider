import type { ReactNode } from 'react';

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
 * 阅读器悬浮按钮栏——统一管理所有 FAB，自动垂直排列，不再各自独立定位。
 * 新增按钮只需在 items 数组追加即可。
 */
export function ReaderFabBar({ items }: ReaderFabBarProps) {
  return (
    <div className="reader-fab-bar" role="toolbar" aria-label="阅读器快捷操作">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`reader-fab-item${item.accent ? ' accent' : ''}`}
          aria-label={item.ariaLabel}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
