import type { OpsConfig } from '../../config';
import {
  buildProductionBackupCommand,
  runDatabaseBackupCommand,
  type BackupCommandSpec,
  type BackupProcessLauncher,
  type CreateDatabaseBackupResult
} from './02_createDatabaseBackupCommand';

export type {
  BackupCommandSpec,
  BackupProcessLauncher,
  CreateDatabaseBackupResult
};

type PhaseTwoConfig = Pick<OpsConfig, 'dbManagerBackupTimeoutSeconds'>;

export const createDatabaseBackup = (
  config: PhaseTwoConfig,
  command: BackupCommandSpec = buildProductionBackupCommand(),
  launcher?: BackupProcessLauncher
): Promise<CreateDatabaseBackupResult> =>
  runDatabaseBackupCommand(command, config.dbManagerBackupTimeoutSeconds, launcher);
