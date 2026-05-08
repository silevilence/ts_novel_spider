export type AppRouteId = 'control' | 'monitor' | 'settings';

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
    label: '开始抓取',
    title: '开始抓取',
    description: '选择站点和作品后，先查看目录，再挑选章节开始下载。',
  },
  {
    id: 'monitor',
    path: '/monitor',
    label: '任务进度',
    title: '任务进度',
    description: '查看当前下载进度、最近任务记录，以及失败章节的重试情况。',
  },
  {
    id: 'settings',
    path: '/settings',
    label: '下载设置',
    title: '下载设置',
    description: '调整默认下载方式和代理设置，修改后会用于后续任务。',
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
  const normalizedPath = normalizePathname(pathname);
  const fallbackRoute = APP_ROUTES[0];

  if (!fallbackRoute) {
    throw new Error('APP_ROUTES must define at least one route.');
  }

  return APP_ROUTES.find((route) => route.path === normalizedPath) ?? fallbackRoute;
}