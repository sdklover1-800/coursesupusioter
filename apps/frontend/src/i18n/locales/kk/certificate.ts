import type { certificate as ruCertificate } from '../ru/certificate';
import type { Loc } from '../../types';

/** Студенттің сертификаттары (CertificatesPage). */
export const certificate: Loc<typeof ruCertificate> = {
  eyebrow: 'Жетістіктер',
  title: 'Сертификаттар',
  issuedOn: 'Берілген күні: {{date}}',
  serial: 'Сертификат нөмірі',
  download: 'PDF жүктеу',
  copyLink: 'Тексеру сілтемесін көшіру',
  copied: 'Сілтеме көшірілді',
  copyFailed: 'Көшіру мүмкін болмады. Сілтеме: {{url}}',
  emptyTitle: 'Сертификат курсты аяқтағаннан кейін пайда болады',
  emptyHint: 'Орындау қалғаны:',
  emptyNoCourses: 'Каталогтан курсқа жазылыңыз — сертификат курсты өткеннен кейін беріледі.',
  toCourse: 'Курсқа өту',
  allDone: 'Барлық талап орындалды — сертификат рәсімделуде.',
  loadError: 'Сертификаттарды жүктеу мүмкін болмады',
};
