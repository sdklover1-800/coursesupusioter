import type { auth as ruAuth } from '../ru/auth';
import type { Loc } from '../../types';

export const auth: Loc<typeof ruAuth> = {
  tagline: 'To learn is to ask the right questions',
  subtitle: 'A learning platform with a Socratic AI assistant',
  email: 'Email', password: 'Password', signIn: 'Sign in',
  wrongCredentials: 'Wrong email or password', welcome: 'Welcome back',
  changePassword: 'Change password', currentPassword: 'Current password', newPassword: 'New password',
  mustChange: 'Set a new password to continue', passwordChanged: 'Password changed',
  loginTitle: 'Sign in',
  confirmPassword: 'Repeat the new password',
  passwordHint: 'At least {{min}} characters',
  errMismatch: 'Passwords do not match',
  errShort: 'The password must be at least {{min}} characters',
  errLong: 'The password is too long (at most {{max}} characters)',
  errRequired: 'Fill in this field',
  errCurrent: 'The current password is wrong',
  errTooMany: 'Too many sign-in attempts. Wait a minute and try again.',
  consentDeclinedTitle: 'You have signed out',
  consentDeclined: 'Without consent to take part in the research, course access is closed. Questions go to the research team.',
};
