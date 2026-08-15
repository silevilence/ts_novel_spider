import '../shared/styles.css';
import {
  describeBridgeProgress,
  loadSettings,
  originPattern,
  type BridgeRuntimeState,
  type BridgeTaskState,
  type RuntimeMessage,
} from '../shared/bridge';

const openOptionsButton = document.querySelector<HTMLButtonElement>('#open-options');
const connection = document.querySelector<HTMLElement>('#connection-state');
const taskState = document.querySelector<HTMLElement>('#task-state');
const nextStep = document.querySelector<HTMLElement>('#next-step');
const target = document.querySelector<HTMLElement>('#target-url');
const grantButton = document.querySelector<HTMLButtonElement>('#grant-site');
const catalogButton = document.querySelector<HTMLButtonElement>('#open-catalog');
const saveButton = document.querySelector<HTMLButtonElement>('#save-page');
const pauseButton = document.querySelector<HTMLButtonElement>('#pause-task');
const continueButton = document.querySelector<HTMLButtonElement>('#continue-task');
const abortButton = document.querySelector<HTMLButtonElement>('#abort-task');
const exportButton = document.querySelector<HTMLButtonElement>('#export-html');
const cookiesButton = document.querySelector<HTMLButtonElement>('#read-cookies');
const developerOutput = document.querySelector<HTMLTextAreaElement>('#developer-output');
const developerTools = document.querySelector<HTMLDetailsElement>('#developer-tools');

let currentState: BridgeRuntimeState | null = null;

openOptionsButton?.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

grantButton?.addEventListener('click', async () => {
  const url = await resolveTargetUrl();
  if (!url) return;
  const granted = await chrome.permissions.request({ origins: [originPattern(url)] });
  if (granted) {
    await send(currentState?.taskId ? { type: 'task_control', action: 'continue' } : { type: 'capture_pending' });
  }
  await refresh();
});
catalogButton?.addEventListener('click', () => void send({ type: 'open_catalog' }));
saveButton?.addEventListener('click', () => void runAction(async () => { await send({ type: 'capture_pending' }); }));
pauseButton?.addEventListener('click', () => void send({ type: 'task_control', action: 'pause' }));
continueButton?.addEventListener('click', () => void send(currentState?.taskId
  ? { type: 'task_control', action: 'continue' }
  : { type: 'capture_pending' }));
abortButton?.addEventListener('click', () => void send({ type: 'task_control', action: 'abort' }));
exportButton?.addEventListener('click', () => void runAction(async () => {
  const response = await send({ type: 'developer_export_html' }) as { fileName?: string };
  if (developerOutput) developerOutput.value = response.fileName ? `已导出：${response.fileName}` : 'HTML 已导出。';
}));
cookiesButton?.addEventListener('click', () => void runAction(async () => {
  const response = await send({ type: 'developer_read_cookies' }) as { cookies?: string };
  const cookies = response.cookies ?? '';
  if (cookies) await navigator.clipboard.writeText(cookies);
  if (developerOutput) developerOutput.value = cookies ? `${cookies}\n\n（已复制到剪贴板）` : '当前页面没有 Cookie。';
}));

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (message && typeof message === 'object' && (message as { type?: string }).type === 'state_changed') void refresh();
});

async function refresh(): Promise<void> {
  const settings = await loadSettings();
  if (developerTools) developerTools.hidden = !settings.developerMode;
  const response = await send({ type: 'get_state' }) as { state?: BridgeRuntimeState };
  currentState = response.state ?? null;
  if (!currentState) return;
  if (connection) {
    connection.textContent = currentState.connected ? '已连接' : '未连接';
    connection.dataset.connected = String(currentState.connected);
  }
  const progress = describeBridgeProgress(currentState);
  if (taskState) taskState.textContent = `${progress.title} · ${formatTaskState(currentState.taskState)}`;
  if (nextStep) nextStep.textContent = progress.nextStep;
  if (saveButton) saveButton.textContent = progress.saveLabel;
  if (target) target.textContent = currentState.currentUrl || '—';
  const hasTask = Boolean(currentState.taskId);
  pauseButton?.toggleAttribute('disabled', !hasTask || currentState.taskState !== 'running');
  continueButton?.toggleAttribute('disabled', !currentState.pendingRequestId && (!hasTask || !['paused', 'waiting_user'].includes(currentState.taskState)));
  abortButton?.toggleAttribute('disabled', !hasTask);
  saveButton?.toggleAttribute('disabled', !currentState.pendingRequestId);
  if (catalogButton) catalogButton.textContent = currentState.catalogUrl ? '打开目录' : '下一步：目录';
  catalogButton?.toggleAttribute('disabled', !currentState.catalogUrl);
  grantButton?.toggleAttribute('disabled', !currentState.currentUrl);
}

async function resolveTargetUrl(): Promise<string | null> {
  if (currentState?.currentUrl) return currentState.currentUrl;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? null;
}

async function send(message: RuntimeMessage): Promise<unknown> {
  const response = await chrome.runtime.sendMessage(message) as { ok?: boolean; message?: string };
  if (response?.ok === false) throw new Error(response.message ?? '扩展操作失败。');
  return response;
}

async function runAction(action: () => Promise<void>): Promise<void> {
  try { await action(); } catch (error) { if (developerOutput) developerOutput.value = error instanceof Error ? error.message : String(error); }
}

function formatTaskState(value: BridgeTaskState): string {
  const labels: Record<BridgeTaskState, string> = {
    idle: '空闲', queued: '排队中', running: '执行中', paused: '已暂停', waiting_user: '等待人工处理',
    completed: '已完成', failed: '已失败', aborted: '已中止',
  };
  return labels[value];
}

void refresh();
