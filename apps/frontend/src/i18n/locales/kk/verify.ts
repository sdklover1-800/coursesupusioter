import type { verify as ruVerify } from '../ru/verify';
import type { Loc } from '../../types';

/** Сертификатты жария тексеру (/verify, /verify/:serial). */
export const verify: Loc<typeof ruVerify> = {
  eyebrow: 'Жария тексеру',
  title: 'Сертификатты тексеру',
  lead: 'Сертификат нөмірін енгізіңіз — ол QR-кодтың жанында басылған.',
  label: 'Сертификат нөмірі',
  placeholder: 'EDU-2026-XXXXXXXXXX',
  submit: 'Тексеру',
  checking: 'Тексеріп жатырмыз…',
  valid: 'Сертификат жарамды',
  invalid: 'Сертификат табылмады',
  invalidHint: 'Нөмірді тексеріңіз: ол сертификатта басылғанмен сәйкес келуі керек.',
  holder: 'Иесі',
  course: 'Курс',
  language: 'Оқыту тілі',
  issuedAt: 'Берілген күні',
  modules: 'Курс модульдері',
  issuer: 'Берген ұйым',
  number: 'Нөмірі',
  tooMany: 'Тексеру тым жиі жасалды. Бір минуттан кейін қайталаңыз.',
  error: 'Тексеру мүмкін болмады. Қайталап көріңіз.',
  privacy: 'Тек сертификатта басылған деректер көрсетіледі.',
  empty: 'Сертификат нөмірін енгізіңіз',
};
