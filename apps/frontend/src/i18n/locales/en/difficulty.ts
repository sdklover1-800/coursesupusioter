import type { difficulty as ruDifficulty } from '../ru/difficulty';
import type { Loc } from '../../types';

export const difficulty: Loc<typeof ruDifficulty> = { VERY_EASY: 'Very easy', EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' };
