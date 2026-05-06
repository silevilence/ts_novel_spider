import type { ControlPreviewPayload } from '../../server/routes/control-center';

interface MetadataBoardProps {
  preview: ControlPreviewPayload | null;
  loading: boolean;
  errorMessage: string | null;
}

export function MetadataBoard({ preview, loading, errorMessage }: MetadataBoardProps) {
  const metadata = preview?.metadata;
  const snapshotSummary = preview?.snapshotSummary;

  return (
    <section className="panel panel-grid metadata-board">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">元数据看板</p>
          <h2>小说基础信息与本地快照</h2>
        </div>
        <p className="panel-note">{loading ? '正在解析远端信息页与目录...' : errorMessage ?? '优先对照本地 SQLite 快照，标记已下载与新增章节。'}</p>
      </div>

      {metadata ? (
        <>
          <div className="card span-2">
            <p className="label">标题</p>
            <h3>{metadata.title}</h3>
            <p className="muted">作者：{metadata.author || '未知作者'}</p>
          </div>
          <div className="card">
            <p className="label">章节总数</p>
            <strong>{metadata.chapterCount}</strong>
          </div>
          <div className="card">
            <p className="label">信息页</p>
            <a href={metadata.infoPageUrl} target="_blank" rel="noreferrer">
              打开原站
            </a>
          </div>
          <div className="card span-2">
            <p className="label">简介</p>
            <p>{metadata.description || '暂无简介。'}</p>
          </div>
          <div className="card">
            <p className="label">标签</p>
            <div className="tag-row">
              {metadata.tags.length > 0 ? metadata.tags.map((tag) => <span key={tag} className="tag">{tag}</span>) : <span className="muted">无标签</span>}
            </div>
          </div>
          <div className="card">
            <p className="label">本地快照</p>
            {snapshotSummary ? (
              <ul className="compact-list">
                <li>已下载：{snapshotSummary.downloadedChapters}</li>
                <li>失败：{snapshotSummary.failedChapters}</li>
                <li>仅索引：{snapshotSummary.indexedChapters}</li>
                <li>新增：{snapshotSummary.newChapters}</li>
              </ul>
            ) : (
              <p className="muted">首次解析，尚无本地快照。</p>
            )}
          </div>
        </>
      ) : (
        <div className="card empty-state span-full">
          <p>选择爬虫并输入目标 ID 后，点击“解析目录”开始载入元数据与章节索引。</p>
        </div>
      )}
    </section>
  );
}