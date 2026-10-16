/** 同一脱敏规则用于任务错误、控制台和交互日志，覆盖各自输出边界。 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
  return text;
}
