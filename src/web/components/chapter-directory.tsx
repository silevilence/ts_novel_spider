import { useDeferredValue, useEffect, useState } from 'react';

import type { ChapterPersistStatus } from '../../server/core/spider';
import {
  filterChapterGroups,
  groupResolvedChapters,
} from '../services/chapter-groups';
import { summarizeChapterMedia } from '../services/library-view';

export interface ChapterDirectoryEntry {
  id: string;
  index: number;
  title: string;
  url: string;
  volumeTitle?: string;
  status: ChapterPersistStatus;
  isNew: boolean;
  wasDownloaded: boolean;
  media?: {
    total: number;
    cached: number;
    pending: number;
  };
}

interface ChapterDirectoryProps {
  chapters: ChapterDirectoryEntry[];
  mode?: 'select' | 'inspect';
  selectedChapterIds?: string[];
  activeChapterId?: string | null;
  busy?: boolean;
  loading: boolean;
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  onToggleChapter?: (chapterId: string) => void;
  onSelectAll?: () => void;
  onSelectPending?: () => void;
  onSelectFailed?: () => void;
  onClearSelection?: () => void;
  onPickChapter?: (chapterId: string) => void;
}

export function ChapterDirectory({
  chapters,
  mode = 'select',
  selectedChapterIds = [],
  activeChapterId = null,
  busy = false,
  loading,
  title = '选择要下载的章节',
  subtitle,
  emptyMessage = '读取目录后，这里会显示所有章节。',
  onToggleChapter,
  onSelectAll,
  onSelectPending,
  onSelectFailed,
  onClearSelection,
  onPickChapter,
}: ChapterDirectoryProps) {
  const selectionMode = mode === 'select';
  const selectedSet = new Set(selectedChapterIds);
  const [query, setQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const deferredQuery = useDeferredValue(query);
  const grouped = groupResolvedChapters(chapters);
  const filteredGroups = filterChapterGroups(grouped, deferredQuery);

  useEffect(() => {
    setCollapsedGroups((current) => {
      const nextState: Record<string, boolean> = {};

      for (const group of grouped) {
        nextState[group.id] = current[group.id] ?? false;
      }

      return nextState;
    });
  }, [chapters]);

  const allCollapsed = filteredGroups.length > 0 && filteredGroups.every((group) => collapsedGroups[group.id]);

  return (
    <section className="panel chapter-directory">
      <div className="panel-heading split">
        <div>
          <p className="eyebrow">章节目录</p>
          <h2>{title}</h2>
        </div>
        <div className="action-row wrap">
          {selectionMode ? (
            <>
              <button type="button" className="ghost-button" onClick={onSelectAll} disabled={busy || chapters.length === 0}>
                全选
              </button>
              <button type="button" className="ghost-button" onClick={onSelectPending} disabled={busy || chapters.length === 0}>
                选中待抓取
              </button>
              <button type="button" className="ghost-button" onClick={onSelectFailed} disabled={busy || chapters.length === 0}>
                选中失败项
              </button>
              <button type="button" className="ghost-button" onClick={onClearSelection} disabled={busy || selectedChapterIds.length === 0}>
                清空
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              setCollapsedGroups((current) => {
                const nextValue = !allCollapsed;
                const nextState: Record<string, boolean> = {};

                for (const group of filteredGroups) {
                  nextState[group.id] = nextValue;
                }

                return { ...current, ...nextState };
              })
            }
            disabled={filteredGroups.length === 0}
          >
            {allCollapsed ? '展开全部分组' : '折叠全部分组'}
          </button>
        </div>
      </div>

      <div className="directory-toolbar">
        <label className="toolbar-search">
          <span className="visually-hidden">搜索章节</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索卷名、章节标题或编号"
          />
        </label>
        <div className="badge-row">
          {selectionMode ? <span className="status-badge state-indexed">已选 {selectedChapterIds.length}</span> : null}
          {!selectionMode ? <span className="status-badge ok">可阅读 {chapters.filter((chapter) => chapter.wasDownloaded).length}</span> : null}
          <span className="status-badge state-indexed">{selectionMode ? '待抓取' : '未下载'} {chapters.filter((chapter) => chapter.status !== 'downloaded').length}</span>
        </div>
      </div>

      {subtitle ? <p className="panel-note">{subtitle}</p> : null}

      {chapters.length === 0 ? (
        <div className="empty-state">
          <p>{loading ? '正在读取目录，请稍候。' : emptyMessage}</p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="empty-state compact">
          <p>没有匹配当前搜索条件的章节。</p>
        </div>
      ) : (
        <div className="volume-list">
          {filteredGroups.map((group) => {
            const isCollapsed = collapsedGroups[group.id] ?? false;

            return (
              <article key={group.id} className="volume-card">
                <button
                  type="button"
                  className="volume-toggle"
                  onClick={() =>
                    setCollapsedGroups((current) => ({
                      ...current,
                      [group.id]: !isCollapsed,
                    }))
                  }
                >
                  <div>
                    <h3>{group.title}</h3>
                    <p className="panel-note">
                      第 #{group.chapters[0]?.index ?? 0} 章 - 第 #{group.chapters[group.chapters.length - 1]?.index ?? 0} 章
                    </p>
                  </div>
                  <div className="volume-summary">
                    <span className="count-chip">{group.summary.total} 章</span>
                    <span className="count-chip accent">{selectionMode ? '待抓取' : '未下载'} {group.summary.pendingCount}</span>
                    {group.summary.newCount > 0 ? <span className="count-chip">新增 {group.summary.newCount}</span> : null}
                    {group.summary.failedCount > 0 ? <span className="count-chip danger">失败 {group.summary.failedCount}</span> : null}
                    <span className="count-chip subtle">{isCollapsed ? '展开' : '收起'}</span>
                  </div>
                </button>
                {!isCollapsed ? (
                  <ul className="chapter-list compact-density">
                    {group.chapters.map((chapter) => {
                      const checked = selectedSet.has(chapter.id);
                      const isActive = activeChapterId === chapter.id;
                      const mediaSummary = summarizeChapterMedia(chapter.media);
                      const statusRow = (
                        <div className="badge-row chapter-status-row">
                          {isActive ? <span className="status-badge ok">阅读中</span> : null}
                          {chapter.isNew ? <span className="status-badge new">新增</span> : null}
                          {chapter.wasDownloaded ? <span className="status-badge ok">{selectionMode ? '已下载' : '可阅读'}</span> : null}
                          {mediaSummary.hasMedia ? <span className="status-badge state-indexed">{mediaSummary.presenceLabel}</span> : <span className="count-chip subtle">无图</span>}
                          {mediaSummary.cacheLabel ? (
                            <span className={`status-badge ${mediaSummary.cacheComplete ? 'ok' : 'state-indexed'}`}>
                              {mediaSummary.cacheLabel}
                            </span>
                          ) : null}
                          {chapter.status !== 'downloaded' ? <span className={`status-badge state-${chapter.status}`}>{formatChapterStatus(chapter.status)}</span> : null}
                        </div>
                      );

                      return (
                        <li key={chapter.id} className={`chapter-item status-${chapter.status} ${isActive ? 'active' : ''}`}>
                          {selectionMode ? (
                            <>
                              <label className="chapter-row">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={busy}
                                  onChange={() => onToggleChapter?.(chapter.id)}
                                />
                                <span className="chapter-copy">
                                  <span className="chapter-index">#{chapter.index}</span>
                                  <strong>{chapter.title}</strong>
                                </span>
                              </label>
                              {statusRow}
                            </>
                          ) : (
                            <button
                              type="button"
                              className="chapter-link-button"
                              onClick={() => onPickChapter?.(chapter.id)}
                              disabled={busy}
                            >
                              <span className="chapter-copy">
                                <span className="chapter-index">#{chapter.index}</span>
                                <strong>{chapter.title}</strong>
                              </span>
                              {statusRow}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatChapterStatus(status: ChapterPersistStatus): string {
  switch (status) {
    case 'indexed':
      return '已索引';
    case 'downloaded':
      return '已下载';
    case 'failed':
      return '已失败';
    default:
      return status;
  }
}