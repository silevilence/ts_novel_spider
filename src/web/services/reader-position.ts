import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';

export interface ReaderPosition { fingerprint: string; block: number; fraction: number }
export function readerFingerprint(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
  return `${content.length}:${hash >>> 0}`;
}
export function parseReaderPosition(raw: string | null, fingerprint: string): ReaderPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ReaderPosition;
    return value.fingerprint === fingerprint && Number.isInteger(value.block) && value.block >= 0
      && Number.isFinite(value.fraction) && value.fraction >= 0 && value.fraction <= 1 ? value : null;
  } catch { return null; }
}

export function positionAtViewport(rects: Array<{ top: number; height: number }>, fingerprint: string): ReaderPosition {
  const index = rects.findIndex(rect => rect.top + rect.height > 80);
  const block = index < 0 ? Math.max(0, rects.length - 1) : index;
  const rect = rects[block];
  return { fingerprint, block, fraction: rect ? Math.max(0, Math.min(1, (80 - rect.top) / Math.max(1, rect.height))) : 0 };
}

export function useReaderPosition(ref: RefObject<HTMLDivElement | null>, identity: string | null, content: string, layoutKey = ''): string | null {
  const fingerprint = useMemo(() => readerFingerprint(content), [content]);
  const [notice, setNotice] = useState<string | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !identity) return;
    const key = `novel-reader-position:${identity}`;
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); } catch { setNotice('浏览器无法保存章内位置。'); }
    let position = parseReaderPosition(raw, fingerprint);
    const blocks = () => Array.from(root.children).filter(element => element.getBoundingClientRect().height > 0);
    setNotice(raw && !position ? '阅读内容或保存的位置已变化，已回到本章开头。' : null);
    if (!position) position = { fingerprint, block: 0, fraction: 0 };
    let frame = 0;
    const restore = () => {
      const elements = blocks();
      const element = elements[position!.block];
      if (!element && elements.length) { position = { fingerprint, block: 0, fraction: 0 }; setNotice('原阅读位置已失效，已回到本章开头。'); }
      const rect = (element ?? elements[0] ?? root).getBoundingClientRect();
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top + rect.height * position!.fraction - 80), behavior: 'instant' });
    };
    const save = () => {
      try { localStorage.setItem(key, JSON.stringify(position)); } catch { /* Reading remains available if browser storage is full. */ }
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        position = positionAtViewport(blocks().map(element => element.getBoundingClientRect()), fingerprint);
        save();
      });
    };
    restore();
    const observer = new ResizeObserver(restore);
    observer.observe(root);
    root.addEventListener('load', restore, true);
    window.addEventListener('resize', restore);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', save);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); root.removeEventListener('load', restore, true);
      window.removeEventListener('resize', restore); window.removeEventListener('scroll', onScroll); window.removeEventListener('pagehide', save); save();
    };
  }, [identity, fingerprint, layoutKey, ref]);
  return notice;
}
