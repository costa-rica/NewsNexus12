const mockEnsureSchemaReady = jest.fn().mockResolvedValue(undefined);
const mockInitModels = jest.fn();
const mockSequelize = {};

jest.mock('@newsnexus/db-models', () => ({
  ensureSchemaReady: mockEnsureSchemaReady,
  initModels: mockInitModels,
  sequelize: mockSequelize
}));

import ensureDbReady from '../../src/modules/db/ensureDbReady';

describe('ensureDbReady', () => {
  it('requires only retained startup tables', async () => {
    await ensureDbReady();

    expect(mockInitModels).toHaveBeenCalledTimes(1);
    expect(mockEnsureSchemaReady).toHaveBeenCalledWith(
      mockSequelize,
      ['Articles', 'Users', 'States']
    );
  });
});
