import type { WeeklyArticleFlowMode } from '@newsnexus/db-models';

const productionModes: WeeklyArticleFlowMode[] = [
  'manual_production',
  'scheduled_production'
];

export const assertProductionIdentity = (
  mode: WeeklyArticleFlowMode,
  username: string,
  databaseUser: string
): void => {
  if (!productionModes.includes(mode)) return;

  if (username !== 'limited_user') {
    throw new Error('production weekly flow must run as the limited_user account');
  }
  if (databaseUser !== 'newsnexus_app') {
    throw new Error('production weekly flow must connect as the newsnexus_app database role');
  }
};
