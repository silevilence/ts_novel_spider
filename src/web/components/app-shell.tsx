import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import {
  AppShell as MantineAppShell,
  Burger,
  Button,
  Group,
  Text,
  Title,
  Badge,
  Stack,
  Paper,
  Indicator,
  useMantineTheme,
  Tooltip,
  ActionIcon,
  rem,
} from '@mantine/core';
import {
  IconSpider,
  IconBook,
  IconBooks,
  IconActivity,
  IconSettings,
  IconChevronLeft,
  IconChevronRight,
  IconServer,
  IconPlayerPlay,
  IconWorld,
  IconClock,
  IconWriting,
} from '@tabler/icons-react';
import type { HealthPayload } from '../../server/routes/health';
import type { ApiTaskSnapshot } from '../../server/routes/control-center';
import type { AppRouteDefinition } from '../services/app-routes';
import { formatTaskStatus } from '../services/task-status';

interface AppShellProps {
  routes: AppRouteDefinition[];
  activeRoute: AppRouteDefinition;
  onNavigate: (path: string) => void;
  health: HealthPayload | null;
  errorMessage: string | null;
  sourceCount: number;
  currentTask: ApiTaskSnapshot | null;
  getSourceLabel: (sourceId: string) => string;
  children: React.ReactNode;
}
const ROUTE_ICONS: Record<string, React.FC<{ size?: number }>> = {
  control: IconSpider,
  library: IconBooks,
  'refined-translation': IconWriting,
  monitor: IconActivity,
  scheduling: IconClock,
  opds: IconBook,
  settings: IconSettings,
};

function RouteIcon({ routeId, size = 18 }: { routeId: string; size?: number }) {
  const Icon = ROUTE_ICONS[routeId];
  if (!Icon) return null;
  return <Icon size={size} />;
}

export function AppShell({
  routes,
  activeRoute,
  onNavigate,
  health,
  errorMessage,
  sourceCount,
  currentTask,
  getSourceLabel,
  children,
}: AppShellProps) {
  const theme = useMantineTheme();
  const [asideOpen, { toggle: toggleAside, close: closeAside }] = useDisclosure(false);
  const [navOpen, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const currentTaskLabel = currentTask
    ? `${getSourceLabel(currentTask.sourceId)} / ${formatTaskStatus(currentTask.status)}`
    : '空闲';
  const isConnected = health?.status === 'ok';
  const hasActiveTask = currentTask?.status === 'running' || currentTask?.status === 'queued';

  const handleNavigate = (path: string) => {
    onNavigate(path);
    closeNav();
  };

  return (
    <MantineAppShell
      header={{ height: 56 }}
      navbar={{
        width: 220,
        breakpoint: 'sm',
        collapsed: { desktop: true, mobile: !navOpen },
      }}
      aside={{
        width: 280,
        breakpoint: 'sm',
        collapsed: { desktop: !asideOpen, mobile: true },
      }}
      footer={{ height: isMobile ? 56 : 0 }}
      padding={0}
    >
      {/* ── 顶部导航栏 ── */}
      <MantineAppShell.Header
        style={{
          background: 'rgba(15, 10, 8, 0.94)',
          backdropFilter: 'blur(18px)',
          borderBottom: `1px solid ${theme.other.lineColor}`,
        }}
      >
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          {/* 左侧：品牌 + 移动端汉堡 */}
          <Group gap="xs" wrap="nowrap">
            <Burger opened={navOpen} onClick={toggleNav} size="sm" hiddenFrom="sm" aria-label="打开导航菜单" />
            <Group gap={6} wrap="nowrap">
              <IconSpider size={22} color={theme.other.accentStrong as string} />
              <Text fw={700} size="sm" style={{ letterSpacing: '0.06em', color: theme.other.accentStrong as string }} visibleFrom="sm">
                TS Novel Spider
              </Text>
            </Group>
          </Group>

          {/* 中间：桌面端导航 pills */}
          <Group gap={4} wrap="nowrap" visibleFrom="sm">
            {routes.map((route) => {
              const isActive = route.id === activeRoute.id;
              return (
                <Button
                  key={route.id}
                  variant={isActive ? 'filled' : 'subtle'}
                  size="compact-sm"
                  color={isActive ? 'brand' : 'gray'}
                  leftSection={<RouteIcon routeId={route.id} size={16} />}
                  onClick={() => handleNavigate(route.path)}
                  style={{
                    fontWeight: isActive ? 700 : 500,
                    borderRadius: rem(20),
                    paddingInline: rem(14),
                  }}
                >
                  {route.label}
                </Button>
              );
            })}
          </Group>

          {/* 右侧：状态指示器 + 侧栏切换 */}
          <Group gap="xs" wrap="nowrap">
            <Tooltip label={`服务: ${isConnected ? '正常' : (errorMessage ?? '连接中')}`}>
              <Indicator color={isConnected ? 'green' : 'red'} size={8} withBorder>
                <ActionIcon variant="subtle" size="sm" color="gray">
                  <IconServer size={16} />
                </ActionIcon>
              </Indicator>
            </Tooltip>
            <Tooltip label={`任务: ${currentTaskLabel}`}>
              <Indicator color={hasActiveTask ? 'yellow' : 'gray'} size={8} withBorder processing={hasActiveTask}>
                <ActionIcon variant="subtle" size="sm" color="gray">
                  <IconPlayerPlay size={16} />
                </ActionIcon>
              </Indicator>
            </Tooltip>
            <ActionIcon
              variant="subtle"
              size="sm"
              color="gray"
              onClick={toggleAside}
              visibleFrom="sm"
            >
              {asideOpen ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
            </ActionIcon>
          </Group>
        </Group>
      </MantineAppShell.Header>

      {/* ── 移动端侧栏导航 ── */}
      <MantineAppShell.Navbar
        py="md"
        px="sm"
        style={{
          background: 'rgba(15, 10, 8, 0.96)',
          borderRight: `1px solid ${theme.other.lineColor}`,
        }}
      >
        <Stack gap={4}>
          {routes.map((route) => {
            const isActive = route.id === activeRoute.id;
            return (
              <Button
                key={route.id}
                variant={isActive ? 'light' : 'subtle'}
                color={isActive ? 'brand' : 'gray'}
                leftSection={<RouteIcon routeId={route.id} size={18} />}
                onClick={() => handleNavigate(route.path)}
                justify="flex-start"
                fullWidth
                style={{ fontWeight: isActive ? 700 : 500 }}
              >
                {route.label}
              </Button>
            );
          })}
        </Stack>
      </MantineAppShell.Navbar>

      {/* ── 主内容区 ── */}
      <MantineAppShell.Main
        style={{
          minHeight: '100vh',
          paddingTop: rem(56),
          paddingBottom: isMobile ? rem(56) : 0,
        }}
      >
        {/* 页面头部 */}
        <Paper
          py="lg"
          px="md"
          mx="auto"
          maw={1180}
          mt="md"
          mb="md"
          radius="lg"
          style={{
            background: 'rgba(31, 21, 16, 0.78)',
            border: `1px solid ${theme.other.lineColor}`,
            backdropFilter: 'blur(18px)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* 装饰光晕 */}
          <div
            style={{
              position: 'absolute',
              width: 320,
              height: 320,
              right: -100,
              top: -120,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255, 209, 102, 0.1), transparent 72%)',
              pointerEvents: 'none',
            }}
          />

          <Stack gap="xs" style={{ position: 'relative', zIndex: 1 }}>
            <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.14em', color: theme.other.accentStrong as string }}>
              TS Novel Spider
            </Text>
            <Title order={1} style={{ fontFamily: theme.headings.fontFamily }}>
              {activeRoute.title}
            </Title>
            <Text size="sm" c="dimmed" maw={640}>
              {activeRoute.description}
            </Text>

            {/* 摘要统计条 */}
            <Group gap="sm" mt="xs" wrap="wrap">
              <Badge
                variant="light"
                color={isConnected ? 'green' : 'red'}
                leftSection={<IconServer size={12} />}
                size="lg"
              >
                {isConnected ? '服务正常' : (errorMessage ?? '连接中')}
              </Badge>
              <Badge
                variant="light"
                color={hasActiveTask ? 'yellow' : 'gray'}
                leftSection={<IconPlayerPlay size={12} />}
                size="lg"
              >
                {currentTaskLabel}
              </Badge>
              <Badge variant="light" color="gray" leftSection={<IconWorld size={12} />} size="lg">
                {sourceCount > 0 ? `${sourceCount} 个站点` : '加载中'}
              </Badge>
              <Badge variant="light" color="gray" leftSection={<IconClock size={12} />} size="lg">
                {health?.timestamp ?? '等待响应'}
              </Badge>
            </Group>
          </Stack>
        </Paper>

        {/* 路由内容 */}
        <div style={{ padding: '0 1rem 2rem', maxWidth: 1180, margin: '0 auto' }}>
          {children}
        </div>
      </MantineAppShell.Main>

      {/* ── 桌面端右侧摘要栏 ── */}
      <MantineAppShell.Aside
        py="md"
        px="sm"
        style={{
          background: 'rgba(15, 10, 8, 0.94)',
          borderLeft: `1px solid ${theme.other.lineColor}`,
        }}
      >
        <Stack gap="md">
          <Title order={6} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.08em' }}>
            系统概览
          </Title>
          <SummaryCard
            label="服务状态"
            value={health?.status ?? (errorMessage ?? '连接中')}
            color={isConnected ? 'green' : 'red'}
          />
          <SummaryCard
            label="当前任务"
            value={currentTaskLabel}
            color={hasActiveTask ? 'yellow' : 'gray'}
          />
          <SummaryCard
            label="可用站点"
            value={sourceCount > 0 ? `${sourceCount} 个` : '加载中'}
            color="gray"
          />
          <SummaryCard
            label="最近更新"
            value={health?.timestamp ?? '等待响应'}
            color="gray"
          />
        </Stack>
      </MantineAppShell.Aside>

      {/* ── 移动端底部导航 ── */}
      <MantineAppShell.Footer
        hiddenFrom="sm"
        style={{
          background: 'rgba(15, 10, 8, 0.94)',
          backdropFilter: 'blur(18px)',
          borderTop: `1px solid ${theme.other.lineColor}`,
        }}
      >
        <Group h="100%" px="xs" justify="space-around" wrap="nowrap" gap={0}>
          {routes.map((route) => {
            const isActive = route.id === activeRoute.id;
            return (
              <Button
                key={route.id}
                variant="subtle"
                size="compact-sm"
                color={isActive ? 'brand' : 'gray'}
                onClick={() => handleNavigate(route.path)}
                style={{
                  flexDirection: 'column',
                  height: '100%',
                  gap: 2,
                  fontWeight: isActive ? 700 : 500,
                  fontSize: rem(11),
                }}
              >
                <RouteIcon routeId={route.id} size={18} />
                {route.label}
              </Button>
            );
          })}
        </Group>
      </MantineAppShell.Footer>
    </MantineAppShell>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <Paper
      p="sm"
      radius="md"
      style={{
        background: 'rgba(38, 26, 20, 0.6)',
        border: `1px solid rgba(168, 133, 96, 0.12)`,
      }}
    >
      <Text size="xs" c="dimmed" mb={2}>
        {label}
      </Text>
      <Badge variant="light" color={color} fullWidth>
        {value}
      </Badge>
    </Paper>
  );
}
