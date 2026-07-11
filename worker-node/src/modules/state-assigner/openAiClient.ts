import { StateAssignerDirectories } from '../startup/stateAssignerFiles';
import { StateAssignerAiConfig } from './config';
import { buildStateAssignerPrompt, StateAssignerPromptArticle } from './prompt';
import { ChatGptResponse, parseChatGptResponse } from './responseParsing';

type OpenAiStateAssignerConfig = Extract<StateAssignerAiConfig, { backend: 'openai' }>;

export const analyzeArticleWithOpenAi = async (
  aiConfig: OpenAiStateAssignerConfig,
  stateAssignerDirectories: StateAssignerDirectories,
  promptTemplate: string,
  article: StateAssignerPromptArticle,
  signal: AbortSignal
): Promise<ChatGptResponse> => {
  const prompt = buildStateAssignerPrompt(promptTemplate, article);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiConfig.keyOpenAi}`
    },
    body: JSON.stringify({
      model: aiConfig.modelName,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  const completion = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const rawContent = completion.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('No response content from OpenAI');
  }

  // Raw ChatGPT responses are no longer persisted to chatgpt_responses.
  // The response is still parsed in memory below for state assignment.
  // const responseFileName = `response-${article.id}-${new Date().toISOString().replace(/:/g, '-')}.json`;
  // const responseFilePath = path.join(stateAssignerDirectories.chatGptResponsesDir, responseFileName);
  // await fs.writeFile(responseFilePath, rawContent, 'utf8');
  void stateAssignerDirectories;

  return parseChatGptResponse(rawContent);
};
