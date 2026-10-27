import { useEffect, useState } from 'react';
import { Button, Stack, Text, TextInput } from '@mantine/core';
import type { RefinedTerm } from '../services/api';

export function TermTranslationEditor({ term, disabled, onSave }: { term: RefinedTerm; disabled: boolean; onSave: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(term.targetTerm ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(term.targetTerm ?? ''); setError(null); }, [term.id, term.targetTerm]);
  const save = async () => {
    setSaving(true); setError(null);
    try { await onSave(draft.trim()); } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试。'); } finally { setSaving(false); }
  };
  return <Stack gap={4}><TextInput aria-label={`术语 ${term.sourceTerm} 的译名`} size="xs" value={draft} disabled={disabled || saving} onChange={(event) => setDraft(event.currentTarget.value)} /><Button size="compact-xs" variant="light" disabled={disabled || draft.trim() === (term.targetTerm ?? '')} loading={saving} onClick={() => void save()}>保存译名</Button>{error ? <Text role="alert" c="red" size="xs">{error}</Text> : null}</Stack>;
}
