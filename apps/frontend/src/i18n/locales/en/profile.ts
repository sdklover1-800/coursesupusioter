import type { profile as ruProfile } from '../ru/profile';
import type { Loc } from '../../types';

/** Profile (/profile): account, interface, password change. */
export const profile: Loc<typeof ruProfile> = {
  title: 'Profile',
  account: 'Account',
  name: 'Full name',
  email: 'Email',
  role: 'Role',
  readOnlyHint: 'To correct your name or email, contact an administrator.',
  interface: 'Interface',
  interfaceLanguage: 'Interface language',
  interfaceLanguageHint: 'The course language of instruction is changed on the course page.',
  theme: 'Theme',
  themeLight: 'Light', themeDark: 'Dark', themeSystem: 'Match system',
  a11y: 'Low-vision mode',
  a11yHint: 'Larger text, high-contrast borders, no animations.',
  password: 'Change password',
  passwordSubmit: 'Change password',
  passwordChangedHint: 'Password changed. You will need to sign in again on other devices.',
};
