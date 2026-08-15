import type { ApiTaskSnapshot } from '../../server/routes/control-center';

const ACTIVE_TASK_STATUSES: ReadonlySet<ApiTaskSnapshot['status']> = new Set([
  'queued', 'running', 'paused', 'waiting_user',
]);

const TASK_STATUS_LABELS: Record<ApiTaskSnapshot['status'], string> = {
  queued: '排队中',
  running: '执行中',
  paused: '已暂停',
  waiting_user: '等待人工处理',
  completed: '已采集',
  failed: '已失败',
  aborted: '已中止',
};

export function isActiveTaskStatus(status: ApiTaskSnapshot['status']): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}

export function formatTaskStatus(status: ApiTaskSnapshot['status']): string {
  return TASK_STATUS_LABELS[status];
}
