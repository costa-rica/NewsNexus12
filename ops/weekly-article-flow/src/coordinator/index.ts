import { WeeklyFlowCliOptions, WeeklyFlowConfig } from '../config';

export interface CoordinatorDependencies {
  config: WeeklyFlowConfig;
}

export class WeeklyArticleFlowCoordinator {
  constructor(private readonly dependencies: CoordinatorDependencies) {}

  async run(options: WeeklyFlowCliOptions): Promise<void> {
    void this.dependencies;
    void options;
    throw new Error('weekly coordinator stage execution is introduced in Phase 7');
  }
}
