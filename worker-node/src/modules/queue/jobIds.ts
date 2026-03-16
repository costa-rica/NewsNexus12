const JOB_ID_MIN_WIDTH = 4;

export const formatJobId = (sequenceNumber: number): string => {
  if (sequenceNumber <= 0) {
    throw new Error('sequenceNumber must be greater than 0');
  }

  return String(sequenceNumber).padStart(JOB_ID_MIN_WIDTH, '0');
};

export const parseJobId = (jobId: string): number => {
  const normalized = jobId.trim();
  if (normalized === '') {
    throw new Error('jobId is required');
  }
  if (!/^\d+$/.test(normalized)) {
    throw new Error('jobId must contain only digits');
  }

  const parsed = parseInt(normalized, 10);
  if (parsed <= 0) {
    throw new Error('jobId must be greater than 0');
  }

  return parsed;
};

export const getNextJobId = (existingJobIds: string[]): string => {
  let highestSequence = 0;

  for (const existingJobId of existingJobIds) {
    highestSequence = Math.max(highestSequence, parseJobId(existingJobId));
  }

  return formatJobId(highestSequence + 1);
};
