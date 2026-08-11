import { prisma } from '../lib/prisma.js';
import { generationQueue, type GenerationJobData } from '../queue/queues.js';

/**
 * Создаёт запись GenerationJob (QUEUED) и ставит фоновую задачу (FR-7.1).
 * Идемпотентность обеспечивается jobId = generationJobId.
 */
export async function enqueueGeneration(params: {
  courseLanguageVersionId: string;
  type: GenerationJobData['type'];
  params: GenerationJobData['params'];
  createdById: string;
}): Promise<{ id: string }> {
  const job = await prisma.generationJob.create({
    data: {
      courseLanguageVersionId: params.courseLanguageVersionId,
      type: params.type,
      params: params.params as object,
      status: 'QUEUED',
      createdById: params.createdById,
    },
  });

  await generationQueue.add(
    'generate',
    {
      generationJobId: job.id,
      courseLanguageVersionId: params.courseLanguageVersionId,
      type: params.type,
      params: params.params,
      createdById: params.createdById,
    },
    { jobId: job.id },
  );

  return { id: job.id };
}
