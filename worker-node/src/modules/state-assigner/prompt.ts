export interface StateAssignerPromptArticle {
  title: string;
  content: string;
}

export const buildStateAssignerPrompt = (
  template: string,
  article: StateAssignerPromptArticle
): string =>
  template.replace('{articleTitle}', article.title).replace('{articleContent}', article.content);
