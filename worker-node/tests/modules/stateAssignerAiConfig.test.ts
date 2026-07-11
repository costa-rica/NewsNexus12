import logger from '../../src/modules/logger';
import { isAppError } from '../../src/modules/errors/appError';
import { resolveStateAssignerAiConfig } from '../../src/modules/state-assigner/config';

const expectValidationField = (action: () => unknown, field: string): void => {
  try {
    action();
    throw new Error('Expected validation error');
  } catch (error) {
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.status).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field
          })
        ])
      );
    }
  }
};

describe('resolveStateAssignerAiConfig', () => {
  const codexAvailable = jest.fn(() => true);
  const codexMissing = jest.fn(() => false);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults to the codex backend even when KEY_OPEN_AI is set', () => {
    const config = resolveStateAssignerAiConfig(
      {
        KEY_OPEN_AI: 'test-key',
        PATH: '/usr/local/bin'
      },
      { isCodexBinaryAvailable: codexAvailable }
    );

    expect(config).toEqual({
      backend: 'codex-cli',
      modelName: 'gpt-5.4-mini',
      codexTimeoutMs: 180_000
    });
    expect(codexAvailable).toHaveBeenCalledTimes(1);
  });

  it('uses the OpenAI backend when USE_OPEN_AI_API is true and KEY_OPEN_AI is set', () => {
    const config = resolveStateAssignerAiConfig(
      {
        USE_OPEN_AI_API: 'true',
        KEY_OPEN_AI: ' test-key ',
        STATE_ASSIGNER_MODEL_NAME: 'gpt-custom',
        PATH: ''
      },
      { isCodexBinaryAvailable: codexMissing }
    );

    expect(config).toEqual({
      backend: 'openai',
      modelName: 'gpt-custom',
      keyOpenAi: 'test-key'
    });
    expect(codexMissing).not.toHaveBeenCalled();
  });

  it('falls back to codex and logs a warning when OpenAI is requested without a key', () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    const config = resolveStateAssignerAiConfig(
      {
        USE_OPEN_AI_API: 'yes',
        KEY_OPEN_AI: ' ',
        PATH: '/usr/local/bin'
      },
      { isCodexBinaryAvailable: codexAvailable }
    );

    expect(config.backend).toBe('codex-cli');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('state_assigner_openai_key_missing'));
    expect(codexAvailable).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('rejects invalid USE_OPEN_AI_API values', () => {
    expectValidationField(
      () =>
        resolveStateAssignerAiConfig(
          {
            USE_OPEN_AI_API: 'sometimes'
          },
          { isCodexBinaryAvailable: codexAvailable }
        ),
      'USE_OPEN_AI_API'
    );
  });

  it.each(['0', '-1', '1.5', 'abc'])(
    'rejects invalid STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS value %s',
    (value) => {
      expectValidationField(
        () =>
          resolveStateAssignerAiConfig(
            {
              STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS: value
            },
            { isCodexBinaryAvailable: codexAvailable }
          ),
        'STATE_ASSIGNER_CODEX_TIMEOUT_SECONDS'
      );
    }
  );

  it('uses backend-specific default models and allows model overrides', () => {
    expect(
      resolveStateAssignerAiConfig(
        {},
        { isCodexBinaryAvailable: codexAvailable }
      )
    ).toMatchObject({
      backend: 'codex-cli',
      modelName: 'gpt-5.4-mini'
    });

    expect(
      resolveStateAssignerAiConfig(
        {
          USE_OPEN_AI_API: 'on',
          KEY_OPEN_AI: 'test-key'
        },
        { isCodexBinaryAvailable: codexMissing }
      )
    ).toMatchObject({
      backend: 'openai',
      modelName: 'gpt-4o-mini'
    });

    expect(
      resolveStateAssignerAiConfig(
        {
          STATE_ASSIGNER_MODEL_NAME: 'gpt-override'
        },
        { isCodexBinaryAvailable: codexAvailable }
      )
    ).toMatchObject({
      backend: 'codex-cli',
      modelName: 'gpt-override'
    });
  });

  it('rejects codex backend when the binary check fails', () => {
    expectValidationField(
      () =>
        resolveStateAssignerAiConfig(
          {
            PATH: '/missing'
          },
          { isCodexBinaryAvailable: codexMissing }
        ),
      'codex'
    );
    expect(codexMissing).toHaveBeenCalledTimes(1);
  });
});
