const secretKeyPattern = /(token|secret|password|authorization|credential|environment|api[_-]?key|key_open_ai|articleContent|description)/i;

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
  if (typeof value === 'string') {
    return value.replace(
      /(token|secret|password|authorization|credential|api[_-]?key|key_open_ai)\s*[:=]\s*\S+/gi,
      '$1=[redacted]'
    );
  }
  return value;
};

export const assertNoReportingSecrets = (value: unknown): void => {
  const serialized = JSON.stringify(value);
  if (/previewToken|authorization|credential|key_open_ai|articleContent/i.test(serialized)) {
    throw new Error('reporting payload contains a forbidden secret key');
  }
};
