import { ChapterDirectory } from './chapter-directory';
import { MetadataBoard } from './metadata-board';
import type { ControlCenterModel } from '../services/control-center-model';

interface ControlConsoleProps {
  model: ControlCenterModel;
  onOpenSettings: () => void;
}

export function ControlConsole({ model, onOpenSettings }: ControlConsoleProps) {
  const pendingCount = model.preview?.chapters.filter((chapter) => chapter.status !== 'downloaded').length ?? 0;

  return (
    <div className="page-stack">
      <section className="hero route-hero">
        <div className="route-header">
          <p className="eyebrow">开始抓取</p>
          <h2>选择作品并开始下载</h2>
          <p className="route-copy">
            先查看作品信息和章节目录，再决定要下载哪些内容。底部按钮会一直固定，滚动时也不用来回找。
          </p>
        </div>

        <div className="route-summary-strip">
          <article className="summary-tile">
            <span className="label">当前站点</span>
            <strong>{model.selectedSource?.label ?? '加载中'}</strong>
          </article>
          <article className="summary-tile">
            <span className="label">待抓取章节</span>
            <strong>{pendingCount} 章</strong>
          </article>
          <article className="summary-tile">
            <span className="label">下载设置</span>
            <strong>{model.chapterConcurrency} 并发 / {model.chapterRetryCount} 次重试</strong>
          </article>
        </div>

        <form
          className="control-form"
          onSubmit={(event) => {
            event.preventDefault();
            void model.handlePreviewSubmit();
          }}
        >
          <div className="control-form-grid">
            <label>
              <span>目标站点</span>
              <select
                value={model.selectedSourceId}
                onChange={(event) => model.handleSourceChange(event.target.value)}
              >
                {model.sources.map((source) => (
                  <option key={source.sourceId} value={source.sourceId}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>作品编号</span>
              <input
                value={model.novelId}
                onChange={(event) => model.setNovelId(event.target.value)}
                placeholder={model.selectedSource?.defaultNovelId ?? '输入作品编号'}
              />
            </label>
          </div>
          {model.selectedSource ? <p className="panel-note">{model.selectedSource.description}</p> : null}
          <div className="control-form-separator"></div>
          <div className="action-row wrap">
            <button type="button" className="ghost-button" onClick={onOpenSettings}>
              更多设置
            </button>
            <span className="panel-note">
              当前下载方式：{model.forceRefetch ? '重新下载已存在的章节' : '只下载缺少的章节'}
            </span>
          </div>
          {model.previewError ? <p className="error-text">{model.previewError}</p> : null}
        </form>
      </section>

      <MetadataBoard preview={model.preview} loading={model.previewBusy} errorMessage={model.previewError} />

      <ChapterDirectory
        chapters={model.preview?.chapters ?? []}
        selectedChapterIds={model.selectedChapterIds}
        busy={model.isBusy}
        loading={model.previewBusy}
        onToggleChapter={model.toggleChapterSelection}
        onSelectAll={model.selectAllChapters}
        onSelectPending={model.selectPendingChapters}
        onSelectFailed={model.selectFailedChapters}
        onClearSelection={model.clearSelectedChapters}
      />

      <div className="action-dock">
        <div className="dock-copy">
          <strong>已选 {model.selectedChapterIds.length} 章</strong>
          <span className="panel-note">
            目录加载后会默认勾选未下载章节。无论滚动到哪里，都可以直接开始下载。
          </span>
        </div>
        <div className="dock-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={onOpenSettings}
          >
            打开设置
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void model.handlePreviewSubmit()}
            disabled={model.isBusy || model.novelId.trim().length === 0}
          >
            {model.previewBusy ? '解析中...' : '解析目录'}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void model.handleCreateTask(model.selectedChapterIds.length > 0 ? model.selectedChapterIds : undefined)}
            disabled={model.isBusy || model.novelId.trim().length === 0}
          >
            {model.taskBusy ? '下发中...' : '下发抓取任务'}
          </button>
        </div>
      </div>
    </div>
  );
}