import type { status as ruStatus } from '../ru/status';
import type { Loc } from '../../types';

export const status: Loc<typeof ruStatus> = { DRAFT: 'Жоба', PUBLISHED: 'Жарияланған', ARCHIVED: 'Мұрағатта' };
