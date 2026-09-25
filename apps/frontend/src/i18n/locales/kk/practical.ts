import type { practical as ruPractical } from '../ru/practical';
import type { Loc } from '../../types';

export const practical: Loc<typeof ruPractical> = {
  title: 'Практикалық тапсырма', socratic: 'Сократтық көмекші',
  socraticNote: 'Көмекші дайын жауап бермейді — сізді сұрақтармен жетелейді. Ойыңызды дауыстап айтыңыз.',
  start: 'Тапсырманы бастау', send: 'Жіберу', placeholder: 'Ой-пікіріңізді жазыңыз…',
  remainingReplies: 'Қалған реплика', repliesLabel: 'көмекші репликасы',
  thinking: 'Көмекші ойлануда…', waiting: 'Көмекші әдеттегіден ұзақ жауап беруде…', charLimit: '{{n}} таңбадан аспау',
  verdict: 'Шешім', verdictPassed: 'Тапсырма тапсырылды', verdictFailed: 'Тапсырма тапсырылмады',
  verdictAbandoned: 'Сессия жабылды', reasoning: 'Ой-пікірді бағалау',
  methodicalness: 'Әдістілік', questionQuality: 'Сұрақ сапасы',
  logicalProgression: 'Логикалық бірізділік', selfCorrection: 'Өзін-өзі түзету',
  sessionEnded: 'Сессия аяқталды', resume: 'Сессияны жалғастыру',
  techError: 'Көмекші уақытша қолжетімсіз. Бұл сәтсіздік деп есептелмеді — қайта көріңіз.',
  reachedAnswer: 'Сіз дұрыс жауапқа келдіңіз',
  scaleNote: 'Әр сыни ойлау өлшемі бойынша 0–3 шкаласы',
};
