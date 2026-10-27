import { Accordion, Alert, Checkbox, Group, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { agentConfigSchema, agentOperations, type AgentConfig } from '../../server/contracts/refined-agent';

export const agentOperationLabels: Record<typeof agentOperations[number], string> = { update_terms: '维护待确认术语', extract_terms: '提取术语候选', translate_terms: '翻译术语', translate_metadata: '翻译作品信息', translate_chapter: '翻译正文与卷章标题', check_chapter: '检查遗漏', review_chapter: '审核校对', revise_chapter: '关联修订与定稿', confirm_terms: '自动确认候选术语', export: '导出成果' };

/** The same validated configuration is used at creation and while a task is paused. */
export function RefinedAgentConfigFields({ value, onChange, models, chapters }: { value: AgentConfig; onChange: (value: AgentConfig) => void; models: Array<{ value: string; label: string; translationOnly?: boolean }>; chapters?: Array<{ value: string; label: string }> }) {
  const parsed = agentConfigSchema.safeParse(value);
  return <Stack gap="md" className="refined-agent-config">
    <Textarea label="希望 Agent 完成什么" description="描述目标、文风和交付要求。运行中仍可追加指令。" minRows={3} autosize maxRows={8} value={value.initialCommand} onChange={(event) => onChange({ ...value, initialCommand: event.currentTarget.value })} required />
    <Select label="主控模型" description="负责规划与选择工具；翻译和审核使用下方的执行模型。" required searchable data={models.filter((model) => !model.translationOnly)} value={value.controller.providerId ? `${value.controller.providerId}\u0000${value.controller.modelId}` : null} onChange={(key) => { const [providerId, modelId] = (key ?? '').split('\u0000'); onChange({ ...value, controller: { providerId: providerId ?? '', modelId: modelId ?? '' } }); }} />
    {chapters ? <MultiSelect label="允许处理的章节" description="留空代表全部章节；作品信息和任务术语表为共享物料。" searchable data={chapters} value={value.chapterIds} onChange={(chapterIds) => onChange({ ...value, chapterIds })} /> : null}
    <Alert color="blue" title="启动后可以自动保存任务成果"><Text size="sm">已授权的翻译、审核与修订会自动写入这份精翻任务。术语候选默认等待你确认；章节聊天的编辑提案仍需确认。关闭页面后任务继续运行。</Text></Alert>
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <NumberInput label="模型调用上限" description="主控与执行模型共用，继续任务不会清零。" min={1} max={100000} value={value.budget.maxCalls} onChange={(number) => onChange({ ...value, budget: { ...value.budget, maxCalls: Number(number) } })} />
      <NumberInput label="累计运行时长（分钟）" min={1} max={10080} value={value.budget.maxMinutes} onChange={(number) => onChange({ ...value, budget: { ...value.budget, maxMinutes: Number(number) } })} />
    </SimpleGrid>
    <Accordion variant="separated">
      <Accordion.Item value="authority"><Accordion.Control>操作权限与退出条件</Accordion.Control><Accordion.Panel><Stack>
        <MultiSelect label="允许自动执行" data={agentOperations.map((operation) => ({ value: operation, label: agentOperationLabels[operation] }))} value={value.permissions} onChange={(permissions) => onChange({ ...value, permissions: permissions as AgentConfig['permissions'] })} />
        {value.permissions.includes('confirm_terms') ? <Alert color="orange">已允许 Agent 自动确认本任务的候选术语。已有排除决定和人工译名仍保留。</Alert> : <Text size="sm">新术语会等待人工确认；可在术语表处理后继续。</Text>}
        <SimpleGrid cols={{ base: 1, sm: 2 }}><NumberInput label="自动修订操作上限" min={0} max={10000} value={value.budget.maxRevisions} onChange={(number) => onChange({ ...value, budget: { ...value.budget, maxRevisions: Number(number) } })} /><NumberInput label="连续无进展时暂停（轮）" min={1} max={30} value={value.budget.maxNoProgress} onChange={(number) => onChange({ ...value, budget: { ...value.budget, maxNoProgress: Number(number) } })} /></SimpleGrid>
      </Stack></Accordion.Panel></Accordion.Item>
      <Accordion.Item value="skills"><Accordion.Control>翻译方法与技能快照 · {value.skills.filter((skill) => skill.enabled).length} 项启用</Accordion.Control><Accordion.Panel><Stack gap="lg">
        <Text size="sm" c="dimmed">技能决定处理策略。保存后保留内容和版本；继续任务使用当前快照，技能不能扩大操作权限。</Text>
        {value.skills.map((skill, index) => {
          const update = (patch: Partial<typeof skill>) => onChange({ ...value, skills: value.skills.map((entry, position) => position === index ? { ...entry, ...patch, version: entry.version + 1 } : entry) });
          return <Stack gap="xs" key={skill.id}><Group justify="space-between"><Checkbox label={skill.name} checked={skill.enabled} onChange={(event) => update({ enabled: event.currentTarget.checked })} /><Text size="xs" c="dimmed">版本 {skill.version}</Text></Group><Textarea label={`${skill.name}的执行方法`} autosize minRows={2} maxRows={10} value={skill.content} onChange={(event) => update({ content: event.currentTarget.value })} />{Object.entries(skill.references).filter(([key]) => key !== 'notes').map(([key, content]) => <Textarea key={key} label={`参考资料 · ${key}`} autosize minRows={2} value={content} onChange={(event) => update({ references: { ...skill.references, [key]: event.currentTarget.value } })} />)}<TextInput label={`${skill.name}的补充参考`} description="可按需读取的附加材料。" value={skill.references.notes ?? ''} onChange={(event) => update({ references: { ...skill.references, notes: event.currentTarget.value } })} /></Stack>;
        })}
      </Stack></Accordion.Panel></Accordion.Item>
    </Accordion>
    {!parsed.success ? <Alert color="red" title="还需完善配置">{[...new Set(parsed.error.issues.map((issue) => issue.path[0] === 'controller' ? '请选择主控模型。' : issue.path[0] === 'budget' ? '请在允许范围内填写完整的调用、时长与修订预算。' : issue.path[0] === 'skills' ? '请检查技能名称、内容、版本与工具依赖。' : issue.message))].join(' ')}</Alert> : null}
  </Stack>;
}
