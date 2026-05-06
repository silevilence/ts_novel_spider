import { Syosetu18SpiderAdapter } from './syosetu-18-spider-adapter';

/**
 * Syosetu 本站与 Syosetu18 共享目录与正文 DOM 结构，仅域名与成年 Cookie 不同。
 */
export class SyosetuSpiderAdapter extends Syosetu18SpiderAdapter {
  readonly sourceId: string = 'syosetu';

  protected override get infoPageBaseUrl(): string {
    return 'https://ncode.syosetu.com/novelview/infotop/ncode/';
  }

  protected override get novelPageBaseUrl(): string {
    return 'https://ncode.syosetu.com';
  }

  protected override get cookieHeader(): string | undefined {
    return undefined;
  }
}