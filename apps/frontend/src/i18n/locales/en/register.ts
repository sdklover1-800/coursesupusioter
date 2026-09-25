import type { register as ruRegister } from '../ru/register';
import type { Loc } from '../../types';

export const register: Loc<typeof ruRegister> = {
  link: 'Sign up', title: 'Create an account',
  subtitle: 'After signing up, pick a course in the catalog and request access.',
  name: 'Full name', namePlaceholder: 'First and last name',
  passwordHint: 'At least 8 characters', passwordRepeat: 'Repeat password',
  interfaceLanguage: 'Interface language', submit: 'Create account',
  haveAccount: 'Already have an account?', noAccount: 'No account yet?', signUp: 'Sign up',
  consentNote: 'Before you start learning, we will ask for your informed consent to take part in the study.',
  errName: 'Enter your full name (2–100 characters)', errEmail: 'Enter a valid email',
  errPasswordShort: 'Password must be at least 8 characters', errPasswordLong: 'Password is too long (128 characters max)',
  errPasswordMismatch: 'Passwords don’t match', errTooMany: 'Too many sign-up attempts. Please try again later.',
  errInvalid: 'Please check the form fields',
  loginNoticeTitle: 'Account created — please sign in',
  loginNotice: 'If this email was already registered, sign in with your existing password or contact an administrator.',
};
