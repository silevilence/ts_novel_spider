import { useState } from 'react';
import {
  Badge, Button, Card, Group, Menu, Modal, Paper, ScrollArea, SimpleGrid, Stack, Text, TextInput, Title, UnstyledButton,
} from '@mantine/core';
import { IconBook, IconSearch, IconArrowRight, IconDots, IconFileDownload, IconBook2 } from '@tabler/icons-react';

import { buildTextPreview } from '../services/library-view';
import type { LibraryModel } from '../services/library-model';
import { DescriptionDialogState } from './library-shared';

interface LibraryListViewProps {
  model: LibraryModel;
  onOpenControl: () => void;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

const LIBRARY_CARD_DESCRIPTION_LIMIT = 180;
const LIBRARY_SEARCH_EXAMPLES = [
  'name:离线冒险 tag:异世界',
  'alias:旧译名 or alias:别称',
  'name:样例 -site:syosetu18',
  'author:"测试作者" tag:书库',
];

export function LibraryListView({ model, onOpenControl, onNotify }: LibraryListViewProps) {
  const [isSearchGuideOpen, setIsSearchGuideOpen] = useState(false);
  const [descriptionDialog, setDescriptionDialog] = useState<DescriptionDialogState | null>(null);

  const totalNovels = model.libraryOverview.totalNovels;
  const downloadedChapters = model.libraryOverview.downloadedChapters;
  const pendingChapters = model.libraryOverview.pendingChapters;

  return (
    <Stack gap="md">
      <Paper p="lg" radius="lg" style={{ background: 'rgba(31,21,16,0.78)', border: '1px solid rgba(168,133,96,0.18)' }}>
        <Stack gap="xs">
          <Group>
            <IconBook size={20} color="#ffd166" />
            <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.12em', color: '#ffd166' }}>
              本地书库
            </Text>
          </Group>
          <Title order={2} style={{ fontFamily: 'Alegreya, Noto Serif SC, Georgia, serif' }}>
            已采集的小说
          </Title>
          <Text size="sm" c="dimmed" maw={640}>
            这里列出已下载到本地的小说。点击详情可补抓新章节、导出文件或直接阅读。
          </Text>
          <Group gap="sm">
            <Badge variant="light" color="gray" size="lg">已入库 {totalNovels} 本</Badge>
            <Badge variant="light" color="green" size="lg">已采集 {downloadedChapters} 章</Badge>
            <Badge variant="light" color="yellow" size="lg">未采集 {pendingChapters} 章</Badge>
          </Group>
        </Stack>
      </Paper>

      <Group>
        <TextInput
          leftSection={<IconSearch size={16} />}
          placeholder="搜索：name:作品名、tag:标签、alias:别名..."
          value={model.searchQuery}
          onChange={(e) => model.setSearchQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button variant="subtle" size="compact-sm" onClick={() => setIsSearchGuideOpen((v) => !v)}>
          {isSearchGuideOpen ? '收起语法提示' : '查询语法'}
        </Button>
        <Button variant="subtle" size="compact-sm" onClick={() => model.clearSearch()} disabled={model.searchQuery.trim().length === 0}>
          清空
        </Button>
      </Group>

      {isSearchGuideOpen ? (
        <Paper p="md" radius="md" style={{ background: 'rgba(31,21,16,0.6)' }}>
          <Text size="sm" fw={600} mb="xs">查询语法提示</Text>
          <Text size="xs" c="dimmed" mb="xs">支持字段：name、alias、tag、author、site、summary。空格=同时满足，or=任意满足，- =排除。</Text>
          <Group gap="xs" wrap="wrap">
            {LIBRARY_SEARCH_EXAMPLES.map((ex) => (
              <Button key={ex} variant="subtle" size="compact-xs" onClick={() => model.setSearchQuery(ex)}>{ex}</Button>
            ))}
          </Group>
        </Paper>
      ) : null}

      <Group>
        <Button variant="light" size="compact-sm" onClick={onOpenControl}>去采集新作品</Button>
        <Button variant="subtle" size="compact-sm" onClick={() => void model.refresh()} loading={model.loading}>刷新书库</Button>
      </Group>

      <Paper p="md" radius="lg" style={{ background: 'rgba(31,21,16,0.6)', border: '1px solid rgba(168,133,96,0.12)' }}>
        <Text size="sm" c="dimmed" mb="md">{model.errorMessage ?? `${model.novels.length} 本作品 · 支持书名、别名、标签、作者和站点组合检索`}</Text>

        {model.novels.length === 0 ? (
          <Stack align="center" gap="md" py="xl">
            <Text c="dimmed">{model.loading ? '正在读取书库...' : '书库里还没有小说。'}</Text>
            {!model.loading ? (
              <Button variant="filled" color="brand" onClick={onOpenControl}>去采集第一本作品</Button>
            ) : null}
          </Stack>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
            {model.novels.map((novel) => {
              const preview = buildTextPreview(novel.metadata.description, LIBRARY_CARD_DESCRIPTION_LIMIT);
              return (
                <Card key={`${novel.sourceId}-${novel.metadata.novelId}`} padding="md" radius="lg" h="auto" mih={220} style={{ display: 'flex', flexDirection: 'column' }}>
                  <Group justify="space-between" mb="xs">
                    <Badge variant="light" color="gray" size="sm">{novel.sourceId}</Badge>
                    <Menu shadow="md" width={160}>
                      <Menu.Target>
                        <Button variant="subtle" size="compact-xs" px={6}><IconDots size={16} /></Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconArrowRight size={14} />}
                          onClick={() => model.openNovel(novel.sourceId, novel.metadata.novelId)}>
                          查看详情
                        </Menu.Item>
                        {novel.readingProgress ? (
                          <Menu.Item leftSection={<IconBook2 size={14} />}
                            onClick={() => model.openChapter(novel.sourceId, novel.metadata.novelId, novel.readingProgress!.highestChapterId)}>
                            继续阅读
                          </Menu.Item>
                        ) : null}
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                  <UnstyledButton onClick={() => model.openNovel(novel.sourceId, novel.metadata.novelId)} style={{ textAlign: 'left' }}>
                    <Title order={4} lineClamp={1} mb={4} style={{ cursor: 'pointer', transition: 'color 150ms ease' }}>{novel.metadata.title}</Title>
                  </UnstyledButton>
                  <Text size="xs" c="dimmed" mb="xs">作者：{novel.metadata.author || '未知作者'}</Text>
                  <ScrollArea.Autosize mah={80} offsetScrollbars>
                    <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>{novel.metadata.description || '暂无简介'}</Text>
                  </ScrollArea.Autosize>
                  <Group gap={4} wrap="wrap" mb="xs">
                    {novel.metadata.tags.length > 0
                      ? novel.metadata.tags.slice(0, 5).map((tag) => <Badge key={tag} variant="light" size="xs" color="blue">{tag}</Badge>)
                      : <Text size="xs" c="dimmed">无标签</Text>}
                  </Group>
                  {novel.aliases.length > 0 ? (
                    <Group gap={4} wrap="wrap" mb="xs">
                      {novel.aliases.slice(0, 2).map((a) => <Badge key={a.id} variant="outline" size="xs" color="gray">别名：{a.alias}</Badge>)}
                      {novel.aliases.length > 2 ? <Text size="xs" c="dimmed">+{novel.aliases.length - 2}</Text> : null}
                    </Group>
                  ) : null}
                  <Group gap={6}>
                    <Badge variant="light" color="green" size="sm">已采集 {novel.downloadedChapters}</Badge>
                    <Badge variant="light" color="yellow" size="sm">未采集 {novel.indexedChapters + novel.failedChapters}</Badge>
                    <Badge variant="light" color="gray" size="sm">书签 {novel.bookmarkCount}</Badge>
                  </Group>
                  {novel.readingProgress ? (
                    <Card mt="sm" padding="xs" radius="md" style={{ background: 'rgba(38,26,20,0.6)' }}>
                      <Group justify="space-between" wrap="nowrap">
                        <div><Text size="xs" c="dimmed">继续阅读</Text><Text size="xs" fw={600}>第 {novel.readingProgress.highestChapterIndex} 章</Text></div>
                        <Button variant="light" size="compact-xs" onClick={() => model.openChapter(novel.sourceId, novel.metadata.novelId, novel.readingProgress!.highestChapterId)}>继续</Button>
                      </Group>
                    </Card>
                  ) : null}
                </Card>
              );
            })}
          </SimpleGrid>
        )}
      </Paper>

      <Modal
        opened={descriptionDialog !== null}
        onClose={() => setDescriptionDialog(null)}
        title={<Text size="lg" fw={700}>{descriptionDialog?.title}</Text>}
        size="lg"
        styles={{
          content: { background: 'rgba(15,10,8,0.97)' },
          header: { background: 'rgba(15,10,8,0.97)', borderBottom: '1px solid rgba(168,133,96,0.12)' },
        }}
      >
        {descriptionDialog ? (
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{descriptionDialog.text}</Text>
        ) : null}
      </Modal>
    </Stack>
  );
}
