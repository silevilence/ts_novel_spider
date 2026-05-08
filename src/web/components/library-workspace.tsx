import { useEffect, useState } from 'react';

import { ChapterDirectory } from './chapter-directory';
import type { LibraryModel } from '../services/library-model';
import {
  findPreferredReaderChapter,
  splitChapterContent,
  toLibraryDirectoryChapters,
} from '../services/library-view';

interface LibraryWorkspaceProps {
  model: LibraryModel;
  onOpenControl: () => void;
}

export function LibraryWorkspace({ model, onOpenControl }: LibraryWorkspaceProps) {
  const [isReaderDirectoryOpen, setIsReaderDirectoryOpen] = useState(false);

  useEffect(() => {
    setIsReaderDirectoryOpen(false);
  }, [model.location.path]);

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

      <ChapterDirectory
        chapters={toLibraryDirectoryChapters(detail.chapters)}
        mode="inspect"
        loading={model.loading}
        title="章节目录"
        subtitle="已下载和未下载的章节都在这里；点已下载章节可以直接阅读。"
        emptyMessage="当前作品还没有已知章节目录。"
        onPickChapter={(chapterId) => model.openChapter(detail.sourceId, detail.metadata.novelId, chapterId)}
      />

      {model.detail?.activeTask ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">任务状态</p>
              <h2>当前同步任务</h2>
            </div>
          </div>
          <div className="badge-row">
            <span className={`status-badge state-${model.detail.activeTask.status}`}>{model.detail.activeTask.status}</span>
            <span className="status-badge ok">已完成 {model.detail.activeTask.progress.completedChapters}</span>
            <span className="status-badge state-indexed">失败 {model.detail.activeTask.progress.failedChapters}</span>
          </div>
        </section>
      ) : null}

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