import { useEffect, useState } from 'react';
import { fetchLibraryTranslationBuild, fetchLibraryTranslationTerms } from './api';
import type { TranslationBuildState } from './library-model';
import type { StoredTranslationTermRow } from '../../server/core/novel-repository';

/** Discover background jobs even when they were started outside the main translation panel. */
export function useLibraryTranslationStatus(sourceId: string | null, novelId: string | null) {
  const [build, setBuild] = useState<TranslationBuildState | null>(null);
  const [terms, setTerms] = useState<StoredTranslationTermRow[]>([]);
  useEffect(() => {
    setBuild(null); setTerms([]);
    if (!sourceId || !novelId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const [buildResult, termsResult] = await Promise.allSettled([
        fetchLibraryTranslationBuild(sourceId, novelId), fetchLibraryTranslationTerms(sourceId, novelId),
      ]);
      if (!active) return;
      if (buildResult.status === 'fulfilled') setBuild((current) => JSON.stringify(current) === JSON.stringify(buildResult.value.translation) ? current : buildResult.value.translation as TranslationBuildState | null);
      if (termsResult.status === 'fulfilled') setTerms((current) => JSON.stringify(current) === JSON.stringify(termsResult.value.terms) ? current : termsResult.value.terms);
      timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [sourceId, novelId]);
  return { build, setBuild, terms, setTerms };
}
