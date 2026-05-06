import type { ResolvedChapterState } from '../../server/core/spider';

interface ChapterDirectoryProps {
  chapters: ResolvedChapterState[];
  selectedChapterIds: string[];
  busy: boolean;
  onToggleChapter: (chapterId: string) => void;
  onSelectAll: () => void;
  onSelectPending: () => void;
  onSelectFailed: () => void;
  onClearSelection: () => void;
}

export function ChapterDirectory({
  chapters,
  selectedChapterIds,
  busy,
  onToggleChapter,
  onSelectAll,
  onSelectPending,
  onSelectFailed,
  onClearSelection,
}: ChapterDirectoryProps) {
  const selectedSet = new Set(selectedChapterIds);
  const grouped = groupChapters(chapters);

  return (
    <section className="panel chapter-directory">
      <div className="panel-heading split">
        <div>
          <p className="eyebrow">目录矩阵</p>
          <h2>卷级分组、多选下发与增量高亮</h2>
        </div>
        <div className="action-row wrap">
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
        </div>
      </div>

      {chapters.length === 0 ? (
        <div className="empty-state">
          <p>解析后将在这里显示目录结构和章节状态。</p>
        </div>
      ) : (
        <div className="volume-list">
          {grouped.map((group) => (
            <article key={group.volumeTitle} className="volume-card">
              <div className="volume-header">
                <h3>{group.volumeTitle}</h3>
                <span>{group.chapters.length} 章</span>
              </div>
              <ul className="chapter-list">
                {group.chapters.map((chapter) => {
                  const checked = selectedSet.has(chapter.id);

                  return (
                    <li key={chapter.id} className={`chapter-item status-${chapter.status}`}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          onChange={() => onToggleChapter(chapter.id)}
                        />
                        <span className="chapter-copy">
                          <strong>{chapter.title}</strong>
                          <span className="muted">#{chapter.index}</span>
                        </span>
                      </label>
                      <div className="badge-row">
                        {chapter.isNew ? <span className="status-badge new">新增</span> : null}
                        {chapter.wasDownloaded ? <span className="status-badge ok">已下载</span> : null}
                        <span className={`status-badge state-${chapter.status}`}>{chapter.status}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function groupChapters(chapters: ResolvedChapterState[]) {
  const groups = new Map<string, ResolvedChapterState[]>();

  for (const chapter of chapters) {
    const volumeTitle = chapter.volumeTitle ?? '未分卷';
    const existing = groups.get(volumeTitle);

    if (existing) {
      existing.push(chapter);
      continue;
    }

    groups.set(volumeTitle, [chapter]);
  }

  return [...groups.entries()].map(([volumeTitle, groupedChapters]) => ({
    volumeTitle,
    chapters: groupedChapters,
  }));
}