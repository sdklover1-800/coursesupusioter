import type { errors as ruErrors } from '../ru/errors';
import type { Loc } from '../../types';

export const errors: Loc<typeof ruErrors> = {
  generic: 'Бірдеңе дұрыс болмады', network: 'Желі мәселесі', forbidden: 'Құқық жеткіліксіз',
  notFound: 'Табылмады', consentRequired: 'Зерттеуге келісім қажет',
};
