import { z } from 'zod';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@edu/shared';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  q: z.string().trim().optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function paginate(p: Pagination) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function pageMeta(total: number, p: Pagination) {
  return { total, page: p.page, pageSize: p.pageSize, pages: Math.ceil(total / p.pageSize) };
}
