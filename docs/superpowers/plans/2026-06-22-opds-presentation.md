# OPDS 表现层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建前端 OPDS 管理界面——独立路由页面 `OpdsDashboard`（启用开关、Cron 配置、上架书单 Modal、统计卡片、审计日志列表）+ 书库详情页 OPDS 可见性 Toggle。

**Architecture:** 新建 `OpdsDashboard` 组件 + `opds-dashboard-model` 视图模型。扩展 `api.ts` 新增 OPDS API 函数。扩展 `app-routes.ts`/`App.tsx`/`app-shell.tsx` 注册新路由。扩展 `library-detail-view.tsx` 新增 OPDS Toggle。

**Tech Stack:** React 19, Mantine v7, @tabler/icons-react, TypeScript strict

**Spec:** `docs/superpowers/specs/2026-06-22-opds-presentation-design.md`

---

## File Structure

| 文件 | 职责 | 操作 |
|---|---|---|
| `src/web/services/api.ts` | OPDS API 函数与类型 | Modify |
| `src/web/services/opds-dashboard-model.ts` | OPDS 仪表盘视图模型 | Create |
| `src/web/components/opds-dashboard.tsx` | OPDS 管理页面组件 | Create |
| `src/web/components/opds-dashboard.test.ts` | 组件测试 | Create |
| `src/web/services/app-routes.ts` | 新增 `/opds-dashboard` 路由 | Modify |
| `src/web/App.tsx` | 注册新路由 | Modify |
| `src/web/components/app-shell.tsx` | 导航栏新增入口 | Modify |
| `src/web/components/library-detail-view.tsx` | 快捷操作卡片新增 OPDS Toggle | Modify |

---

### Task 1: api.ts — OPDS API 函数与类型

**Files:**
- Modify: `src/web/services/api.ts`（在文件末尾 `buildRequestError` 函数之前追加 OPDS 段）

- [ ] **Step 1: 在 `api.ts` 末尾（`requestJson`/`requestVoid`/`buildRequestError` 工具函数之前）追加 OPDS API 段**

在 `// ── 定时更新调度 ──` 段之后、`async function requestJson` 之前追加：

```ts
// ── OPDS 书源服务 ──

export interface OpdsCompilationRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed';
  totalScanned: number;
  compiled: number;
  skipped: number;
  errored: number;
}

export interface OpdsConfig {
  enabled: boolean;
  scanCronExpression: string;
  updatedAt: string | null;
  lastRun: OpdsCompilationRun | null;
}

export interface OpdsNovelEntry {
  sourceId: string;
  novelId: string;
  title: string;
  opdsVisible: boolean;
  contentUpdatedAt: string | null;
  epubCompiledAt: string | null;
  hasTranslation: boolean;
}

export interface OpdsNovelsPayload {
  novels: OpdsNovelEntry[];
}

export interface OpdsRunsPayload {
  runs: OpdsCompilationRun[];
}

export interface NovelOpdsStatus {
  sourceId: string;
  novelId: string;
  title: string;
  opdsVisible: boolean;
  contentUpdatedAt: string | null;
  epubCompiledAt: string | null;
  hasTranslation: boolean;
}

export async function fetchOpdsConfig(): Promise<OpdsConfig> {
  return requestJson<OpdsConfig>('/api/control/preferences/opds');
}

export async function updateOpdsConfig(
  input: Partial<Pick<OpdsConfig, 'enabled' | 'scanCronExpression'>>,
): Promise<OpdsConfig> {
  const response = await fetch('/api/control/preferences/opds', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await buildRequestError(response, 'OPDS 配置更新失败');
  }
  return (await response.json()) as OpdsConfig;
}

export async function fetchOpdsNovels(): Promise<OpdsNovelsPayload> {
  return requestJson<OpdsNovelsPayload>('/api/library/opds/novels');
}

export async function updateOpdsNovels(
  entries: Array<{ sourceId: string; novelId: string; visible: boolean }>,
): Promise<{ ok: boolean }> {
  const response = await fetch('/api/library/opds/novels', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novels: entries }),
  });
  if (!response.ok) {
    throw await buildRequestError(response, 'OPDS 书单更新失败');
  }
  return (await response.json()) as { ok: boolean };
}

export async function fetchOpdsRuns(limit = 20, offset = 0): Promise<OpdsRunsPayload> {
  return requestJson<OpdsRunsPayload>(`/api/control/opds/runs?limit=${limit}&offset=${offset}`);
}

export async function fetchNovelOpdsStatus(
  sourceId: string,
  novelId: string,
): Promise<NovelOpdsStatus> {
  return requestJson<NovelOpdsStatus>(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/opds`,
  );
}

export async function updateNovelOpdsVisible(
  sourceId: string,
  novelId: string,
  visible: boolean,
): Promise<NovelOpdsStatus> {
  const response = await fetch(
    `/api/library/novels/${encodeURIComponent(sourceId)}/${encodeURIComponent(novelId)}/opds`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visible }),
    },
  );
  if (!response.ok) {
    throw await buildRequestError(response, 'OPDS 可见性更新失败');
  }
  return (await response.json()) as NovelOpdsStatus;
}
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 跳过 commit（项目规则禁止自动提交）**

---

### Task 2: opds-dashboard-model.ts — 视图模型

**Files:**
- Create: `src/web/services/opds-dashboard-model.ts`

- [ ] **Step 1: 实现视图模型**

创建 `src/web/services/opds-dashboard-model.ts`：

```ts
import { useCallback, useEffect, useState } from 'react';

import {
  fetchOpdsConfig,
  fetchOpdsNovels,
  fetchOpdsRuns,
  updateOpdsConfig as apiUpdateOpdsConfig,
  updateOpdsNovels as apiUpdateOpdsNovels,
  type OpdsCompilationRun,
  type OpdsConfig,
  type OpdsNovelEntry,
} from './api';

export interface OpdsDashboardModel {
  config: OpdsConfig | null;
  novels: OpdsNovelEntry[];
  runs: OpdsCompilationRun[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateConfig: (input: Partial<Pick<OpdsConfig, 'enabled' | 'scanCronExpression'>>) => Promise<void>;
  updateNovels: (entries: Array<{ sourceId: string; novelId: string; visible: boolean }>) => Promise<void>;
  loadMoreRuns: () => Promise<void>;
  hasMoreRuns: boolean;
}

const RUNS_PAGE_SIZE = 20;

export function useOpdsDashboardModel(): OpdsDashboardModel {
  const [config, setConfig] = useState<OpdsConfig | null>(null);
  const [novels, setNovels] = useState<OpdsNovelEntry[]>([]);
  const [runs, setRuns] = useState<OpdsCompilationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runsOffset, setRunsOffset] = useState(0);
  const [hasMoreRuns, setHasMoreRuns] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configResult, novelsResult, runsResult] = await Promise.all([
        fetchOpdsConfig(),
        fetchOpdsNovels(),
        fetchOpdsRuns(RUNS_PAGE_SIZE, 0),
      ]);
      setConfig(configResult);
      setNovels(novelsResult.novels);
      setRuns(runsResult.runs);
      setRunsOffset(RUNS_PAGE_SIZE);
      setHasMoreRuns(runsResult.runs.length === RUNS_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 OPDS 数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(
    async (input: Partial<Pick<OpdsConfig, 'enabled' | 'scanCronExpression'>>) => {
      const updated = await apiUpdateOpdsConfig(input);
      setConfig(updated);
    },
    [],
  );

  const updateNovels = useCallback(
    async (entries: Array<{ sourceId: string; novelId: string; visible: boolean }>) => {
      await apiUpdateOpdsNovels(entries);
      const novelsResult = await fetchOpdsNovels();
      setNovels(novelsResult.novels);
    },
    [],
  );

  const loadMoreRuns = useCallback(async () => {
    try {
      const more = await fetchOpdsRuns(RUNS_PAGE_SIZE, runsOffset);
      setRuns((prev) => [...prev, ...more.runs]);
      setRunsOffset((prev) => prev + RUNS_PAGE_SIZE);
      setHasMoreRuns(more.runs.length === RUNS_PAGE_SIZE);
    } catch {
      setHasMoreRuns(false);
    }
  }, [runsOffset]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    config,
    novels,
    runs,
    loading,
    error,
    refresh,
    updateConfig,
    updateNovels,
    loadMoreRuns,
    hasMoreRuns,
  };
}
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 跳过 commit（项目规则禁止自动提交）**

---

### Task 3: OpdsDashboard 组件

**Files:**
- Create: `src/web/components/opds-dashboard.tsx`

- [ ] **Step 1: 实现 OpdsDashboard 组件**

创建 `src/web/components/opds-dashboard.tsx`：

```tsx
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Grid,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconBookShare, IconClock, IconActivity } from '@tabler/icons-react';

import { CronEditor } from './cron-editor';
import { useOpdsDashboardModel } from '../services/opds-dashboard-model';
import type { NoticeInput } from '../services/control-center-model';

interface OpdsDashboardProps {
  onNotify: (notice: NoticeInput) => void;
}

function formatTimeAgo(isoTimestamp: string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天`;
}

function computeCronPreviews(expression: string): string[] {
  try {
    const parser = new CronEditor({ value: expression, onChange: () => {} });
    // CronEditor 内部用 cron-parser，这里直接用预览逻辑
    // 简化：返回空数组，实际预览由 CronEditor 组件自身渲染
    return [];
  } catch {
    return [];
  }
}

export function OpdsDashboard({ onNotify }: OpdsDashboardProps) {
  const model = useOpdsDashboardModel();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSelections, setModalSelections] = useState<Map<string, boolean>>(new Map());

  const stats = useMemo(() => {
    const visibleNovels = model.novels.filter((n) => n.opdsVisible);
    const visibleCount = visibleNovels.length;
    const translatedCount = visibleNovels.filter((n) => n.hasTranslation).length;
    return {
      visibleCount,
      originalCount: visibleCount,
      translatedCount,
      bilingualCount: translatedCount,
    };
  }, [model.novels]);

  if (model.loading && !model.config) {
    return (
      <Stack gap="lg" p="lg">
        <Text size="sm" c="dimmed">加载中...</Text>
      </Stack>
    );
  }

  if (model.error && !model.config) {
    return (
      <Stack gap="lg" p="lg">
        <Text size="sm" c="red">加载失败：{model.error}</Text>
        <Button variant="default" size="sm" onClick={() => void model.refresh()}>重试</Button>
      </Stack>
    );
  }

  const config = model.config;

  return (
    <Stack gap="lg" p="lg">
      {/* 页面标题区 */}
      <Paper
        p="lg"
        radius="lg"
        style={{
          background: 'rgba(31, 21, 16, 0.78)',
          border: '1px solid rgba(168,133,96,0.22)',
          backdropFilter: 'blur(18px)',
        }}
      >
        <Group mb="xs">
          <IconBookShare size={22} color="#ffd166" />
          <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>
            OPDS 书源
          </Text>
        </Group>
        <Title order={3} mb="xs">OPDS 书源服务</Title>
        <Text size="sm" c="dimmed" maw={640}>
          将书库中的作品通过 OPDS 协议分发给阅读器应用。开启后，支持 OPDS 1.2 与 2.0 的阅读器可通过书源地址浏览和下载。
        </Text>
      </Paper>

      {/* 配置区 */}
      <Paper p="lg" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Text size="sm" fw={600}>启用 OPDS 书源</Text>
              <Text size="xs" c="dimmed">开启后，后台将按扫描周期自动生成 EPUB 制品</Text>
            </Stack>
            <Switch
              checked={config?.enabled ?? false}
              onChange={(event) => {
                void model.updateConfig({ enabled: event.currentTarget.checked })
                  .then(() => {
                    onNotify({ tone: 'success', title: '已更新', message: event.currentTarget.checked ? 'OPDS 书源已开启' : 'OPDS 书源已关闭' });
                  })
                  .catch(() => {
                    onNotify({ tone: 'error', title: '操作失败', message: '无法更新 OPDS 配置' });
                  });
              }}
            />
          </Group>

          {config?.enabled && (
            <>
              <Stack gap="xs">
                <TextInput
                  label="扫描周期（Cron 表达式）"
                  value={config.scanCronExpression}
                  onChange={(event) => {
                    void model.updateConfig({ scanCronExpression: event.currentTarget.value })
                      .catch(() => {});
                  }}
                />
                <CronEditor
                  value={config.scanCronExpression}
                  onChange={(expr: string) => {
                    void model.updateConfig({ scanCronExpression: expr })
                      .catch(() => {});
                  }}
                />
                <Text size="xs" c="dimmed">
                  后台按此周期扫描上架书籍，当内容更新时间晚于制品生成时间时自动重构 EPUB。
                </Text>
              </Stack>

              <Button
                variant="default"
                size="compact-sm"
                onClick={() => {
                  const map = new Map(model.novels.map((n) => [`${n.sourceId}:${n.novelId}`, n.opdsVisible]));
                  setModalSelections(map);
                  setModalOpen(true);
                }}
              >
                管理上架书单
              </Button>
            </>
          )}
        </Stack>
      </Paper>

      {/* 统计卡片区 */}
      <Grid>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper p="md" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
            <Group gap="xs" mb={4}>
              <IconBookShare size={16} color="#ffd166" />
              <Text size="xs" c="dimmed">上架书籍</Text>
            </Group>
            <Title order={2}>{stats.visibleCount}</Title>
            <Text size="xs" c="dimmed">本作品已公开分发</Text>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper p="md" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
            <Group gap="xs" mb={4}>
              <IconActivity size={16} color="#7fd0ff" />
              <Text size="xs" c="dimmed">版本分布</Text>
            </Group>
            <Group gap="xs">
              <Badge variant="light" color="gray">原文 {stats.originalCount}</Badge>
              <Badge variant="light" color="blue">译文 {stats.translatedCount}</Badge>
              <Badge variant="light" color="blue">双语 {stats.bilingualCount}</Badge>
            </Group>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <Paper p="md" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
            <Group gap="xs" mb={4}>
              <IconClock size={16} color="#61d4a6" />
              <Text size="xs" c="dimmed">最近扫描</Text>
            </Group>
            {config?.lastRun ? (
              <Stack gap={2}>
                <Text size="sm" fw={600}>
                  {config.lastRun.status === 'completed' ? '已完成' : '进行中'}
                  {config.lastRun.completedAt && ` · ${formatTimeAgo(config.lastRun.completedAt)}前`}
                </Text>
                <Text size="xs" c="dimmed">
                  扫描 {config.lastRun.totalScanned} · 生成 {config.lastRun.compiled} · 跳过 {config.lastRun.skipped} · 出错 {config.lastRun.errored}
                </Text>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">暂无扫描记录</Text>
            )}
          </Paper>
        </Grid.Col>
      </Grid>

      {/* 审计日志列表 */}
      <Paper p="lg" radius="md" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Text size="sm" fw={600} mb="md">扫描审计日志</Text>
        {model.runs.length === 0 ? (
          <Text size="sm" c="dimmed">暂无审计记录</Text>
        ) : (
          <Stack gap="md">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>开始时间</Table.Th>
                  <Table.Th>完成时间</Table.Th>
                  <Table.Th>扫描</Table.Th>
                  <Table.Th>生成</Table.Th>
                  <Table.Th>跳过</Table.Th>
                  <Table.Th>出错</Table.Th>
                  <Table.Th>状态</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {model.runs.map((run) => (
                  <Table.Tr key={run.id}>
                    <Table.Td>{formatTimeAgo(run.startedAt)}前</Table.Td>
                    <Table.Td>{run.completedAt ? `${formatTimeAgo(run.completedAt)}前` : '—'}</Table.Td>
                    <Table.Td>{run.totalScanned}</Table.Td>
                    <Table.Td>{run.compiled}</Table.Td>
                    <Table.Td>{run.skipped}</Table.Td>
                    <Table.Td>{run.errored}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={run.status === 'completed' ? 'green' : 'yellow'}>
                        {run.status === 'completed' ? '已完成' : '进行中'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {model.hasMoreRuns && (
              <Button variant="default" size="compact-sm" onClick={() => void model.loadMoreRuns()}>
                加载更多
              </Button>
            )}
          </Stack>
        )}
      </Paper>

      {/* 上架书单 Modal */}
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title="管理 OPDS 上架书单"
        size="lg"
      >
        <Stack gap="xs">
          <ScrollArea.Autosize mah={420} type="scroll">
            <Stack gap="xs">
              {model.novels.map((novel) => {
                const key = `${novel.sourceId}:${novel.novelId}`;
                return (
                  <Paper
                    key={key}
                    p="sm"
                    radius="sm"
                    style={{ border: '1px solid rgba(168,133,96,0.15)' }}
                  >
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Stack gap={2}>
                        <Text size="sm" fw={500}>{novel.title}</Text>
                        <Text size="xs" c="dimmed">{novel.sourceId}/{novel.novelId}</Text>
                      </Stack>
                      <Switch
                        size="sm"
                        checked={modalSelections.get(key) ?? false}
                        onChange={(event) => {
                          setModalSelections((prev) => {
                            const next = new Map(prev);
                            next.set(key, event.currentTarget.checked);
                            return next;
                          });
                        }}
                      />
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setModalOpen(false)}>取消</Button>
          <Button
            color="brand"
            onClick={async () => {
              const entries = [...modalSelections.entries()]
                .map(([key, visible]) => {
                  const [sourceId, novelId] = key.split(':');
                  return { sourceId: sourceId ?? '', novelId: novelId ?? '', visible };
                })
                .filter((e) => e.sourceId !== '' && e.novelId !== '');
              try {
                await model.updateNovels(entries);
                setModalOpen(false);
                onNotify({ tone: 'success', title: '已保存', message: 'OPDS 上架书单已更新。' });
              } catch {
                onNotify({ tone: 'error', title: '保存失败', message: '无法保存书单，请重试。' });
              }
            }}
          >
            保存
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
```

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 跳过 commit（项目规则禁止自动提交）**

> 注：`computeCronPreviews` 函数是占位，实际 Cron 预览由 `CronEditor` 组件自身渲染。如果 typecheck 报未使用，可移除该函数。

---

### Task 4: 路由注册与导航入口

**Files:**
- Modify: `src/web/services/app-routes.ts`
- Modify: `src/web/App.tsx`
- Modify: `src/web/components/app-shell.tsx`

- [ ] **Step 1: 在 `app-routes.ts` 的 `AppRouteId` 类型与 `APP_ROUTES` 数组中新增 OPDS 路由**

修改 `AppRouteId`：

```ts
export type AppRouteId = 'control' | 'library' | 'monitor' | 'opds' | 'settings';
```

在 `APP_ROUTES` 数组中 `monitor` 项之后、`settings` 项之前追加：

```ts
  {
    id: 'opds',
    path: '/opds-dashboard',
    label: 'OPDS 书源',
    title: 'OPDS 书源',
    description: '管理 OPDS 书源服务，将书库作品分发给阅读器应用。',
  },
```

- [ ] **Step 2: 在 `App.tsx` 中导入 `OpdsDashboard` 并注册路由渲染**

在 import 区追加：

```ts
import { OpdsDashboard } from './components/opds-dashboard';
```

在 `AppShell` 子内容区，`{activeRoute.id === 'monitor' ? ...}` 之后、`{activeRoute.id === 'settings' ? ...}` 之前追加：

```tsx
        {activeRoute.id === 'opds' ? (
          <OpdsDashboard onNotify={pushNotice} />
        ) : null}
```

- [ ] **Step 3: 在 `app-shell.tsx` 中新增 OPDS 路由图标**

在 import 区追加 `IconBookShare`：

```ts
  IconBookShare,
```

在 `ROUTE_ICONS` 对象中追加：

```ts
  opds: IconBookShare,
```

- [ ] **Step 4: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: 跳过 commit（项目规则禁止自动提交）**

---

### Task 5: LibraryDetailView — OPDS 可见性 Toggle

**Files:**
- Modify: `src/web/components/library-detail-view.tsx`

- [ ] **Step 1: 在 import 区追加 OPDS API 导入**

在现有 `fetchNovelScheduling,` / `updateNovelScheduling,` 附近追加：

```ts
  fetchNovelOpdsStatus,
  updateNovelOpdsVisible,
  type NovelOpdsStatus,
```

- [ ] **Step 2: 在组件 state 区追加 `opdsStatus`**

在 `const [schedulingDetail, setSchedulingDetail] = useState<SchedulingNovelDetail | null>(null);` 之后追加：

```ts
  const [opdsStatus, setOpdsStatus] = useState<NovelOpdsStatus | null>(null);
```

- [ ] **Step 3: 在加载定时更新状态的 useEffect 旁追加 OPDS 状态加载**

在 `fetchNovelScheduling(detail.sourceId, detail.metadata.novelId).then(setSchedulingDetail).catch(() => {});` 的 useEffect 中追加并行加载：

```ts
    fetchNovelOpdsStatus(detail.sourceId, detail.metadata.novelId)
      .then(setOpdsStatus)
      .catch(() => {});
```

（与 `fetchNovelScheduling` 并行，可放入同一个 `Promise.all` 或追加一条 `.then` 链）

- [ ] **Step 4: 在「定时更新」Paper 卡片之后追加 OPDS Paper 卡片**

在定时更新 Paper 卡片（含 `schedulingDetail` 的那个 `</Paper>`）之后追加：

```tsx
        {/* ====== OPDS 公开分发 ====== */}
        <Paper
          p="sm"
          radius="md"
          style={{
            border: '1px solid rgba(127,208,255,0.30)',
            background: 'rgba(127,208,255,0.04)',
            minWidth: 180,
          }}
        >
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Stack gap={2}>
              <Text size="xs" fw={600} style={{ color: '#7fd0ff' }}>
                📚 OPDS 分发
              </Text>
              <Text size="xs" c="dimmed">
                {opdsStatus?.opdsVisible ? '已上架' : '开启后对阅读器可见'}
              </Text>
            </Stack>
            <Switch
              size="sm"
              checked={opdsStatus?.opdsVisible ?? false}
              onChange={(event) => {
                const next = event.currentTarget.checked;
                setOpdsStatus((prev) => prev ? { ...prev, opdsVisible: next } : null);
                updateNovelOpdsVisible(detail.sourceId, detail.metadata.novelId, next)
                  .then(setOpdsStatus)
                  .catch(() => {
                    setOpdsStatus((prev) => prev ? { ...prev, opdsVisible: !next } : null);
                  });
              }}
            />
          </Group>
        </Paper>
```

- [ ] **Step 5: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: 跳过 commit（项目规则禁止自动提交）**

---

### Task 6: 组件测试

**Files:**
- Create: `src/web/components/opds-dashboard.test.ts`

- [ ] **Step 1: 先读取现有前端测试模式**

Read `src/web/components/cron-editor.test.ts` or `src/web/components/llm-provider-panel.test.ts` to understand the test pattern (tsx --test, imports, render approach).

- [ ] **Step 2: 编写 OpdsDashboard 组件测试**

创建 `src/web/components/opds-dashboard.test.ts`，适配现有模式。核心测试用例：

1. `OpdsDashboard` loading 状态显示「加载中...」
2. `OpdsDashboard` 渲染标题「OPDS 书源服务」
3. `OpdsDashboard` 统计卡片显示正确数字
4. `OpdsDashboard` 空审计日志显示「暂无审计记录」
5. `OpdsDashboard` 审计日志表格渲染 runs

由于组件依赖 `useOpdsDashboardModel` hook（内部有 useEffect 调用 fetch），测试需要 mock fetch 或 mock 模型。参考现有测试模式决定具体做法。

> 注：如果现有前端测试不使用 jsdom/react-testing-library，而是纯函数测试，则改为测试 `opds-dashboard-model.ts` 的纯逻辑（如统计计算函数）或 `api.ts` 的 OPDS 函数。先读取现有测试模式再决定。

- [ ] **Step 3: 运行测试验证通过**

Run: `npx tsx --test src/web/components/opds-dashboard.test.ts`
Expected: PASS

- [ ] **Step 4: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: 跳过 commit（项目规则禁止自动提交）**

---

### Task 7: 最终验证 — typecheck + build + 全量测试

- [ ] **Step 1: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 2: 运行 build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: 运行全量服务端测试**

Run: `npm run test:server`
Expected: PASS（无回归）

- [ ] **Step 4: 运行全量前端测试**

Run: `npm run test:web`
Expected: PASS

- [ ] **Step 5: 运行 CI 脚本测试**

Run: `npm run test:ci`
Expected: PASS

---

## Self-Review

**Spec coverage:**
- §2.1 `OpdsDashboard` 组件 → Task 3 ✓
- §2.1 `opds-dashboard-model.ts` → Task 2 ✓
- §2.2 `api.ts` OPDS API → Task 1 ✓
- §2.2 `app-routes.ts` → Task 4 ✓
- §2.2 `App.tsx` → Task 4 ✓
- §2.2 `app-shell.tsx` → Task 4 ✓
- §2.2 `library-detail-view.tsx` Toggle → Task 5 ✓
- §3 API 扩展与视图模型 → Task 1 + 2 ✓
- §4 OpdsDashboard 组件布局 → Task 3 ✓
- §5 路由注册与详情页 Toggle → Task 4 + 5 ✓
- §6 测试策略 → Task 6 ✓

**Placeholder scan:** `computeCronPreviews` 函数是占位（CronEditor 自身渲染预览），已在 Task 3 注释说明可移除。其余无 TBD/TODO。

**Type consistency:** `OpdsConfig`、`OpdsCompilationRun`、`OpdsNovelEntry`、`NovelOpdsStatus`、`useOpdsDashboardModel`、`OpdsDashboard` 命名前后一致。
