export interface ChatGptResponse {
  occuredInTheUS: boolean;
  reasoning: string;
  state?: string;
}

const parseJsonObject = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');

    if (start === -1 || end <= start) {
      throw new Error('Invalid response: response content is not a JSON object');
    }

    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      throw new Error('Invalid response: response content is not a JSON object');
    }
  }
};

export const parseChatGptResponse = (raw: string): ChatGptResponse => {
  const parsed = parseJsonObject(raw);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid response: response content is not a JSON object');
  }

  const candidate = parsed as Partial<ChatGptResponse>;

  if (typeof candidate.occuredInTheUS !== 'boolean') {
    throw new Error("Invalid response: missing or invalid 'occuredInTheUS'");
  }
  if (typeof candidate.reasoning !== 'string' || candidate.reasoning.trim() === '') {
    throw new Error("Invalid response: missing 'reasoning'");
  }

  return {
    ...candidate,
    occuredInTheUS: candidate.occuredInTheUS,
    reasoning: candidate.reasoning
  };
};
