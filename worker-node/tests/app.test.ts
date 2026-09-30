import { Router } from 'express';
import { createApp } from '../src/app';

describe('createApp diagnostics propagation', () => {
  it.each([true, false])(
    'passes the resolved diagnostics boolean %p to semantic router construction',
    (workerHttpDiagnosticsEnabled) => {
      const semanticScorerRouterFactory = jest.fn(() => Router());

      createApp({ workerHttpDiagnosticsEnabled, semanticScorerRouterFactory });

      expect(semanticScorerRouterFactory).toHaveBeenCalledWith({
        diagnosticsEnabled: workerHttpDiagnosticsEnabled
      });
    }
  );

  it('keeps createApp with no arguments disabled-compatible', () => {
    const semanticScorerRouterFactory = jest.fn(() => Router());

    createApp({ semanticScorerRouterFactory });

    expect(semanticScorerRouterFactory).toHaveBeenCalledWith({ diagnosticsEnabled: false });
  });
});
