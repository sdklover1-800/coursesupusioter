import type { profile as ruProfile } from '../ru/profile';
import type { Loc } from '../../types';

/** Профиль (/profile): аккаунт, интерфейс, құпия сөзді өзгерту. */
export const profile: Loc<typeof ruProfile> = {
  title: 'Профиль',
  account: 'Аккаунт',
  name: 'Аты-жөні',
  email: 'Email',
  role: 'Рөлі',
  readOnlyHint: 'Аты-жөніңізді немесе email-ді түзету үшін әкімшіге хабарласыңыз.',
  interface: 'Интерфейс',
  interfaceLanguage: 'Интерфейс тілі',
  interfaceLanguageHint: 'Курсты оқыту тілі курс бетінде өзгертіледі.',
  theme: 'Тақырып',
  themeLight: 'Ашық', themeDark: 'Қараңғы', themeSystem: 'Жүйедегідей',
  a11y: 'Нашар көретіндерге арналған нұсқа',
  a11yHint: 'Қаріп үлкенірек, жиектер контрастты, анимациясыз.',
  password: 'Құпия сөзді өзгерту',
  passwordSubmit: 'Құпия сөзді өзгерту',
  passwordChangedHint: 'Құпия сөз өзгертілді. Басқа құрылғыларда қайта кіру қажет болады.',
};
