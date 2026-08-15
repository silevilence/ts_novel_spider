import '../shared/styles.css';
import { DEFAULT_SETTINGS, loadSettings } from '../shared/bridge';

const form = document.querySelector<HTMLFormElement>('#bridge-settings');
const status = document.querySelector<HTMLOutputElement>('#save-status');
const serverUrlInput = document.querySelector<HTMLInputElement>('#server-url');
const tokenInput = document.querySelector<HTMLInputElement>('#pairing-token');
const unpairButton = document.querySelector<HTMLButtonElement>('#unpair');
const developerModeInput = document.querySelector<HTMLInputElement>('#developer-mode');

void hydrate();

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!serverUrlInput || !tokenInput) return;
  try {
    setStatus('正在配对…');
    const serverUrl = normalizeServerUrl(serverUrlInput.value);
    const response = await fetch(`${serverUrl}/api/browser/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenInput.value.trim(), name: navigator.userAgent.includes('Edg/') ? 'Microsoft Edge 扩展' : 'Google Chrome 扩展' }),
    });
    const payload = await response.json() as { key?: string; pairing?: { id: string }; message?: string };
    if (!response.ok || !payload.key || !payload.pairing) throw new Error(payload.message ?? '配对失败。');
    await chrome.storage.local.set({ serverUrl, pairingKey: payload.key, pairingId: payload.pairing.id });
    tokenInput.value = '';
    await chrome.runtime.sendMessage({ type: 'reconnect' });
    setStatus('配对成功，长期密钥已安全保存在扩展本地存储中。');
    unpairButton?.removeAttribute('disabled');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

unpairButton?.addEventListener('click', async () => {
  const settings = await loadSettings();
  try {
    if (settings.pairingKey) {
      const response = await fetch(`${settings.serverUrl}/api/browser/pairing`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${settings.pairingKey}` },
      });
      if (!response.ok && response.status !== 401) throw new Error(`服务端撤销失败（${response.status}）。`);
    }
    await chrome.storage.local.set(DEFAULT_SETTINGS);
    await chrome.runtime.sendMessage({ type: 'reconnect' });
    setStatus('已解绑并删除扩展本地密钥。');
    unpairButton?.setAttribute('disabled', 'true');
  } catch (error) {
    setStatus(`解绑未完成，本地密钥已保留：${error instanceof Error ? error.message : String(error)}`, true);
  }
});

developerModeInput?.addEventListener('change', async () => {
  await chrome.storage.local.set({ developerMode: developerModeInput.checked });
  setStatus(developerModeInput.checked ? '开发数据导出已启用。' : '开发数据导出已关闭。');
});

async function hydrate(): Promise<void> {
  const settings = await loadSettings();
  if (serverUrlInput) serverUrlInput.value = settings.serverUrl;
  if (developerModeInput) developerModeInput.checked = settings.developerMode;
  if (settings.pairingKey) {
    setStatus('已配对。可返回扩展弹窗查看连接状态。');
    unpairButton?.removeAttribute('disabled');
  }
}

function normalizeServerUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('服务地址必须使用 http 或 https。');
  return url.origin;
}

function setStatus(message: string, error = false): void {
  if (!status) return;
  status.textContent = message;
  status.dataset.error = String(error);
}
