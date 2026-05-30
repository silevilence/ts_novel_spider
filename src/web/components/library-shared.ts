import type { LibraryModel } from '../services/library-model';
import type { TranslationExportMode } from '../services/api';

export interface LibraryWorkspaceProps {
  model: LibraryModel;
  onOpenControl: () => void;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

export interface LibraryViewSharedProps {
  model: LibraryModel;
  onOpenControl: () => void;
  onNotify: (notice: { tone: 'info' | 'success' | 'error'; title: string; message: string }) => void;
}

export interface DescriptionDialogState {
  title: string;
  text: string;
}

export interface TypographyDraftState {
  fontSize: number;
  fontSizePreset: 'small' | 'medium' | 'large';
  lineHeight: number;
  paragraphSpacing: number;
  fontFamilyPreset: 'sans' | 'serif' | 'monospace' | 'custom';
  fontFamilyCustom: string;
}

// Detail view state passed from library-workspace
export interface LibraryDetailState {
  isExportDialogOpen: boolean;
  setIsExportDialogOpen: (v: boolean) => void;
  isRedownloadPickerOpen: boolean;
  setIsRedownloadPickerOpen: (v: boolean) => void;
  descriptionDialog: DescriptionDialogState | null;
  setDescriptionDialog: (v: DescriptionDialogState | null) => void;
  selectedRedownloadChapterIds: string[];
  setSelectedRedownloadChapterIds: (v: string[]) => void;
  aliasDraft: string;
  setAliasDraft: (v: string) => void;
  editingAliasId: string | null;
  setEditingAliasId: (v: string | null) => void;
  editingAliasValue: string;
  setEditingAliasValue: (v: string) => void;
  editingBookmarkId: string | null;
  setEditingBookmarkId: (v: string | null) => void;
  editingBookmarkNote: string;
  setEditingBookmarkNote: (v: string) => void;
  isPageNavOpen: boolean;
  setIsPageNavOpen: (v: boolean) => void;
  exportTranslationMode: TranslationExportMode;
  setExportTranslationMode: (v: TranslationExportMode) => void;
  chapterDirectoryRef: React.RefObject<HTMLDivElement | null>;
}

// Reader view state passed from library-workspace
export interface LibraryReaderState {
  isReaderDirectoryOpen: boolean;
  setIsReaderDirectoryOpen: (v: boolean) => void;
  readerBookmarkNote: string;
  setReaderBookmarkNote: (v: string) => void;
  editingBookmarkId: string | null;
  setEditingBookmarkId: (v: string | null) => void;
  editingBookmarkNote: string;
  setEditingBookmarkNote: (v: string) => void;
  isReaderTypographyOpen: boolean;
  setIsReaderTypographyOpen: (v: boolean) => void;
  readerTypographyDraft: TypographyDraftState | null;
  setReaderTypographyDraft: (v: TypographyDraftState | null) => void;
  readerTypographyDirty: boolean;
  setReaderTypographyDirty: (v: boolean) => void;
  isTranslationPanelOpen: boolean;
  setIsTranslationPanelOpen: (v: boolean) => void;
}
