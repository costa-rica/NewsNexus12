import fs from 'node:fs/promises';
import path from 'node:path';
import { QueueJobRecord, QueueJobStatus, QueueJobStoreData } from './types';

const EMPTY_STORE: QueueJobStoreData = { jobs: [] };

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isValidJobStatus = (value: unknown): value is QueueJobStatus =>
  value === 'queued' ||
  value === 'running' ||
  value === 'completed' ||
  value === 'failed' ||
  value === 'canceled';

const parseJobRecord = (value: unknown): QueueJobRecord => {
  if (!isRecordObject(value)) {
    throw new Error('Queue job record must be an object');
  }

  const jobId = value.jobId;
  const endpointName = value.endpointName;
  const status = value.status;
  const createdAt = value.createdAt;
  const startedAt = value.startedAt;
  const endedAt = value.endedAt;
  const failureReason = value.failureReason;
  const parameters = value.parameters;
  const result = value.result;
  const logs = value.logs;

  if (typeof jobId !== 'string' || jobId.trim() === '') {
    throw new Error('Queue job record jobId must be a non-empty string');
  }
  if (typeof endpointName !== 'string' || endpointName.trim() === '') {
    throw new Error('Queue job record endpointName must be a non-empty string');
  }
  if (!isValidJobStatus(status)) {
    throw new Error('Queue job record status is invalid');
  }
  if (typeof createdAt !== 'string' || createdAt.trim() === '') {
    throw new Error('Queue job record createdAt must be a non-empty string');
  }
  if (startedAt !== undefined && typeof startedAt !== 'string') {
    throw new Error('Queue job record startedAt must be a string when provided');
  }
  if (endedAt !== undefined && typeof endedAt !== 'string') {
    throw new Error('Queue job record endedAt must be a string when provided');
  }
  if (failureReason !== undefined && typeof failureReason !== 'string') {
    throw new Error('Queue job record failureReason must be a string when provided');
  }
  if (parameters !== undefined && (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters))) {
    throw new Error('Queue job record parameters must be an object when provided');
  }
  if (result !== undefined && (typeof result !== 'object' || result === null || Array.isArray(result))) {
    throw new Error('Queue job record result must be an object when provided');
  }
  if (logs !== undefined && !Array.isArray(logs)) {
    throw new Error('Queue job record logs must be an array when provided');
  }

  return {
    jobId,
    endpointName,
    status,
    createdAt,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(failureReason !== undefined ? { failureReason } : {}),
    ...(parameters !== undefined ? { parameters: parameters as Record<string, unknown> } : {}),
    ...(result !== undefined ? { result: result as Record<string, unknown> } : {}),
    ...(logs !== undefined ? { logs: (logs as unknown[]).map(String) } : {})
  };
};

const parseStoreData = (rawValue: unknown): QueueJobStoreData => {
  if (!isRecordObject(rawValue)) {
    throw new Error('Queue job store must be an object');
  }

  const rawJobs = rawValue.jobs;
  if (!Array.isArray(rawJobs)) {
    throw new Error('Queue job store must include jobs array');
  }

  return {
    jobs: rawJobs.map(parseJobRecord)
  };
};

export class QueueJobStore {
  private readonly filePath: string;
  private operationChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public async getJobs(): Promise<QueueJobRecord[]> {
    return this.withLock(async () => {
      const data = await this.readStoreFromDisk();
      return [...data.jobs];
    });
  }

  public async getJobById(jobId: string): Promise<QueueJobRecord | null> {
    return this.withLock(async () => {
      const data = await this.readStoreFromDisk();
      return data.jobs.find((job) => job.jobId === jobId) ?? null;
    });
  }

  public async appendJob(job: QueueJobRecord): Promise<void> {
    await this.withLock(async () => {
      const data = await this.readStoreFromDisk();
      data.jobs.push(job);
      await this.writeStoreToDisk(data);
    });
  }

  public async updateJob(
    jobId: string,
    updater: (existingJob: QueueJobRecord) => QueueJobRecord
  ): Promise<QueueJobRecord | null> {
    return this.withLock(async () => {
      const data = await this.readStoreFromDisk();
      const index = data.jobs.findIndex((job) => job.jobId === jobId);

      if (index === -1) {
        return null;
      }

      const updatedJob = updater(data.jobs[index]);
      data.jobs[index] = parseJobRecord(updatedJob);
      await this.writeStoreToDisk(data);
      return data.jobs[index];
    });
  }

  public async mutateJobs(
    mutator: (jobs: QueueJobRecord[]) => QueueJobRecord[]
  ): Promise<QueueJobRecord[]> {
    return this.withLock(async () => {
      const data = await this.readStoreFromDisk();
      const updatedJobs = mutator([...data.jobs]);
      data.jobs = updatedJobs.map(parseJobRecord);
      await this.writeStoreToDisk(data);
      return [...data.jobs];
    });
  }

  public async updateJobResult(
    jobId: string,
    result: Record<string, unknown>
  ): Promise<QueueJobRecord | null> {
    return this.updateJob(jobId, (job) => ({ ...job, result }));
  }

  public async appendJobLog(jobId: string, message: string): Promise<void> {
    await this.withLock(async () => {
      const data = await this.readStoreFromDisk();
      const index = data.jobs.findIndex((job) => job.jobId === jobId);
      if (index === -1) {
        return;
      }
      const existing = data.jobs[index].logs ?? [];
      data.jobs[index] = { ...data.jobs[index], logs: [...existing, message] };
      await this.writeStoreToDisk(data);
    });
  }

  public async ensureInitialized(): Promise<void> {
    await this.withLock(async () => {
      await this.ensureStoreFile();
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;

    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.operationChain;
    this.operationChain = next;

    await previous;

    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  private async ensureStoreFile(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await this.writeStoreToDisk(EMPTY_STORE);
    }
  }

  private async readStoreFromDisk(): Promise<QueueJobStoreData> {
    await this.ensureStoreFile();
    const rawText = await fs.readFile(this.filePath, 'utf8');
    const parsedValue = JSON.parse(rawText) as unknown;
    return parseStoreData(parsedValue);
  }

  private async writeStoreToDisk(storeData: QueueJobStoreData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = `${JSON.stringify(storeData, null, 2)}\n`;

    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, this.filePath);
  }
}

export const resolveDefaultQueueStorePath = (
  pathUtilities: string | undefined = process.env.PATH_UTILTIES,
  cwd: string = process.cwd()
): string => {
  const basePath = pathUtilities && pathUtilities.trim() !== '' ? pathUtilities.trim() : cwd;
  return path.join(basePath, 'worker-node', 'queue-jobs.json');
};
