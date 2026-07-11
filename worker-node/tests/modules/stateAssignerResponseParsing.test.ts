import { buildStateAssignerPrompt } from '../../src/modules/state-assigner/prompt';
import { parseChatGptResponse } from '../../src/modules/state-assigner/responseParsing';

describe('parseChatGptResponse', () => {
  it('parses strict JSON responses', () => {
    expect(
      parseChatGptResponse(
        JSON.stringify({
          occuredInTheUS: true,
          reasoning: 'mentions California',
          state: 'CA'
        })
      )
    ).toEqual({
      occuredInTheUS: true,
      reasoning: 'mentions California',
      state: 'CA'
    });
  });

  it('extracts a JSON object from preamble and suffix text', () => {
    expect(
      parseChatGptResponse(
        'Here is the JSON:\n{"occuredInTheUS":false,"reasoning":"outside the US"}\nDone.'
      )
    ).toEqual({
      occuredInTheUS: false,
      reasoning: 'outside the US'
    });
  });

  it.each(['not json', 'prefix only { nope', '[{"occuredInTheUS":true,"reasoning":"ok"}]'])(
    'rejects invalid JSON object content: %s',
    (raw) => {
      expect(() => parseChatGptResponse(raw)).toThrow(
        'Invalid response: response content is not a JSON object'
      );
    }
  );

  it('rejects responses without occuredInTheUS', () => {
    expect(() => parseChatGptResponse('{"reasoning":"ok"}')).toThrow(
      "Invalid response: missing or invalid 'occuredInTheUS'"
    );
  });

  it('rejects responses with wrong-type occuredInTheUS', () => {
    expect(() =>
      parseChatGptResponse('{"occuredInTheUS":"yes","reasoning":"ok"}')
    ).toThrow("Invalid response: missing or invalid 'occuredInTheUS'");
  });

  it.each(['', '   '])('rejects missing or empty reasoning: %s', (reasoning) => {
    expect(() =>
      parseChatGptResponse(
        JSON.stringify({
          occuredInTheUS: true,
          reasoning
        })
      )
    ).toThrow("Invalid response: missing 'reasoning'");
  });
});

describe('buildStateAssignerPrompt', () => {
  it('replaces title and content placeholders', () => {
    expect(
      buildStateAssignerPrompt('Title: {articleTitle}\nContent: {articleContent}', {
        title: 'Test title',
        content: 'Test content'
      })
    ).toBe('Title: Test title\nContent: Test content');
  });
});
