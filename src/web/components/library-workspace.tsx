import { useEffect, useState } from 'react';
import { Stack, Text } from '@mantine/core';

import { LibraryDetailView } from './library-detail-view';
import { LibraryReaderView } from './library-reader-view';
import { LibraryListView } from './library-list-view';
import type { LibraryModel } from '../services/library-model';

interface LibraryWorkspaceProps {
  model: LibraryModel;
  onOpenControl: () => void;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

export function LibraryWorkspace({ model, onOpenControl, onNotify }: LibraryWorkspaceProps) {
  const [isReaderDirectoryOpen, setIsReaderDirectoryOpen] = useState(false);
  const [readerBookmarkNote, setReaderBookmarkNote] = useState('');
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingBookmarkNote, setEditingBookmarkNote] = useState('');
  const [isReaderTypographyOpen, setIsReaderTypographyOpen] = useState(false);
  const [readerTypographyDraft, setReaderTypographyDraft] = useState<{
    fontSize: number;
    fontSizePreset: 'small' | 'medium' | 'large';
    lineHeight: number;
    paragraphSpacing: number;
    fontFamilyPreset: 'sans' | 'serif' | 'monospace' | 'custom';
    fontFamilyCustom: string;
  } | null>(null);
  const [readerTypographyDirty, setReaderTypographyDirty] = useState(false);
  const [isTranslationPanelOpen, setIsTranslationPanelOpen] = useState(false);

  useEffect(() => {
    setIsReaderDirectoryOpen(false);
    setReaderBookmarkNote('');
    setEditingBookmarkId(null);
    setEditingBookmarkNote('');
  }, [model.location.path]);

  useEffect(() => {
    if (model.location.view !== 'reader' || !model.chapter?.chapter.chapter.id) return;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [model.location.view, model.chapter?.chapter.chapter.id]);

  if (model.location.view === 'page') {
    return <LibraryListView model={model} onOpenControl={onOpenControl} onNotify={onNotify} />;
  }

  if (model.location.view === 'reader') {
    return (
      <LibraryReaderView
        model={model}
        onNotify={onNotify}
        isReaderDirectoryOpen={isReaderDirectoryOpen}
        setIsReaderDirectoryOpen={setIsReaderDirectoryOpen}
        readerBookmarkNote={readerBookmarkNote}
        setReaderBookmarkNote={setReaderBookmarkNote}
        editingBookmarkId={editingBookmarkId}
        setEditingBookmarkId={setEditingBookmarkId}
        editingBookmarkNote={editingBookmarkNote}
        setEditingBookmarkNote={setEditingBookmarkNote}
        isReaderTypographyOpen={isReaderTypographyOpen}
        setIsReaderTypographyOpen={setIsReaderTypographyOpen}
        readerTypographyDraft={readerTypographyDraft}
        setReaderTypographyDraft={setReaderTypographyDraft}
        readerTypographyDirty={readerTypographyDirty}
        setReaderTypographyDirty={setReaderTypographyDirty}
        isTranslationPanelOpen={isTranslationPanelOpen}
        setIsTranslationPanelOpen={setIsTranslationPanelOpen}
      />
    );
  }

  const detail = model.detail?.novel;
  if (!detail) {
    return (
      <Stack gap="md">
        <Text c="dimmed">{model.loading ? '正在加载书籍详情...' : model.errorMessage ?? '未找到对应书籍。'}</Text>
      </Stack>
    );
  }

  return <LibraryDetailView model={model} onOpenControl={onOpenControl} onNotify={onNotify} />;
}
