import { useState } from 'react';

import { NetworkProxyPanel } from './network-proxy-panel';
import type {
  ControlCenterModel,
  NoticeInput,
} from '../services/control-center-model';

interface SystemPreferencesProps {
  model: ControlCenterModel;
  onOpenControl: () => void;
  onNotify: (notice: NoticeInput) => void;
}

export function SystemPreferences({ model, onOpenControl, onNotify }: SystemPreferencesProps) {
  const [crawlOpen, setCrawlOpen] = useState(true);
  const [proxyOpen, setProxyOpen] = useState(false);

  return (
    <div className="settings-stack">
      <section className="hero route-hero">
        <div className="route-header">
          <p className="eyebrow">下载设置</p>
          <h2>调整默认下载方式</h2>
          <p className="route-copy">
            这里可以调整下载速度、失败重试次数和代理设置。保存后，新任务会直接使用这些选项。
          </p>
        </div>

        <div className="settings-summary-strip">
          <article className="summary-tile">
            <span className="label">默认并发</span>
            <strong>{model.chapterConcurrency}</strong>
          </article>
          <article className="summary-tile">
            <span className="label">重试次数</span>
            <strong>{model.chapterRetryCount}</strong>
          </article>
          <article className="summary-tile">
            <span className="label">目录策略</span>
            <strong>{model.forceRefetch ? '重新下载已存在章节' : '只下载缺少章节'}</strong>
          </article>
        </div>

        <div className="action-row wrap">
          <button type="button" className="ghost-button" onClick={onOpenControl}>
            返回开始抓取
          </button>
        </div>
      </section>

      <section className="fold-card">
        <div className="fold-header">
          <div>
            <p className="eyebrow">下载方式</p>
            <h2>默认下载选项</h2>
            <p className="panel-note">这些设置会自动用于之后创建的任务。</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setCrawlOpen((current) => !current)}>
            {crawlOpen ? '收起' : '展开'}
          </button>
        </div>

        {crawlOpen ? (
          <div className="fold-content">
            <div className="panel preferences-panel">
              <div className="preferences-grid">
                <label>
                  <span>章节并发数</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={model.chapterConcurrency}
                    onChange={(event) => model.setChapterConcurrency(Number(event.target.value) || 1)}
                  />
                </label>
                <label>
                  <span>失败重试次数</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={model.chapterRetryCount}
                    onChange={(event) => model.setChapterRetryCount(Number(event.target.value) || 0)}
                  />
                </label>
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={model.forceRefetch}
                  onChange={(event) => model.setForceRefetch(event.target.checked)}
                />
                <span>下载时也重新获取已经保存过的章节</span>
              </label>
              <p className="panel-note">
                一般情况下只下载缺少的章节即可；如果原站内容有更新，再打开这个选项。
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="fold-card">
        <div className="fold-header">
          <div>
            <p className="eyebrow">网络代理</p>
            <h2>代理设置</h2>
            <p className="panel-note">只有需要走代理时再展开这里，平时可以保持收起。</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => setProxyOpen((current) => !current)}>
            {proxyOpen ? '收起' : '展开'}
          </button>
        </div>

        {proxyOpen ? (
          <div className="fold-content">
            <NetworkProxyPanel onNotice={onNotify} />
          </div>
        ) : null}
      </section>
    </div>
  );
}