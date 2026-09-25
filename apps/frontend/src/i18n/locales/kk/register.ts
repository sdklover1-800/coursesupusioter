import type { register as ruRegister } from '../ru/register';
import type { Loc } from '../../types';

export const register: Loc<typeof ruRegister> = {
  link: 'Тіркелу', title: 'Аккаунт жасаңыз',
  subtitle: 'Тіркелгеннен кейін каталогтан курс таңдап, өтінім беріңіз.',
  name: 'Аты-жөні', namePlaceholder: 'Тегі, аты, әкесінің аты',
  passwordHint: 'Кемінде 8 таңба', passwordRepeat: 'Құпия сөзді қайталаңыз',
  interfaceLanguage: 'Интерфейс тілі', submit: 'Тіркелу',
  haveAccount: 'Аккаунтыңыз бар ма?', noAccount: 'Аккаунтыңыз жоқ па?', signUp: 'Тіркелу',
  consentNote: 'Оқуды бастамас бұрын зерттеуге қатысуға саналы келісіміңізді сұраймыз.',
  errName: 'Аты-жөніңізді жазыңыз (2–100 таңба)', errEmail: 'Дұрыс email енгізіңіз',
  errPasswordShort: 'Құпия сөз кемінде 8 таңбадан тұруы керек', errPasswordLong: 'Құпия сөз тым ұзын (ең көбі 128 таңба)',
  errPasswordMismatch: 'Құпия сөздер сәйкес келмейді', errTooMany: 'Тіркелу әрекеттері тым көп. Кейінірек қайталап көріңіз.',
  errInvalid: 'Өрістердің дұрыс толтырылғанын тексеріңіз',
  loginNoticeTitle: 'Аккаунт жасалды — кіріңіз',
  loginNotice: 'Егер бұл email бұрын тіркелген болса, бұрынғы құпия сөзіңізбен кіріңіз немесе әкімшіге хабарласыңыз.',
};
