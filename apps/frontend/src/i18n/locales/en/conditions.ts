import type { conditions as ruConditions } from '../ru/conditions';
import type { Loc } from '../../types';

export const conditions: Loc<typeof ruConditions> = { AI_ASSISTED: 'AI, no teacher', WITH_TEACHER: 'With teacher', CONTROL: 'Control' };
