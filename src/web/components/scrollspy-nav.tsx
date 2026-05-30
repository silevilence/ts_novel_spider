import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActionIcon, Affix, Group, Paper, Stack, Text, Tooltip, useMantineTheme } from '@mantine/core';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';

// ── Types ──

export interface ScrollspySection {
  id: string;
  label: string;
}

interface ScrollspyContextValue {
  register: (section: ScrollspySection) => () => void;
  sections: ScrollspySection[];
}

const ScrollspyContext = createContext<ScrollspyContextValue | null>(null);

// ── Provider ──

export function ScrollspyProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<ScrollspySection[]>([]);

  const register = useCallback((section: ScrollspySection) => {
    setSections((prev) => {
      const exists = prev.some((s) => s.id === section.id);
      if (exists) return prev;
      return [...prev, section];
    });
    return () => {
      setSections((prev) => prev.filter((s) => s.id !== section.id));
    };
  }, []);

  const value = useMemo(() => ({ register, sections }), [register, sections]);

  return (
    <ScrollspyContext.Provider value={value}>
      {children}
    </ScrollspyContext.Provider>
  );
}

export function useScrollspy() {
  const ctx = useContext(ScrollspyContext);
  if (!ctx) throw new Error('useScrollspy must be used within ScrollspyProvider');
  return ctx;
}

// ── Section marker ──

export function ScrollspySection({ id, label, children }: { id: string; label: string; children?: ReactNode }) {
  const { register } = useScrollspy();

  useEffect(() => {
    return register({ id, label });
  }, [register, id, label]);

  return (
    <div id={id} style={{ scrollMarginTop: 72 }}>
      {children}
    </div>
  );
}

// ── Section marker for data-scrollspy attrs (legacy compat) ──
// Automatically registers all [data-scrollspy] elements on mount

function useScrollspyAutoRegister() {
  const { register } = useScrollspy();
  const registeredRef = useRef(false);

  useEffect(() => {
    if (registeredRef.current) return;
    registeredRef.current = true;
    const cleanups: Array<() => void> = [];
    document.querySelectorAll('[data-scrollspy]').forEach((el) => {
      const id = el.id;
      const label = el.getAttribute('data-scrollspy-label') ?? id;
      if (id) cleanups.push(register({ id, label }));
    });
    return () => cleanups.forEach((fn) => fn());
  }, [register]);
}

// ── Navigation FAB ──

export function ScrollspyNav() {
  const ctx = useContext(ScrollspyContext);
  const theme = useMantineTheme();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useScrollspyAutoRegister();

  // Show FAB after scrolling past first section
  useEffect(() => {
    const onScroll = () => {
      setShow(window.scrollY > 300);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Track active section via IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );

    const targets = document.querySelectorAll('[data-scrollspy]');
    targets.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [ctx?.sections]);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  if (!show) return null;

  const sections = ctx?.sections ?? [];

  return (
    <Affix position={{ bottom: 80, right: 16 }}>
      <Paper
        p={4}
        radius="lg"
        shadow="lg"
        style={{
          background: 'rgba(15,10,8,0.94)',
          backdropFilter: 'blur(18px)',
          border: `1px solid ${theme.other.lineColor as string}`,
        }}
      >
        <Stack gap={2}>
          <Tooltip label="回到顶部" position="left">
            <ActionIcon variant="subtle" size="sm" color="gray" onClick={scrollToTop}>
              <IconArrowUp size={16} />
            </ActionIcon>
          </Tooltip>

          {sections.map((s) => (
            <Tooltip key={s.id} label={s.label} position="left">
              <ActionIcon
                variant={activeId === s.id ? 'light' : 'subtle'}
                size="sm"
                color={activeId === s.id ? 'brand' : 'gray'}
                onClick={() => scrollTo(s.id)}
              >
                <Text size="xs" fw={activeId === s.id ? 700 : 500}>
                  {s.label.charAt(0)}
                </Text>
              </ActionIcon>
            </Tooltip>
          ))}

          <Tooltip label="到达底部" position="left">
            <ActionIcon variant="subtle" size="sm" color="gray" onClick={scrollToBottom}>
              <IconArrowDown size={16} />
            </ActionIcon>
          </Tooltip>
        </Stack>
      </Paper>
    </Affix>
  );
}
