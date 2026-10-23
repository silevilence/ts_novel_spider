import { z } from 'zod';

/** 首版一个渠道与一个目标；业务事件不依赖渠道鉴权或 HTTP 协议。 */
export interface NotificationEvent {
  id: string;
  kind: string;
  sourceId: string;
  novelId: string;
  runId: string;
  title: string;
  summary: string;
  occurredAt: string;
  error: boolean;
  update?: { discovered: number; downloaded: number; failed: number; enabled: boolean };
}

export const notificationInputSchema = z.object({
  enabled: z.boolean(),
  errorEnabled: z.boolean(),
  channel: z.literal('astrbot'),
  baseUrl: z.string().trim().max(2048).refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }, '服务地址必须为不含凭据、查询或片段的 HTTP(S) 地址'),
  target: z.object({ umo: z.string().trim().max(1024).refine(
    (value) => !value || /^[^\s:]+:[^\s:]+:\S+$/.test(value), 'UMO 应为 平台:消息类型:会话标识',
  ) }),
  keyAction: z.enum(['keep', 'replace', 'clear']),
  apiKey: z.string().trim().max(4096).refine((value) => !/[\r\n]/.test(value), 'API Key 不能包含换行').optional(),
}).superRefine((value, ctx) => {
  if (value.keyAction === 'replace' && !value.apiKey) ctx.addIssue({ code: 'custom', path: ['apiKey'], message: '请输入新 API Key' });
  if (value.enabled && (!value.baseUrl || !value.target.umo || value.keyAction === 'clear')) {
    ctx.addIssue({ code: 'custom', message: '启用通知需要服务地址、API Key 和目标 UMO' });
  }
});

export type NotificationConfigInput = z.infer<typeof notificationInputSchema>;
export interface NotificationConfig {
  enabled: boolean;
  errorEnabled: boolean;
  channel: 'astrbot';
  baseUrl: string;
  target: { umo: string };
  keyConfigured: boolean;
}

export interface NotificationResult {
  status: 'accepted' | 'failed' | 'unknown';
  category: 'accepted' | 'configuration' | 'authentication' | 'unavailable' | 'rejected' | 'timeout' | 'interrupted';
  message: string;
  retryable: boolean;
  path?: string;
  apiVersion?: string;
}

export interface NotificationRecord {
  id: string;
  event: NotificationEvent;
  channel: string;
  target: { umo: string };
  status: 'queued' | 'sending' | 'skipped' | NotificationResult['status'];
  attempts: number;
  createdAt: string;
  updatedAt: string;
  result: NotificationResult | null;
}

export interface KnownNotificationTarget { umo: string; label: string }
export interface KnownNotificationTargets { targets: KnownNotificationTarget[]; message: string }
