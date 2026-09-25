import type { auth as ruAuth } from '../ru/auth';
import type { Loc } from '../../types';

export const auth: Loc<typeof ruAuth> = {
  tagline: 'Оқу — дұрыс сұрақ қою деген сөз',
  subtitle: 'Сократтық ЖИ-көмекшісі бар оқу платформасы',
  email: 'Email', password: 'Құпия сөз', signIn: 'Кіру',
  wrongCredentials: 'Email немесе құпия сөз қате', welcome: 'Қайта келуіңізбен',
  changePassword: 'Құпия сөзді өзгерту', currentPassword: 'Ағымдағы құпия сөз', newPassword: 'Жаңа құпия сөз',
  mustChange: 'Жалғастыру үшін жаңа құпия сөз орнатыңыз', passwordChanged: 'Құпия сөз өзгертілді',
  loginTitle: 'Кіру',
  confirmPassword: 'Жаңа құпия сөзді қайталаңыз',
  passwordHint: 'Кемінде {{min}} таңба',
  errMismatch: 'Құпия сөздер сәйкес келмейді',
  errShort: 'Құпия сөз кемінде {{min}} таңбадан тұруы керек',
  errLong: 'Құпия сөз тым ұзын (ең көбі {{max}} таңба)',
  errRequired: 'Бұл өрісті толтырыңыз',
  errCurrent: 'Ағымдағы құпия сөз қате',
  errTooMany: 'Кіру әрекеттері тым көп. Бір минут күтіп, қайталаңыз.',
  consentDeclinedTitle: 'Сіз аккаунттан шықтыңыз',
  consentDeclined: 'Зерттеуге қатысуға келісімсіз курсқа қолжетімділік жабық. Сұрақтар болса — зерттеу тобына хабарласыңыз.',
};
