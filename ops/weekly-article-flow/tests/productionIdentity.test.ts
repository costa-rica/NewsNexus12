import { assertProductionIdentity } from '../src/productionIdentity';

describe('production identity', () => {
  it.each(['dev_canary', 'dev_destructive_recovery'] as const)(
    'does not enforce production identities for %s',
    (mode) => {
      expect(() => assertProductionIdentity(mode, 'operator', 'development_role')).not.toThrow();
    }
  );

  it.each(['manual_production', 'scheduled_production'] as const)(
    'requires the Linux account before the database role for %s',
    (mode) => {
      expect(() => assertProductionIdentity(mode, 'operator', 'wrong_role'))
        .toThrow('production weekly flow must run as the limited_user account');
    }
  );

  it.each(['manual_production', 'scheduled_production'] as const)(
    'requires the application database role for %s',
    (mode) => {
      expect(() => assertProductionIdentity(mode, 'limited_user', 'wrong_role'))
        .toThrow('production weekly flow must connect as the newsnexus_app database role');
    }
  );

  it('accepts the production Linux account and database role', () => {
    expect(() => assertProductionIdentity(
      'scheduled_production',
      'limited_user',
      'newsnexus_app'
    )).not.toThrow();
  });
});
