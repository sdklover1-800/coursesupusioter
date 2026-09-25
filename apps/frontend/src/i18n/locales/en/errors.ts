import type { errors as ruErrors } from '../ru/errors';
import type { Loc } from '../../types';

export const errors: Loc<typeof ruErrors> = {
  generic: 'Something went wrong', network: 'Network problem', forbidden: 'Insufficient permissions',
  notFound: 'Not found', consentRequired: 'Research consent required',
};
