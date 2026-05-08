import type { NoticeInput } from '../services/control-center-model';

interface AppNotice extends NoticeInput {
  id: string;
}

interface NotificationCenterProps {
  notices: AppNotice[];
  onDismiss: (id: string) => void;
}

export function NotificationCenter({ notices, onDismiss }: NotificationCenterProps) {
  if (notices.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {notices.map((notice) => (
        <article key={notice.id} className={`toast ${notice.tone}`}>
          <div className="toast-header">
            <strong>{notice.title}</strong>
            <button type="button" className="toast-dismiss" onClick={() => onDismiss(notice.id)}>
              关闭
            </button>
          </div>
          <p className="panel-note">{notice.message}</p>
        </article>
      ))}
    </div>
  );
}