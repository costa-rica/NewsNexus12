const secretKeyPattern = /(token|secret|password|authorization|api[_-]?key|key_open_ai)/i;

export const redactForReporting = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactForReporting);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      secretKeyPattern.test(key) ? '[redacted]' : redactForReporting(child)
    ]));
  }
  return value;
};

export const assertNoReportingSecrets = (value: unknown): void => {
  const serialized = JSON.stringify(value);
  if (/previewToken|authorization|key_open_ai/i.test(serialized)) {
    throw new Error('reporting payload contains a forbidden secret key');
  }
};
