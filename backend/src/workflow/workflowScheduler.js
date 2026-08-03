'use strict';

const { Queue, Worker } = require('bullmq');

class WorkflowScheduler {
  constructor({ name = 'default', engine, connection, logger = console }) {
    this.engine = engine;
    this.logger = logger;
    this.closed = false;
    this.queue = new Queue(`apihub_wf_${name}_schedule`, { connection });
    this.worker = new Worker(
      `apihub_wf_${name}_schedule`,
      async (job) => {
        await this.engine.start({
          workflowId: job.data.workflowId,
          inputVars: job.data.inputVars || {},
          trigger: 'CRON',
        });
      },
      { connection, concurrency: 1 }
    );
  }

  async registerCron({ workflowId, cron, jobId, inputVars = {}, tz = 'UTC' }) {
    const id = jobId || `cron:${workflowId}:${cron}`;
    await this.queue.upsertJobScheduler(
      id,
      { pattern: cron, tz },
      { name: 'cron-tick', data: { workflowId, inputVars } }
    );
    return id;
  }

  async registerInterval({ workflowId, everyMs, jobId, inputVars = {} }) {
    const id = jobId || `cron:${workflowId}:${everyMs}`;
    await this.queue.upsertJobScheduler(
      id,
      { every: everyMs },
      { name: 'cron-tick', data: { workflowId, inputVars } }
    );
    return id;
  }

  async getCrons() {
    return this.queue.getJobSchedulers();
  }

  async removeCron({ jobId }) {
    return this.queue.removeJobScheduler(jobId);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.worker.close();
    await this.queue.close();
  }
}

module.exports = { WorkflowScheduler };
