export type AppRouteId = 'control' | 'library' | 'monitor' | 'scheduling' | 'opds' | 'settings';

export interface AppLocation {
  route: AppRouteDefinition;
  path: string;
  view: 'page' | 'detail' | 'reader';
  sourceId: string | null;
  novelId: string | null;
  chapterId: string | null;
}

export interface AppRouteDefinition {
  id: AppRouteId;
  path: string;
  label: string;
  title: string;
  description: string;
}

export const APP_ROUTES: AppRouteDefinition[] = [
  {
    id: 'control',
    path: '/',
    label: '采集工作台',
    title: '采集工作台',
    description: '选择站点和作品后，先查看目录，再挑选章节开始采集。',
  },
  {
    id: 'library',
    path: '/library',
    label: '本地书库',
    title: '本地书库',
    description: '查看已采集的小说，补抓缺失章节，或直接开始阅读。',
  },
  {
    id: 'monitor',
    path: '/monitor',
    label: '任务大盘',
    title: '任务大盘',
    description: '查看当前采集进度、最近任务记录，以及失败章节的重试情况。',
  },
  {
    id: 'scheduling',
    path: '/scheduling',
    label: '定时更新',
    title: '定时更新管理',
    description: '自动检查书库里的作品更新，统一管理追更、自动翻译和更新总结。',
  },
  {
    id: 'opds',
    path: '/opds-dashboard',
    label: 'OPDS 书源',
    title: 'OPDS 书源',
    description: '管理 OPDS 书源服务，将书库作品分发给阅读器应用。',
  },
  {
    id: 'settings',
    path: '/settings',
    label: '全局设置',
    title: '全局设置',
    description: '调整默认采集方式、LLM 模型、代理等全局偏好配置。',
  },
];

export function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim();

  if (trimmed.length === 0 || trimmed === '/') {
    return '/';
  }

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export function resolveAppRoute(pathname: string): AppRouteDefinition {
  return resolveAppLocation(pathname).route;
}

export function resolveAppLocation(pathname: string): AppLocation {
  const normalizedPath = normalizePathname(pathname);
  const fallbackRoute = APP_ROUTES[0];

  if (!fallbackRoute) {
    throw new Error('APP_ROUTES must define at least one route.');
  }

  const libraryRoute = APP_ROUTES.find((route) => route.id === 'library');

  if (!libraryRoute) {
    throw new Error('APP_ROUTES must define a library route.');
  }

  const readerMatch = normalizedPath.match(/^\/library\/([^/]+)\/([^/]+)\/read\/([^/]+)$/);
  if (readerMatch) {
    return {
      route: libraryRoute,
      path: normalizedPath,
      view: 'reader',
      sourceId: decodeURIComponent(readerMatch[1] ?? ''),
      novelId: decodeURIComponent(readerMatch[2] ?? ''),
      chapterId: decodeURIComponent(readerMatch[3] ?? ''),
    };
  }

  const detailMatch = normalizedPath.match(/^\/library\/([^/]+)\/([^/]+)$/);
  if (detailMatch) {
    return {
      route: libraryRoute,
      path: normalizedPath,
      view: 'detail',
      sourceId: decodeURIComponent(detailMatch[1] ?? ''),
      novelId: decodeURIComponent(detailMatch[2] ?? ''),
      chapterId: null,
    };
  }

  const route = APP_ROUTES.find((candidate) => candidate.path === normalizedPath) ?? fallbackRoute;

  return {
    route,
    path: route.path,
    view: 'page',
    sourceId: null,
    novelId: null,
    chapterId: null,
  };
}

export function buildLibraryNovelPath(sourceId: string, novelId: string): string {
  return `/library/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}`;
}

export function buildLibraryReaderPath(sourceId: string, novelId: string, chapterId: string): string {
  return `${buildLibraryNovelPath(sourceId, novelId)}/read/${encodeURIComponent(chapterId)}`;
}