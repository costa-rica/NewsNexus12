// Bound and redact diagnostic text; never copy arbitrary error properties or stacks.
export const diagnosticText = (value: string): string => value
  .replace(/https?:\/\/[^\s"'<>]+/gi, '[url omitted]')
  .replace(/(\b(?:authorization|cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi, '$1[redacted]')
  .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]')
  .replace(/("?[^\s":=]*(?:token|secret|password|key)[^\s":=]*"?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^,}\s]+)/gi, '$1[redacted]')
  .slice(0, 1000);

export const errorDiagnostics = (error: unknown, depth = 0): Record<string, unknown> => {
  if (depth >= 4) return { message: 'cause depth limit reached' };
  if (typeof error !== 'object' || error === null) {
    return { message: diagnosticText(String(error)) };
  }
  const value = error as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['name', 'message', 'code', 'errno', 'syscall', 'hostname', 'address', 'port']) {
    if (typeof value[key] === 'string') result[key] = diagnosticText(value[key]);
    else if (typeof value[key] === 'number') result[key] = value[key];
  }
  if (value.cause !== undefined) result.cause = errorDiagnostics(value.cause, depth + 1);
  if (Array.isArray(value.errors)) {
    result.errors = value.errors.slice(0, 5).map((item) => errorDiagnostics(item, depth + 1));
  }
  return result;
};
