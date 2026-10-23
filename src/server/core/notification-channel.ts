import type { NotificationResult } from '../contracts/notification';
import type { StoredNotificationConfig } from './system-preferences';

/** 渠道只负责一次投递；超时、重试、去重和记录由通用服务统一管理。 */
export interface NotificationChannel {
  send(config: StoredNotificationConfig, text: string, signal: AbortSignal): Promise<NotificationResult>;
}
