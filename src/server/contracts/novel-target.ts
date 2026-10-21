export interface NovelTarget {
  sourceId: string;
  novelId: string;
  fromUrl: boolean;
}

/** 仅解析已知域名和路径，不取网页；两端共用同一目标校验。 */
export function resolveNovelTarget(sourceId: string, input: string): NovelTarget {
  const value = input.trim();
  if (!value) throw new Error('请输入作品编号或 URL。');
  if (/^[\w-]+$/.test(value)) {
    const novelId = /^syosetu(?:18)?$/.test(sourceId) ? value.toLowerCase() : value;
    if (/^syosetu(?:18)?$/.test(sourceId) && !/^n\d+[a-z]+$/.test(novelId)) throw new Error('Syosetu 作品编号格式不正确。');
    if (sourceId === 'kakuyomu' && !/^\d+$/.test(novelId)) throw new Error('Kakuyomu 作品编号应为数字。');
    return { sourceId, novelId, fromUrl: false };
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('URL 格式不正确，请输入完整的 http(s) 地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('不支持此 URL，请使用站点的标准 http(s) 地址。');
  const host = url.hostname;
  if (host === 'ncode.syosetu.com' || host === 'novel18.syosetu.com') {
    const match = (/^\/(n\d+[a-z]+)(?:\/\d+)?\/?$/i.exec(url.pathname) ?? /^\/novelview\/infotop\/ncode\/(n\d+[a-z]+)\/?$/i.exec(url.pathname));
    if (match) return { sourceId: host === 'ncode.syosetu.com' ? 'syosetu' : 'syosetu18', novelId: match[1]!.toLowerCase(), fromUrl: true };
  } else if (host === 'kakuyomu.jp') {
    const match = /^\/works\/(\d+)(?:\/episodes\/\d+)?\/?$/.exec(url.pathname);
    if (match) return { sourceId: 'kakuyomu', novelId: match[1]!, fromUrl: true };
  } else {
    throw new Error('不支持此 URL 的站点。');
  }
  throw new Error('此地址不是可识别的作品目录、情报页或章节链接。');
}
