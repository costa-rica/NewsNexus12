jest.mock("../../src/modules/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

import { formatArticleDetails } from "../../src/modules/articles";

describe("articles module", () => {
  test("formatArticleDetails keeps AI reasoning when no state was assigned", () => {
    const result = formatArticleDetails([
      {
        articleId: 123,
        title: "Test article",
        description: "Description",
        url: "https://example.com/article",
        articleContent: "Article content",
        humanStateId: null,
        humanStateName: null,
        aiPromptId: 7,
        aiIsHumanApproved: false,
        aiReasoning: "The article describes a national issue without a state.",
        aiStateId: null,
        aiStateName: null,
      },
    ]);

    expect(result?.stateAiApproved).toEqual({
      promptId: 7,
      isHumanApproved: false,
      reasoning: "The article describes a national issue without a state.",
      state: null,
    });
  });
});
