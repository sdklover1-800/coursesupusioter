import { GenerationType } from '@edu/shared';
import { prisma } from '../lib/prisma.js';
import { Errors } from '../lib/errors.js';
import { generationQueue, type GenerationJobData } from '../queue/queues.js';

const KNOWN_TYPES = new Set<string>(Object.values(GenerationType));

/**
 * Создаёт запись GenerationJob (QUEUED) и ставит фоновую задачу (FR-7.1).
 * Идемпотентность обеспечивается jobId = generationJobId.
 * Тип — объединение GenerationType (QUIZ | PRACTICAL | MINI | ALL | LECTURE_SUMMARY);
 * неизвестный тип отклоняется сразу, а не падает позже в воркере.
 */
export async function enqueueGeneration(params: {
  courseLanguageVersionId: string;
  type: GenerationJobData['type'];
  params: GenerationJobData['params'];
  createdById: string;
}): Promise<{ id: string }> {
  if (!KNOWN_TYPES.has(params.type)) throw Errors.badRequest(`Неизвестный тип генерации: ${String(params.type)}`);
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
