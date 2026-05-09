import { useEffect, useState } from 'react';

import { ChapterDirectory } from './chapter-directory';
import type { LibraryModel } from '../services/library-model';
import {
  buildLibraryExportDownloadUrl,
  type LibraryExportFormat,
} from '../services/api';
import {
  formatLibraryTaskStatus,
  findPreferredReaderChapter,
  splitChapterContent,
  toLibraryDirectoryChapters,
} from '../services/library-view';

interface LibraryWorkspaceProps {
  model: LibraryModel;
  onOpenControl: () => void;
}

const LIBRARY_EXPORT_OPTIONS: Array<{
  format: LibraryExportFormat;
  label: string;
  summary: string;
  bestFor: string;
  example: string;
}> = [
  {
    format: 'markdown',
    label: 'Markdown 文档',
    summary: '像一份整理好的笔记稿，章节层次清楚，适合你后面继续改内容、做摘录或再排版。',
    bestFor: '想继续整理内容',
    example: '打开后会看到分卷、分章，读起来和整理资料都方便。',
  },
  {
    format: 'epub',
    label: 'EPUB 电子书',
    summary: '最适合直接拿去阅读器、手机或平板里看，整体体验会更像一本正常电子书。',
    bestFor: '想直接拿去阅读',
    example: '导入阅读器后，可以像普通电子书一样翻页和跳目录。',
  },
  {
    format: 'txt',
    label: 'TXT 纯文本',
    summary: '最省事的一份纯文字，只保留章节标题和正文，适合备份、复制或在简单设备里打开。',
    bestFor: '想留一份纯文字备份',
    example: '打开后就是连续的文字内容，不会有复杂排版。',
  },
];

export function LibraryWorkspace({ model, onOpenControl }: LibraryWorkspaceProps) {
  const [isReaderDirectoryOpen, setIsReaderDirectoryOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);

  useEffect(() => {
    setIsReaderDirectoryOpen(false);
    setIsExportDialogOpen(false);
  }, [model.location.path]);

  useEffect(() => {
    if (!isExportDialogOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExportDialogOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isExportDialogOpen]);

  if (model.location.view === 'page') {
    const totalNovels = model.novels.length;
    const downloadedChapters = model.novels.reduce((sum, novel) => sum + novel.downloadedChapters, 0);
    const pendingChapters = model.novels.reduce((sum, novel) => sum + novel.indexedChapters + novel.failedChapters, 0);

    return (
      <div className="page-stack">
        <section className="hero route-hero">
          <div className="route-header">
            <p className="eyebrow">本地书库</p>
            <h2>书库总览</h2>
            <p className="route-copy">这里会列出已经下载到本地的小说，方便继续补抓、查看章节和直接阅读。</p>
          </div>

          <div className="route-summary-strip">
            <article className="summary-tile">
              <span className="label">已入库作品</span>
              <strong>{totalNovels}</strong>
            </article>
            <article className="summary-tile">
              <span className="label">已下载章节</span>
              <strong>{downloadedChapters}</strong>
            </article>
            <article className="summary-tile">
              <span className="label">未下载章节</span>
              <strong>{pendingChapters}</strong>
            </article>
          </div>

          <div className="action-row wrap">
            <button type="button" className="ghost-button" onClick={onOpenControl}>
              去抓取新作品
            </button>
            <button type="button" className="secondary-button" onClick={() => void model.refresh()} disabled={model.loading}>
              {model.loading ? '刷新中...' : '刷新书库'}
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">书库列表</p>
              <h2>已下载小说</h2>
            </div>
            <p className="panel-note">{model.errorMessage ?? '按作品查看作者、标签、下载情况和最近更新时间。'}</p>
          </div>

          {model.novels.length === 0 ? (
            <div className="empty-state">
              <p>{model.loading ? '正在读取书库...' : '书库里还没有小说，先去抓取一本。'}</p>
            </div>
          ) : (
            <div className="library-grid">
              {model.novels.map((novel) => (
                <article key={`${novel.sourceId}-${novel.metadata.novelId}`} className="card library-card">
                  <p className="label">{novel.sourceId}</p>
                  <h3>{novel.metadata.title}</h3>
                  <p className="muted">作者：{novel.metadata.author || '未知作者'}</p>
                  <p className="library-card-copy">{novel.metadata.description || '暂无简介。'}</p>
                  <div className="tag-row">
                    {novel.metadata.tags.length > 0
                      ? novel.metadata.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)
                      : <span className="muted">无标签</span>}
                  </div>
                  <div className="badge-row">
                    <span className="status-badge ok">已下载 {novel.downloadedChapters}</span>
                    <span className="status-badge state-indexed">未下载 {novel.indexedChapters + novel.failedChapters}</span>
                  </div>
                  <div className="action-row wrap">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => model.openNovel(novel.sourceId, novel.metadata.novelId)}
                    >
                      查看详情
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  const detail = model.detail?.novel;

  if (!detail) {
    return (
      <section className="panel empty-state">
        <p>{model.loading ? '正在加载书籍详情...' : model.errorMessage ?? '未找到对应书籍。'}</p>
      </section>
    );
  }

  if (model.location.view === 'reader') {
    const chapter = model.chapter?.chapter;
    const readerChapter = model.chapter?.chapter.chapter;

    if (!chapter || !readerChapter) {
      return (
        <section className="panel empty-state">
          <p>{model.loading ? '正在加载章节...' : model.errorMessage ?? '当前章节尚未下载，暂时无法离线阅读。'}</p>
        </section>
      );
    }

    return (
      <div className="page-stack">
        <section className="hero route-hero">
          <div className="route-header">
            <p className="eyebrow">离线阅读</p>
            <h2>{readerChapter.title}</h2>
            <p className="route-copy">
              {detail.metadata.title} / {detail.metadata.author || '未知作者'}
            </p>
          </div>

          <div className="action-row wrap">
            <button
              type="button"
              className="ghost-button"
              onClick={() => model.openNovel(detail.sourceId, detail.metadata.novelId)}
            >
              返回详情
            </button>
            {chapter.previousChapterId ? (
              <button
                type="button"
                className="secondary-button"
                  onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, chapter.previousChapterId!)}
              >
                上一章
              </button>
            ) : null}
            {chapter.nextChapterId ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, chapter.nextChapterId!)}
              >
                下一章
              </button>
            ) : null}
            <button
              type="button"
              className="ghost-button"
              onClick={() => setIsReaderDirectoryOpen(true)}
            >
              打开目录
            </button>
          </div>
        </section>

        <section className="panel reader-layout">
          <article className="reader-article">
            <div className="reader-article-header">
              <div className="panel-heading reader-copy-header">
                <div>
                  <p className="eyebrow">正文</p>
                  <h2>{readerChapter.title}</h2>
                </div>
                <p className="panel-note">这章已经下载到本地，可以直接阅读。</p>
              </div>

              <aside className="reader-media-summary">
                <p className="label">图片</p>
                <strong>{chapter.mediaAssets.length}</strong>
                <p className="muted">
                  {chapter.mediaAssets.length === 0
                    ? '这章没有图片。'
                    : `已缓存 ${readerChapter.media.cached} 张，没缓存的会直接读取原站图片。`}
                </p>
              </aside>
            </div>

            <div className="reader-copy">
              {splitChapterContent(readerChapter.content).map((paragraph, index) => (
                <p key={`${readerChapter.id}-${index}`}>{paragraph}</p>
              ))}
            </div>

            {chapter.mediaAssets.length > 0 ? (
              <section className="card media-stack reader-media-gallery">
                <p className="label">本章图片</p>
                {chapter.mediaAssets.map((media) => (
                  <article key={media.id} className="media-card">
                    <img src={media.publicUrl ?? media.sourceUrl} alt="章节媒体预览" loading="lazy" />
                    <div className="badge-row">
                      <span className={`status-badge ${media.cached ? 'ok' : 'state-indexed'}`}>
                        {media.cached ? '已缓存到本地' : '直接读取原图'}
                      </span>
                    </div>
                    <div className="action-row wrap">
                      <a className="secondary-link" href={media.sourceUrl} target="_blank" rel="noreferrer">查看原图</a>
                      {!media.cached ? (
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void model.cacheMediaAsset(media.id)}
                          disabled={model.mediaBusyId === media.id}
                        >
                          {model.mediaBusyId === media.id ? '缓存中...' : '保存到本地'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </section>
            ) : null}

            <div className="reader-footer-nav">
              {chapter.previousChapterId ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, chapter.previousChapterId!)}
                >
                  上一章
                </button>
              ) : (
                <span className="reader-footer-spacer" />
              )}
              <button
                type="button"
                className="ghost-button"
                onClick={() => setIsReaderDirectoryOpen(true)}
              >
                章节目录
              </button>
              {chapter.nextChapterId ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, chapter.nextChapterId!)}
                >
                  下一章
                </button>
              ) : (
                <span className="reader-footer-spacer" />
              )}
            </div>
          </article>
        </section>

        <button
          type="button"
          className="reader-directory-fab"
          onClick={() => setIsReaderDirectoryOpen(true)}
          aria-label="打开章节目录"
        >
          目录
        </button>

        {isReaderDirectoryOpen ? (
          <div className="reader-directory-overlay" role="presentation" onClick={() => setIsReaderDirectoryOpen(false)}>
            <aside
              className="reader-directory-drawer"
              aria-label="章节目录浮窗"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="reader-directory-drawer-header">
                <div>
                  <p className="eyebrow">阅读目录</p>
                  <h2>章节目录</h2>
                  <p className="panel-note">点已下载章节就能切换阅读。</p>
                </div>
                <button
                  type="button"
                  className="ghost-button reader-directory-close"
                  onClick={() => setIsReaderDirectoryOpen(false)}
                >
                  关闭
                </button>
              </div>

              <ChapterDirectory
                chapters={toLibraryDirectoryChapters(detail.chapters)}
                mode="inspect"
                activeChapterId={readerChapter.id}
                loading={model.loading}
                title="章节目录"
                subtitle="点已下载章节就能切换阅读。"
                emptyMessage="当前作品还没有本地章节。"
                onPickChapter={(chapterId) => model.openChapter(detail.sourceId, detail.metadata.novelId, chapterId)}
              />
            </aside>
          </div>
        ) : null}
      </div>
    );
  }

  const preferredChapterId = findPreferredReaderChapter(detail);
  const task = model.currentTask;
  const latestTaskEvent = task?.events[task.events.length - 1] ?? null;
  const taskHeading = task?.status === 'completed' || task?.status === 'failed' ? '最近一次同步' : '当前同步任务';

  return (
    <div className="page-stack">
      <section className="hero route-hero">
        <div className="route-header">
          <p className="eyebrow">书籍详情</p>
          <h2>{detail.metadata.title}</h2>
          <p className="route-copy">作者：{detail.metadata.author || '未知作者'}。已下载和未下载的章节都会在下面的目录里标出来。</p>
        </div>

        <div className="route-summary-strip">
          <article className="summary-tile">
            <span className="label">已下载</span>
            <strong>{detail.stats.downloaded}</strong>
          </article>
          <article className="summary-tile">
            <span className="label">未下载</span>
            <strong>{detail.stats.pending}</strong>
          </article>
          <article className="summary-tile">
            <span className="label">图片缓存</span>
            <strong>{detail.media.cached}/{detail.media.total}</strong>
          </article>
        </div>

        <div className="action-row wrap">
          <button type="button" className="ghost-button" onClick={() => model.refresh()} disabled={model.loading}>
            {model.loading ? '刷新中...' : '刷新详情'}
          </button>
          <button type="button" className="secondary-button" onClick={() => void model.runIncrementalSync()} disabled={model.syncBusy}>
            {model.syncBusy ? '同步中...' : '增量同步元数据'}
          </button>
          <button type="button" className="secondary-button" onClick={() => void model.syncMissingChapters()} disabled={model.syncBusy}>
            {model.syncBusy ? '补录中...' : '补录缺失章节'}
          </button>
          {preferredChapterId ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => model.openChapter(detail.sourceId, detail.metadata.novelId, preferredChapterId)}
            >
              开始离线阅读
            </button>
          ) : null}
          <a className="secondary-link" href={detail.metadata.infoPageUrl} target="_blank" rel="noreferrer">去原站查看</a>
        </div>
      </section>

      {task ? (
        <section className="panel task-summary-panel">
          <div className="panel-heading split align-start">
            <div>
              <p className="eyebrow">任务状态</p>
              <h2>{taskHeading}</h2>
            </div>
            <div className="badge-row">
              <span className={`status-badge state-${task.status}`}>{formatLibraryTaskStatus(task.status)}</span>
              <span className={`stream-indicator stream-${model.taskStreamState}`}>
                {model.taskStreamState === 'connected' ? '实时更新中' : model.taskStreamState === 'reconnecting' ? '正在重连' : '已结束'}
              </span>
            </div>
          </div>

          <div className="progress-track" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${Math.max(task.progress.percent, task.status === 'completed' ? 100 : 0)}%` }} />
          </div>

          <div className="badge-row">
            <span className="status-badge state-indexed">目录 {task.progress.catalogChapters}</span>
            <span className="status-badge ok">已完成 {task.progress.completedChapters}</span>
            <span className="status-badge state-indexed">排队 {task.progress.queuedChapters}</span>
            <span className="status-badge state-failed">失败 {task.progress.failedChapters}</span>
          </div>

          <p className="panel-note task-summary-note">
            {task.status === 'completed'
              ? '同步已结束，页面会自动带入最新目录和章节状态。'
              : task.status === 'failed'
                ? '任务已结束，但仍有失败章节；可以直接用“补录缺失章节”继续补抓。'
                : '这里会跟着后台任务更新，不需要手动刷新页面看进度。'}
          </p>

          {latestTaskEvent ? (
            <div className="card task-summary-event">
              <p className="label">最新进度</p>
              <strong>{latestTaskEvent.message}</strong>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel panel-grid metadata-board">
        <div className="card span-2">
          <p className="label">简介</p>
          <h3>{detail.metadata.title}</h3>
          <p>{detail.metadata.description || '暂无简介。'}</p>
        </div>
        <div className="card">
          <p className="label">作者</p>
          <strong>{detail.metadata.author || '未知作者'}</strong>
        </div>
        <div className="card">
          <p className="label">章节总数</p>
          <strong>{detail.metadata.chapterCount}</strong>
        </div>
        <div className="card span-2">
          <p className="label">标签</p>
          <div className="tag-row">
            {detail.metadata.tags.length > 0
              ? detail.metadata.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)
              : <span className="muted">无标签</span>}
          </div>
        </div>
        <div className="card">
          <p className="label">失败章节</p>
          <strong>{detail.stats.failed}</strong>
        </div>
        <div className="card">
          <p className="label">资源缓存</p>
          <strong>{detail.media.cached}/{detail.media.total}</strong>
        </div>
      </section>

      <section className="panel export-hub">
        <div className="panel-heading split align-start">
          <div>
            <p className="eyebrow">文件导出</p>
            <h2>导出文件</h2>
            <p className="panel-note">
              导出会使用你已经下载好的正文来生成文件。图片如果还没保存下来，也不会影响你先把正文导出去。
            </p>
          </div>

          <div className="export-hub-actions">
            <div className="badge-row">
              <span className="status-badge ok">正文 {detail.stats.downloaded} 章</span>
              <span className="status-badge state-indexed">图片缓存 {detail.media.cached}/{detail.media.total}</span>
              <span className="count-chip accent">3 种格式</span>
            </div>

            <button
              type="button"
              className="primary-button"
              onClick={() => setIsExportDialogOpen(true)}
              disabled={detail.stats.downloaded === 0}
            >
              选择导出格式
            </button>
          </div>
        </div>

        {detail.stats.downloaded === 0 ? (
          <div className="empty-state compact">
            <p>当前还没有已下载章节，先补录正文后才能导出文件。</p>
          </div>
        ) : (
          <div className="card export-hub-card">
            <p className="label">导出说明</p>
            <h3>一个入口，按用途选格式</h3>
            <p className="library-card-copy">
              如果你想继续整理内容，优先选 Markdown；如果要直接导入阅读器，选 EPUB；如果只想留一份纯文本备份，选 TXT。
            </p>
            <p className="panel-note">不确定选哪个也没关系，点开后会看到每种格式适合做什么、导出后大概是什么样子。</p>
          </div>
        )}
      </section>

      {isExportDialogOpen ? (
        <div className="reader-directory-overlay export-dialog-overlay" role="presentation" onClick={() => setIsExportDialogOpen(false)}>
          <section
            className="export-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-export-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="reader-directory-drawer-header export-dialog-header">
              <div>
                <p className="eyebrow">选择格式</p>
                <h2 id="library-export-dialog-title">导出 {detail.metadata.title}</h2>
                <p className="panel-note">只要按你的使用场景选就行。点一下就会开始生成并下载文件。</p>
              </div>

              <button
                type="button"
                className="ghost-button reader-directory-close"
                onClick={() => setIsExportDialogOpen(false)}
              >
                关闭
              </button>
            </div>

            <div className="card export-dialog-intro">
              <div className="badge-row">
                <span className="status-badge ok">已下载 {detail.stats.downloaded} 章</span>
                <span className="status-badge state-indexed">图片没保存也能先导出正文</span>
              </div>
              <p className="library-card-copy">
                下面的说明主要是帮你判断哪种更适合自己。示例描述的是导出后的阅读感觉，不用纠结文件名细节。
              </p>
            </div>

            <div className="export-option-list">
              {LIBRARY_EXPORT_OPTIONS.map((option) => (
                <article key={option.format} className="card export-option-card">
                  <div className="badge-row">
                    <span className="status-badge state-downloaded">{option.format.toUpperCase()}</span>
                    <span className="count-chip subtle">适合：{option.bestFor}</span>
                  </div>

                  <div className="export-option-copy">
                    <h3>{option.label}</h3>
                    <p className="library-card-copy">{option.summary}</p>
                  </div>

                  <div className="export-option-meta">
                    <div>
                      <p className="label">示例</p>
                      <strong>{option.example}</strong>
                    </div>
                    <div>
                      <p className="label">推荐给</p>
                      <strong>{option.bestFor}</strong>
                    </div>
                  </div>

                  <div className="action-row wrap">
                    <a
                      className="primary-link"
                      href={buildLibraryExportDownloadUrl(detail.sourceId, detail.metadata.novelId, option.format)}
                    >
                      下载 {option.format.toUpperCase()}
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <ChapterDirectory
        chapters={toLibraryDirectoryChapters(detail.chapters)}
        mode="inspect"
        loading={model.loading}
        title="章节目录"
        subtitle="已下载和未下载的章节都在这里；有图章节会直接标出图片数量和本地缓存情况。"
        emptyMessage="当前作品还没有已知章节目录。"
        onPickChapter={(chapterId) => model.openChapter(detail.sourceId, detail.metadata.novelId, chapterId)}
      />

      <div className="action-row wrap">
        <button type="button" className="ghost-button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          回到顶部
        </button>
        <button type="button" className="ghost-button" onClick={onOpenControl}>
          返回抓取台
        </button>
      </div>
    </div>
  );
}