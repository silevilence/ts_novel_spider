import { useMemo, useCallback } from 'react';
import { Group, MultiSelect, Select } from '@mantine/core';

// ── Types ──

type CronPeriod = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

export interface CronEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

// ── Data ──

const PERIOD_OPTIONS: { value: CronPeriod; label: string }[] = [
  { value: 'minute', label: '每分钟' },
  { value: 'hour', label: '每小时' },
  { value: 'day', label: '每天' },
  { value: 'week', label: '每周' },
  { value: 'month', label: '每月' },
  { value: 'year', label: '每年' },
];

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  value: String(i),
  label: String(i).padStart(2, '0'),
}));

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: String(i).padStart(2, '0'),
}));

const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1}月`,
}));

const WEEK_DAY_OPTIONS = [
  { value: '0', label: '周日' },
  { value: '1', label: '周一' },
  { value: '2', label: '周二' },
  { value: '3', label: '周三' },
  { value: '4', label: '周四' },
  { value: '5', label: '周五' },
  { value: '6', label: '周六' },
];

const cronFieldStyles = {
  input: {
    minHeight: '46px',
    display: 'flex',
    alignItems: 'center',
    paddingTop: 0,
    paddingBottom: 0,
    border: '1px solid rgba(168, 133, 96, 0.24)',
    background: 'rgba(22, 15, 10, 0.92)',
    color: '#f0e6d8',
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
    transition: 'border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease',
  },
  section: {
    color: '#a89b8c',
  },
  dropdown: {
    border: '1px solid rgba(168, 133, 96, 0.22)',
    background: 'rgba(31, 21, 16, 0.98)',
    boxShadow: '0 16px 36px rgba(10, 6, 4, 0.42)',
    backdropFilter: 'blur(18px)',
  },
  option: {
    color: '#f0e6d8',
    borderRadius: '10px',
  },
  pill: {
    background: 'rgba(255, 140, 66, 0.14)',
    border: '1px solid rgba(255, 140, 66, 0.26)',
    color: '#f6e8d5',
  },
  pillsList: {
    gap: '0.35rem',
    width: '100%',
  },
  inputField: {
    alignSelf: 'center',
    background: 'transparent',
    border: 'none',
    boxShadow: 'none',
    color: '#f0e6d8',
    lineHeight: '1.6em',
    padding: 0,
  },
};

// ── Helpers ──

function parseField(v: string): string[] {
  if (!v || v === '*' || v.trim() === '') return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

function joinField(values: string[]): string {
  if (!values || values.length === 0) return '*';
  return [...new Set(values)].sort((a, b) => Number(a) - Number(b)).join(',');
}

function detectPeriod(
  minutes: string[], hours: string[],
  dom: string[], months: string[], dow: string[],
): CronPeriod {
  if (minutes.length === 0 && hours.length === 0 && dom.length === 0 && months.length === 0 && dow.length === 0) return 'minute';
  if (minutes.length > 0 && hours.length === 0 && dom.length === 0 && months.length === 0 && dow.length === 0) return 'hour';
  if (minutes.length > 0 && hours.length > 0 && dom.length === 0 && months.length === 0 && dow.length === 0) return 'day';
  if (dow.length > 0) return 'week';
  if (dom.length > 0 && months.length === 0) return 'month';
  if (months.length > 0) return 'year';
  return 'day';
}

// ── Component ──

export function CronEditor({ value, onChange, disabled = false }: CronEditorProps) {
  const parts = useMemo(() => {
    const s = value.trim().split(/\s+/);
    return {
      minutes: parseField(s[0] ?? ''),
      hours: parseField(s[1] ?? ''),
      monthDays: parseField(s[2] ?? ''),
      months: parseField(s[3] ?? ''),
      weekDays: parseField(s[4] ?? ''),
    };
  }, [value]);

  const period = useMemo(
    () => detectPeriod(parts.minutes, parts.hours, parts.monthDays, parts.months, parts.weekDays),
    [parts],
  );

  const setPeriod = useCallback((p: CronPeriod | null) => {
    if (!p) return;
    const m = parts.minutes.length > 0 ? parts.minutes : ['0'];
    const h = parts.hours.length > 0 ? parts.hours : ['0'];
    const dom = parts.monthDays.length > 0 ? parts.monthDays : ['1'];
    const mon = parts.months.length > 0 ? parts.months : ['1'];
    const dow = parts.weekDays.length > 0 ? parts.weekDays : ['1'];

    switch (p) {
      case 'minute': onChange('* * * * *'); break;
      case 'hour': onChange(`${joinField(m)} * * * *`); break;
      case 'day': onChange(`${joinField(m)} ${joinField(h)} * * *`); break;
      case 'week': onChange(`${joinField(m)} ${joinField(h)} * * ${joinField(dow)}`); break;
      case 'month': onChange(`${joinField(m)} ${joinField(h)} ${joinField(dom)} * *`); break;
      case 'year': onChange(`${joinField(m)} ${joinField(h)} ${joinField(dom)} ${joinField(mon)} *`); break;
    }
  }, [parts, onChange]);

  const updateField = useCallback(
    (field: 'minutes' | 'hours' | 'monthDays' | 'months' | 'weekDays', newValues: string[]) => {
      const updated = { ...parts, [field]: newValues };
      onChange(`${joinField(updated.minutes)} ${joinField(updated.hours)} ${joinField(updated.monthDays)} ${joinField(updated.months)} ${joinField(updated.weekDays)}`);
    },
    [parts, onChange],
  );

  const showHours = period === 'day' || period === 'week' || period === 'month' || period === 'year';
  const showMonthDays = period === 'month' || period === 'year';
  const showMonths = period === 'year';
  const showWeekDays = period === 'week';

  return (
    <Group gap="xs" align="flex-start" wrap="wrap">
      <Select
        size="xs"
        data={PERIOD_OPTIONS}
        value={period}
        onChange={(p) => setPeriod(p as CronPeriod)}
        styles={cronFieldStyles}
        disabled={disabled}
        allowDeselect={false}
        miw={100}
      />

      {period !== 'minute' && (
        <MultiSelect
          size="xs"
          data={MINUTE_OPTIONS}
          value={parts.minutes}
          onChange={(v) => updateField('minutes', v)}
          styles={cronFieldStyles}
          disabled={disabled}
          searchable
          nothingFoundMessage="无"
          placeholder="分"
          clearable
          miw={110}
        />
      )}

      {showHours && (
        <MultiSelect
          size="xs"
          data={HOUR_OPTIONS}
          value={parts.hours}
          onChange={(v) => updateField('hours', v)}
          styles={cronFieldStyles}
          disabled={disabled}
          searchable
          nothingFoundMessage="无"
          placeholder="时"
          clearable
          miw={110}
        />
      )}

      {showMonthDays && (
        <MultiSelect
          size="xs"
          data={MONTH_DAY_OPTIONS}
          value={parts.monthDays}
          onChange={(v) => updateField('monthDays', v)}
          styles={cronFieldStyles}
          disabled={disabled}
          searchable
          nothingFoundMessage="无"
          placeholder="日"
          clearable
          miw={110}
        />
      )}

      {showMonths && (
        <MultiSelect
          size="xs"
          data={MONTH_OPTIONS}
          value={parts.months}
          onChange={(v) => updateField('months', v)}
          styles={cronFieldStyles}
          disabled={disabled}
          searchable
          nothingFoundMessage="无"
          placeholder="月"
          clearable
          miw={110}
        />
      )}

      {showWeekDays && (
        <MultiSelect
          size="xs"
          data={WEEK_DAY_OPTIONS}
          value={parts.weekDays}
          onChange={(v) => updateField('weekDays', v)}
          styles={cronFieldStyles}
          disabled={disabled}
          searchable
          nothingFoundMessage="无"
          placeholder="周"
          clearable
          miw={130}
        />
      )}
    </Group>
  );
}
