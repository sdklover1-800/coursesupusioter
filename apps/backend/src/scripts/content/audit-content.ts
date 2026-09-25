/**
 * Фаза 0 (и после каждой фазы): аудит контента курса «Введение в политологию» —
 * ТОЛЬКО чтение. Печатает отчёт, пишет JSON (--out) и, с --baseline <прошлый JSON>,
 * дифф ключевых метрик. Критерии выхода CONTENT-repair считаются здесь же (exit).
 *
 * Что проверяется:
 *  - расшифровки: строки чат-ассистента/сессии перевода, дубли абзацев и разделов,
 *    паритет таймкодов ru/kk/en, доля «і» к «и» и опечатки лексикона в kk, метаданные
 *    до первого таймкода, хвосты «End of Lecture», «предложение на строку», «Бинтроу»;
 *  - оцениваемые тесты по языкам: гистограмма позиций ключа, доля «ключ — самый длинный»,
 *    доля «верно» у TRUE_FALSE, testwiseScore (A12), подсказка длиной, число неархивных
 *    вопросов, паритет canonicalKey между языками;
 *  - язык текстов вопросов (все тесты): кириллица в en, русские «верно/неверно» в kk;
 *    вырожденные обоснования (короче 25 символов); доля «верно» у TRUE_FALSE тренировки;
 *  - пересечения оцениваемых и тренировочных вопросов (Жаккар > 0.35, для kk ещё
 *    триграммы > 0.5, A11), покрытие лекций итоговым мини-квизом;
 *  - русские префиксы в kk/en-названиях, lectureTitleProblem;
 *  - практикум: бюджет токенов, лимит реплик, попытки, canonicalRef, число тезисов;
 *  - лекции без durationSec / summary; открытые СИСТЕМНЫЕ отметки на проверку;
 *  - студенческие данные: попытки без presentation, сессии без taskSnapshot, пересчёт баллов.
 *
 *   npx tsx --env-file-if-exists=../../.env src/scripts/content/audit-content.ts [--out f.json] [--baseline prev.json] [--quiet]
 */
import { readFileSync, existsSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import type { Language } from '@edu/shared';
import { lectureTitleProblem } from '../../modules/courses/lectureTitle.js';
import {
  charTrigramSimilarity,
  jaccard,
  keyPositionHistogram,
  lengthCue,
  normalizeTokens,
  testwiseScore,
  titleLabels,
} from '../../generation/drafts.js';
import {
  END_TRAILER_RE,
  INLINE_META_RE,
  LANGS,
  type LectureCtx,
  type QuestionRow,
  type QuizLocator,
  type VersionCtx,
  activeQuestions,
  gradedModules,
  isChatArtifact,
  isMetaLine,
  isSentencePerLine,
  isTimecodeLine,
  kkLexiconHits,
  lectureCode,
  loadCourse,
  locatorLabel,
  median,
  parseArgs,
  practicalModule,
  prisma,
  proseLines,
  rescoreAttempts,
  round,
  run,
  timecodeRanges,
  writePreview,
} from './lib.js';
import { MIN_RATIONALE_CHARS, questionLanguageProblems, shortRationales } from './revisions.js';

const DEMO_COURSE_TITLE = 'Основы критического мышления';
/** Документированное расхождение: видео kk-15 смонтировано с другими таймкодами (проверка по видео — за носителем). */
const PARITY_EXCEPTIONS = new Set([15]);
const BINTROU = /Бинтроу/gu;

interface LectureAudit {
  code: string;
  lang: Language;
  number: number;
  title: string;
  chars: number;
  timecodes: string[];
  chatArtifacts: string[];
  duplicateParagraphs: string[];
  duplicateSections: string[];
  metaBeforeFirstTimecode: string[];
  trailers: string[];
  sentencePerLine: boolean;
  medianProseLine: number;
  kkIRatio: number | null;
  kkLexicon: Record<string, number>;
  bintrou: number;
  durationSec: number | null;
  hasSummary: boolean;
  titleProblem: string | null;
}

function auditLecture(lang: Language, l: LectureCtx): LectureAudit {
  const text = l.transcriptText;
  const lines = text.split('\n');
  const firstTc = lines.findIndex(isTimecodeLine);
  const pre = firstTc === -1 ? [] : lines.slice(0, firstTc);
  const seen = new Map<string, number>();
  for (const line of lines) {
    const t = line.trim();
    if (t.length >= 60 && !isTimecodeLine(t)) seen.set(t, (seen.get(t) ?? 0) + 1);
  }
  const headers = new Map<string, number>();
  for (const line of lines) if (isTimecodeLine(line)) headers.set(line.trim(), (headers.get(line.trim()) ?? 0) + 1);
  // Хвост: строка End of Lecture в последних 3 строках или название курса капсом в конце.
  const tail = lines.filter((x) => x.trim()).slice(-3);
  const trailers = tail.filter((x) => END_TRAILER_RE.test(x) || /^\s*(INTRODUCTION TO POLITICAL SCIENCE|ВВЕДЕНИЕ В ПОЛИТОЛОГИЮ|САЯСАТТАНУҒА КІРІСПЕ)\s*$/u.test(x));
  const lower = text.toLowerCase();
  const iCount = (lower.match(/і/gu) ?? []).length;
  const iiCount = (lower.match(/и/gu) ?? []).length;
  const prose = proseLines(text);
  return {
    code: lectureCode(lang, l.number),
    lang,
    number: l.number,
    title: l.title,
    chars: text.length,
    timecodes: timecodeRanges(text),
    chatArtifacts: lines.filter(isChatArtifact).map((x) => x.trim().slice(0, 120)),
    duplicateParagraphs: [...seen].filter(([, n]) => n > 1).map(([t, n]) => `${n}× ${t.slice(0, 70)}`),
    duplicateSections: [...headers].filter(([, n]) => n > 1).map(([t, n]) => `${n}× ${t.slice(0, 70)}`),
    metaBeforeFirstTimecode: pre.filter((x) => isMetaLine(x) || (INLINE_META_RE.exec(x)?.index ?? 0) > 0).map((x) => x.trim().slice(0, 120)),
    trailers: trailers.map((x) => x.trim().slice(0, 80)),
    sentencePerLine: isSentencePerLine(text),
    medianProseLine: Math.round(median(prose.map((x) => x.length))),
    kkIRatio: lang === 'kk' ? round(iCount / Math.max(1, iCount + iiCount), 3) : null,
    kkLexicon: lang === 'kk' ? { ...kkLexiconHits(text), ...kkLexiconHits(l.title) } : {},
    bintrou: (text.match(BINTROU) ?? []).length + (l.title.match(BINTROU) ?? []).length,
    durationSec: l.durationSec,
    hasSummary: !!l.summary?.trim(),
    titleProblem: lectureTitleProblem(l.title),
  };
}

interface QuizAudit {
  lang: Language;
  label: string;
  locator: QuizLocator;
  quizId: string;
  title: string;
  graded: boolean;
  active: number;
  archived: number;
  keyHistogram: number[];
  maxKeyShare: number;
  longestIsKeyRate: number;
  tfTrueRatio: number | null;
  testwise: number;
  lengthCues: number;
  canonicalKeys: string[];
  rationalesMissing: number;
  rationalesBadLength: number;
  /** Вопросы с вырожденными обоснованиями (< MIN_RATIONALE_CHARS). */
  rationalesShort: string[];
  /** Чужой алфавит/метка: «#N поле: кириллица» (en), «…: русская метка» (kk). */
  languageProblems: string[];
  tf: { total: number; trueKey: number };
  bintrou: number;
  kkLexicon: Record<string, number>;
  maxAttempts: number;
  scoringRule: string;
  cooldownMinutes: number | null;
  reviewPolicy: string;
  passThreshold: number;
}

const qText = (q: QuestionRow) => [q.prompt, ...q.options, q.explanation ?? '', ...(q.optionRationales ?? [])].join('\n');

async function auditQuiz(lang: Language, locator: QuizLocator, quizId: string): Promise<{ audit: QuizAudit; questions: QuestionRow[] }> {
  const quiz = await prisma.quiz.findUniqueOrThrow({ where: { id: quizId } });
  const questions = await activeQuestions(prisma, quizId);
  const archived = await prisma.quizQuestion.count({ where: { quizId, archivedAt: { not: null } } });
  const sc = questions.filter((q) => q.type === 'SINGLE_CHOICE');
  const tf = questions.filter((q) => q.type === 'TRUE_FALSE');
  const hist = keyPositionHistogram(questions);
  const scTotal = hist.reduce((a, b) => a + b, 0);
  const longestIsKey = sc.filter((q) => {
    const max = Math.max(...q.options.map((o) => o.trim().length));
    return q.correctOptionIds.some((c) => (q.options[c] ?? '').trim().length === max);
  }).length;
  const all = questions.map(qText).join('\n');
  return {
    questions,
    audit: {
      lang,
      label: locatorLabel(lang, locator),
      locator,
      quizId,
      title: quiz.title,
      graded: quiz.isGraded,
      active: questions.length,
      archived,
      keyHistogram: hist,
      maxKeyShare: scTotal ? round(Math.max(...hist) / scTotal, 3) : 0,
      longestIsKeyRate: sc.length ? round(longestIsKey / sc.length, 3) : 0,
      tfTrueRatio: tf.length ? round(tf.filter((q) => q.correctOptionIds[0] === 0).length / tf.length, 3) : null,
      testwise: round(testwiseScore(questions), 3),
      lengthCues: sc.filter((q) => lengthCue(q.options, q.correctOptionIds)).length,
      canonicalKeys: questions.map((q) => q.canonicalKey ?? '∅'),
      rationalesMissing: questions.filter((q) => !q.optionRationales).length,
      rationalesBadLength: questions.filter((q) => q.optionRationales && (q.optionRationales.length !== q.options.length || q.optionRationales.some((r) => !r.trim()))).length,
      rationalesShort: questions.flatMap((q) => {
        const idx = shortRationales(q);
        return idx.length ? [`#${q.orderIndex + 1}${q.canonicalKey ? ` ${q.canonicalKey}` : ''}: ${idx.map((i) => `«${q.optionRationales![i]}»`).join(', ')}`] : [];
      }),
      languageProblems: questions.flatMap((q) => questionLanguageProblems(lang, q).map((p) => `#${q.orderIndex + 1}${q.canonicalKey ? ` ${q.canonicalKey}` : ''} ${p}`)),
      tf: { total: tf.length, trueKey: tf.filter((q) => q.correctOptionIds[0] === 0).length },
      bintrou: (all.match(BINTROU) ?? []).length + (quiz.title.match(BINTROU) ?? []).length,
      kkLexicon: lang === 'kk' ? kkLexiconHits(all) : {},
      maxAttempts: quiz.maxAttempts,
      scoringRule: quiz.scoringRule,
      cooldownMinutes: quiz.cooldownMinutes,
      reviewPolicy: quiz.reviewPolicy,
      passThreshold: quiz.passThreshold,
    },
  };
}

/** Лекция-источник вопроса итогового мини-квиза без sourceLectureId — по словарю расшифровки. */
function guessLecture(text: string, lectures: LectureCtx[]): number {
  const tokens = [...new Set(normalizeTokens(text).filter((t) => t.length > 3))];
  let best = 0;
  let bestScore = -1;
  for (const l of lectures) {
    const vocab = new Set(normalizeTokens(l.transcriptText));
    const s = tokens.filter((t) => vocab.has(t)).length;
    if (s > bestScore) {
      bestScore = s;
      best = l.number;
    }
  }
  return best;
}

/** Русские метки в начале kk/en-названия («Тест:», «Практическое задание:»…). */
function russianPrefix(lang: Language, title: string): string | null {
  if (lang === 'ru') return null;
  const own = new Set(titleLabels(lang));
  for (const label of titleLabels('ru')) {
    if (own.has(label)) continue; // «Мини-квиз» — общая метка ru/kk
    if (title === label || title.startsWith(`${label}:`) || title.startsWith(`${label} `)) return label;
  }
  if (lang === 'en' && /[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/u.test(title)) return 'кириллица';
  return null;
}

async function main(): Promise<number> {
  const args = parseArgs('audit-content', { readOnly: true });
  const quiet = args.has('--quiet');
  const log = (...xs: unknown[]) => {
    if (!quiet) console.log(...xs);
  };
  const course = await loadCourse();
  const versions = LANGS.map((l) => course.versions[l]).filter((v): v is VersionCtx => !!v);

  /* ── Лекции ── */
  const lectures: LectureAudit[] = versions.flatMap((v) => v.lectures.map((l) => auditLecture(v.language, l)));
  const parity: { lecture: number; ok: boolean; exception: boolean; ranges: Record<string, string[]> }[] = [];
  for (let n = 1; n <= 15; n++) {
    const ranges: Record<string, string[]> = {};
    for (const la of lectures.filter((x) => x.number === n)) ranges[la.lang] = la.timecodes;
    const vals = Object.values(ranges).map((r) => r.join(','));
    parity.push({ lecture: n, ok: vals.every((x) => x === vals[0]), exception: PARITY_EXCEPTIONS.has(n), ranges });
  }

  /* ── Тесты ── */
  const quizzes: QuizAudit[] = [];
  const graded: Record<string, QuestionRow[]> = {};
  const practice: Record<string, { label: string; q: QuestionRow }[]> = {};
  const courseFinalCoverage: Record<string, { covered: number; of: number; missing: number[]; guessed: number }> = {};
  for (const v of versions) {
    graded[v.language] = [];
    practice[v.language] = [];
    for (const m of gradedModules(v)) {
      const { audit, questions } = await auditQuiz(v.language, { kind: 'MODULE_FINAL', module: m.orderIndex }, m.quiz.id);
      quizzes.push(audit);
      graded[v.language]!.push(...questions);
    }
    for (const l of v.lectures) {
      if (!l.miniQuiz) continue;
      const loc: QuizLocator = { kind: 'LECTURE_MINI', lecture: l.number };
      const { audit, questions } = await auditQuiz(v.language, loc, l.miniQuiz.id);
      quizzes.push(audit);
      practice[v.language]!.push(...questions.map((q) => ({ label: audit.label, q })));
    }
    if (v.finalMiniQuiz) {
      const loc: QuizLocator = { kind: 'COURSE_FINAL' };
      const { audit, questions } = await auditQuiz(v.language, loc, v.finalMiniQuiz.id);
      quizzes.push(audit);
      practice[v.language]!.push(...questions.map((q) => ({ label: audit.label, q })));
      const covered = new Set<number>();
      let guessed = 0;
      for (const q of questions) {
        const byId = v.lectures.find((l) => l.id === q.sourceLectureId)?.number;
        if (byId) covered.add(byId);
        else {
          guessed++;
          covered.add(guessLecture(`${q.prompt} ${q.options.join(' ')}`, v.lectures));
        }
      }
      courseFinalCoverage[v.language] = {
        covered: covered.size,
        of: v.lectures.length,
        missing: v.lectures.map((l) => l.number).filter((n) => !covered.has(n)),
        guessed,
      };
    }
  }

  // Паритет canonicalKey оцениваемого банка между языками (по модулю).
  const gradedParity: Record<string, { identical: boolean; counts: Record<string, number>; keys: Record<string, string[]> }> = {};
  for (const mi of [0, 1, 2, 3]) {
    const keys: Record<string, string[]> = {};
    const counts: Record<string, number> = {};
    for (const q of quizzes.filter((x) => x.graded && x.locator.kind === 'MODULE_FINAL' && x.locator.module === mi)) {
      keys[q.lang] = [...q.canonicalKeys].sort();
      counts[q.lang] = q.active;
    }
    const vals = Object.values(keys).map((k) => k.join(','));
    gradedParity[`M${mi + 1}`] = { identical: vals.length === 3 && vals.every((x) => x === vals[0]) && !vals[0]!.includes('∅'), counts, keys };
  }

  /* ── Пересечения оцениваемых и тренировочных (A11) ── */
  const overlaps: { lang: string; practice: string; practicePrompt: string; gradedPrompt: string; jaccard: number; trigram: number }[] = [];
  for (const v of versions) {
    const g = graded[v.language] ?? [];
    for (const p of practice[v.language] ?? []) {
      for (const q of g) {
        const j = jaccard(p.q.prompt, q.prompt);
        const t = v.language === 'kk' ? charTrigramSimilarity(p.q.prompt, q.prompt) : 0;
        if (j > 0.35 || (v.language === 'kk' && t > 0.5)) {
          overlaps.push({ lang: v.language, practice: p.label, practicePrompt: p.q.prompt.slice(0, 120), gradedPrompt: q.prompt.slice(0, 120), jaccard: round(j, 3), trigram: round(t, 3) });
        }
      }
    }
  }

  /* ── Названия ── */
  const titlePrefixes: { lang: string; what: string; title: string; label: string }[] = [];
  const titleProblems: { lang: string; what: string; title: string; problem: string }[] = [];
  for (const v of versions) {
    const titles: { what: string; title: string }[] = [
      ...quizzes.filter((q) => q.lang === v.language).map((q) => ({ what: q.label, title: q.title })),
      ...v.lectures.map((l) => ({ what: `lecture ${lectureCode(v.language, l.number)}`, title: l.title })),
      ...v.modules.filter((m) => m.practicalTask).map((m) => ({ what: `practical ${v.language}`, title: m.practicalTask!.title })),
    ];
    for (const t of titles) {
      const label = russianPrefix(v.language, t.title);
      if (label) titlePrefixes.push({ lang: v.language, ...t, label });
      const problem = lectureTitleProblem(t.title);
      if (problem) titleProblems.push({ lang: v.language, ...t, problem });
    }
  }

  /* ── Практикум ── */
  const practicals = [];
  for (const v of versions) {
    const m = practicalModule(v);
    if (!m?.practicalTask) continue;
    const t = await prisma.practicalTask.findUniqueOrThrow({ where: { id: m.practicalTask.id } });
    const rubric = (t.rubricSpec ?? {}) as { key_points?: unknown[]; answer_reached_criteria?: unknown };
    practicals.push({
      lang: v.language,
      title: t.title,
      tokenBudget: t.tokenBudget,
      maxAiMessages: t.maxAiMessages,
      maxSessions: t.maxSessions,
      estimatedMinutes: t.estimatedMinutes,
      canonicalRef: t.canonicalRef,
      isEdited: t.isEdited,
      keyPoints: Array.isArray(rubric.key_points) ? rubric.key_points.length : 0,
      hasCriteria: typeof rubric.answer_reached_criteria === 'string' && !!rubric.answer_reached_criteria.trim(),
      agenda: t.agenda,
      sessions: await prisma.practicalSession.count({ where: { practicalTaskId: t.id } }),
    });
  }

  /* ── Отметки на проверку ── */
  const issues = await prisma.contentIssue.findMany({
    where: { origin: 'SYSTEM', status: 'OPEN', courseId: course.courseId },
    select: { reason: true, languageVersionId: true, targetType: true },
  });
  const langOfVersion = new Map(versions.map((v) => [v.id, v.language]));
  const reviewByReasonLang: Record<string, number> = {};
  for (const i of issues) {
    const k = `${i.reason}:${langOfVersion.get(i.languageVersionId ?? '') ?? '?'}:${i.targetType}`;
    reviewByReasonLang[k] = (reviewByReasonLang[k] ?? 0) + 1;
  }

  /* ── Студенческие данные ── */
  const rescored = await rescoreAttempts(prisma);
  const studentData = {
    attempts: await prisma.quizAttempt.count(),
    attemptsSubmitted: await prisma.quizAttempt.count({ where: { submittedAt: { not: null } } }),
    attemptsWithoutPresentation: await prisma.quizAttempt.count({ where: { presentation: { equals: Prisma.DbNull } } }),
    sessions: await prisma.practicalSession.count(),
    sessionsWithoutSnapshot: await prisma.practicalSession.count({ where: { taskSnapshot: { equals: Prisma.DbNull } } }),
    lectureProgress: await prisma.lectureProgress.count(),
    enrollments: await prisma.enrollment.count(),
    chatMessages: await prisma.chatMessage.count(),
    rescoreMismatches: rescored.filter((r) => !r.ok).map((r) => `${r.attemptId}: ${r.stored} → ${r.rescored}`),
  };
  const demo = await prisma.courseLanguageVersion.findFirst({ where: { title: DEMO_COURSE_TITLE }, include: { course: { select: { status: true } } } });

  /* ── Сводка (для диффа) и критерии выхода ── */
  const gradedQ = quizzes.filter((q) => q.graded);
  const politQuestions = quizzes.reduce((a, q) => a + q.active, 0);
  const summary = {
    chatArtifactLines: lectures.reduce((a, l) => a + l.chatArtifacts.length, 0),
    duplicateParagraphs: lectures.reduce((a, l) => a + l.duplicateParagraphs.length, 0),
    duplicateSections: lectures.reduce((a, l) => a + l.duplicateSections.length, 0),
    metaLinesBeforeFirstTimecode: lectures.reduce((a, l) => a + l.metaBeforeFirstTimecode.length, 0),
    trailers: lectures.reduce((a, l) => a + l.trailers.length, 0),
    sentencePerLineLectures: lectures.filter((l) => l.sentencePerLine).map((l) => l.code).join(',') || '—',
    timecodeParityMismatches: parity.filter((p) => !p.ok && !p.exception).map((p) => p.lecture).join(',') || '—',
    bintrouHits: lectures.reduce((a, l) => a + l.bintrou, 0) + quizzes.reduce((a, q) => a + q.bintrou, 0),
    kkLexiconTypos:
      lectures.reduce((a, l) => a + Object.values(l.kkLexicon).reduce((x, y) => x + y, 0), 0) +
      quizzes.reduce((a, q) => a + Object.values(q.kkLexicon).reduce((x, y) => x + y, 0), 0),
    russianTitlePrefixes: titlePrefixes.length,
    titleProblems: titleProblems.length,
    gradedCounts: gradedQ.map((q) => `${q.label}=${q.active}`).join(' '),
    gradedNot8: gradedQ.filter((q) => q.active !== 8).length,
    gradedCanonicalParity: Object.entries(gradedParity).map(([k, p]) => `${k}:${p.identical ? 'ok' : 'DIFF'}`).join(' '),
    gradedMaxKeyShare: Math.max(0, ...gradedQ.map((q) => q.maxKeyShare)),
    gradedLengthCues: gradedQ.reduce((a, q) => a + q.lengthCues, 0),
    gradedMaxTestwise: Math.max(0, ...gradedQ.map((q) => q.testwise)),
    gradedLongestIsKeyRate: round(gradedQ.reduce((a, q) => a + q.longestIsKeyRate * q.active, 0) / Math.max(1, gradedQ.reduce((a, q) => a + q.active, 0)), 3),
    gradedPracticeOverlaps: overlaps.length,
    courseFinalCoverage: Object.entries(courseFinalCoverage).map(([l, c]) => `${l}:${c.covered}/${c.of}`).join(' '),
    rationalesCoverage: `${politQuestions - quizzes.reduce((a, q) => a + q.rationalesMissing, 0)}/${politQuestions}`,
    rationalesBadLength: quizzes.reduce((a, q) => a + q.rationalesBadLength, 0),
    rationalesShort: quizzes.reduce((a, q) => a + q.rationalesShort.length, 0),
    questionLanguageProblems: quizzes.reduce((a, q) => a + q.languageProblems.length, 0),
    practiceTfTrue: versions
      .map((v) => {
        const p = quizzes.filter((q) => q.lang === v.language && !q.graded);
        return `${v.language}:${p.reduce((a, q) => a + q.tf.trueKey, 0)}/${p.reduce((a, q) => a + q.tf.total, 0)}`;
      })
      .join(' '),
    practicals: practicals.map((p) => `${p.lang}:${p.tokenBudget}/${p.maxAiMessages}/${p.maxSessions}/${p.estimatedMinutes ?? '∅'}/${p.canonicalRef ?? '∅'}/kp${p.keyPoints}`).join(' '),
    lecturesWithoutDuration: lectures.filter((l) => l.durationSec === null).length,
    lecturesWithoutSummary: lectures.filter((l) => !l.hasSummary).length,
    openSystemReviewIssues: issues.length,
    attempts: studentData.attempts,
    attemptsWithoutPresentation: studentData.attemptsWithoutPresentation,
    sessions: studentData.sessions,
    sessionsWithoutSnapshot: studentData.sessionsWithoutSnapshot,
    lectureProgress: studentData.lectureProgress,
    rescoreMismatches: studentData.rescoreMismatches.length,
    demoCourse: demo ? `${demo.status}/${demo.course.status}` : 'нет',
  };

  const exit = {
    transcriptsClean: summary.chatArtifactLines === 0 && summary.duplicateSections === 0 && summary.duplicateParagraphs === 0 && summary.metaLinesBeforeFirstTimecode === 0,
    timecodeParity: summary.timecodeParityMismatches === '—',
    kkTextClean: summary.bintrouHits === 0 && summary.kkLexiconTypos === 0,
    titles: summary.russianTitlePrefixes === 0 && summary.titleProblems === 0,
    gradedBank:
      summary.gradedNot8 === 0 &&
      !summary.gradedCanonicalParity.includes('DIFF') &&
      summary.gradedMaxKeyShare <= 0.4 &&
      summary.gradedLengthCues === 0 &&
      summary.gradedMaxTestwise < 0.7,
    practiceOverlap: summary.gradedPracticeOverlaps === 0,
    courseFinal: Object.values(courseFinalCoverage).every((c) => c.covered === c.of && c.guessed === 0),
    rationales: quizzes.every((q) => q.rationalesMissing === 0) && summary.rationalesBadLength === 0 && summary.rationalesShort === 0,
    questionLanguage: summary.questionLanguageProblems === 0,
    practicals: practicals.length === 3 && practicals.every((p) => p.canonicalRef === 'polisia-v1' && p.keyPoints === 9 && p.maxAiMessages === 24 && p.maxSessions === 2 && p.estimatedMinutes === 25) && practicals.every((p) => p.tokenBudget === ({ ru: 160000, kk: 190000, en: 120000 } as Record<string, number>)[p.lang]),
    lectures: summary.lecturesWithoutDuration === 0 && summary.lecturesWithoutSummary === 0,
    demoArchived: summary.demoCourse === 'ARCHIVED/ARCHIVED',
    studentData: summary.attemptsWithoutPresentation === 0 && summary.sessionsWithoutSnapshot === 0 && summary.rescoreMismatches === 0,
  };

  /* ── Печать ── */
  log('\n══ Расшифровки ══');
  for (const l of lectures) {
    const flags = [
      l.chatArtifacts.length ? `чат ${l.chatArtifacts.length}` : '',
      l.duplicateSections.length ? `дубли разделов ${l.duplicateSections.length}` : '',
      l.duplicateParagraphs.length ? `дубли абзацев ${l.duplicateParagraphs.length}` : '',
      l.metaBeforeFirstTimecode.length ? `метаданные ${l.metaBeforeFirstTimecode.length}` : '',
      l.trailers.length ? `хвост ${l.trailers.length}` : '',
      l.sentencePerLine ? `строка=предложение (медиана ${l.medianProseLine})` : '',
      Object.keys(l.kkLexicon).length ? `лексикон ${JSON.stringify(l.kkLexicon)}` : '',
      l.bintrou ? `Бинтроу ${l.bintrou}` : '',
      l.durationSec === null ? 'нет durationSec' : '',
      !l.hasSummary ? 'нет summary' : '',
      l.titleProblem ? `название: ${l.titleProblem}` : '',
    ].filter(Boolean);
    log(`  ${l.code} ${String(l.chars).padStart(6)} симв · таймкодов ${l.timecodes.length}${l.kkIRatio !== null ? ` · і/(і+и) ${l.kkIRatio}` : ''}${flags.length ? ` · ${flags.join(' · ')}` : ''}`);
    for (const x of [...l.chatArtifacts, ...l.duplicateSections, ...l.duplicateParagraphs, ...l.metaBeforeFirstTimecode, ...l.trailers]) log(`      ${x}`);
  }
  log('\n══ Паритет таймкодов ══');
  for (const p of parity) {
    if (p.ok) continue;
    log(`  лекция ${p.lecture}${p.exception ? ' (документированное исключение)' : ''}:`);
    for (const [lang, r] of Object.entries(p.ranges)) log(`     ${lang} ${r.join(' ')}`);
  }
  log('\n══ Оцениваемые тесты ══');
  for (const q of gradedQ) {
    log(
      `  ${q.label} «${q.title.slice(0, 60)}» · вопросов ${q.active} (архив ${q.archived}) · ключи ${JSON.stringify(q.keyHistogram)} max ${q.maxKeyShare} · самый длинный=ключ ${q.longestIsKeyRate} · TF верно ${q.tfTrueRatio ?? '—'} · testwise ${q.testwise} · подсказка длиной ${q.lengthCues} · попытки ${q.maxAttempts}/${q.scoringRule}/${q.cooldownMinutes ?? 'env'}/${q.reviewPolicy}`,
    );
  }
  for (const [k, p] of Object.entries(gradedParity)) log(`  ${k} canonicalKey: ${p.identical ? 'совпадают' : 'РАСХОДЯТСЯ'} ${JSON.stringify(p.counts)}`);
  const langIssues = quizzes.filter((q) => q.languageProblems.length || q.rationalesShort.length);
  log(`\n══ Язык текстов и обоснования: чужой алфавит/метка ${summary.questionLanguageProblems}, обоснований короче ${MIN_RATIONALE_CHARS} симв. ${summary.rationalesShort} ══`);
  for (const q of langIssues) for (const x of [...q.languageProblems, ...q.rationalesShort.map((r) => `коротко ${r}`)]) log(`  ${q.label} ${x}`);
  log(`  TRUE_FALSE тренировки, ключ «верно»: ${summary.practiceTfTrue}`);
  log(`\n══ Пересечения оцениваемых и тренировочных: ${overlaps.length} ══`);
  for (const o of overlaps) log(`  ${o.practice} J=${o.jaccard}${o.lang === 'kk' ? ` T=${o.trigram}` : ''}\n      практика: ${o.practicePrompt}\n      тест:     ${o.gradedPrompt}`);
  log('\n══ Итоговый мини-квиз: покрытие лекций ══');
  for (const [l, c] of Object.entries(courseFinalCoverage)) log(`  ${l}: ${c.covered}/${c.of}${c.guessed ? ` (угадано по словарю: ${c.guessed})` : ''}${c.missing.length ? ` · нет: ${c.missing.join(',')}` : ''}`);
  log(`\n══ Названия: русских префиксов ${titlePrefixes.length}, проблем ${titleProblems.length} ══`);
  for (const t of titlePrefixes) log(`  ${t.lang} ${t.what}: «${t.title.slice(0, 90)}» (${t.label})`);
  for (const t of titleProblems) log(`  ${t.lang} ${t.what}: ${t.problem} — «${t.title.slice(0, 90)}»`);
  log('\n══ Практикум ══');
  for (const p of practicals) {
    log(`  ${p.lang} «${p.title}» · бюджет ${p.tokenBudget} · реплик ${p.maxAiMessages} · попыток ${p.maxSessions} · ~${p.estimatedMinutes ?? '∅'} мин · canonicalRef ${p.canonicalRef ?? '∅'} · isEdited ${p.isEdited} · тезисов ${p.keyPoints}${p.hasCriteria ? '' : ' · НЕТ критерия'} · план ${JSON.stringify(p.agenda)} · сессий ${p.sessions}`);
  }
  log(`\n══ Открытые системные отметки: ${issues.length} ══`);
  for (const [k, n] of Object.entries(reviewByReasonLang).sort()) log(`  ${k}: ${n}`);
  log('\n══ Студенческие данные ══');
  log(`  ${JSON.stringify(studentData)}`);
  log(`  демо-курс «${DEMO_COURSE_TITLE}»: ${summary.demoCourse}`);

  console.log('\n══ Сводка ══');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
  console.log('\n══ Критерии выхода ══');
  for (const [k, v] of Object.entries(exit)) console.log(`  ${v ? '✔' : '✖'} ${k}`);

  const baselinePath = args.get('--baseline');
  let diff: Record<string, { before: unknown; after: unknown }> | null = null;
  if (baselinePath) {
    if (!existsSync(baselinePath)) throw new Error(`--baseline: файл не найден ${baselinePath}`);
    const before = (JSON.parse(readFileSync(baselinePath, 'utf8')) as { summary: Record<string, unknown> }).summary;
    diff = {};
    for (const [k, v] of Object.entries(summary)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(v)) diff[k] = { before: before[k], after: v };
    }
    console.log(`\n══ Дифф с ${baselinePath} ══`);
    for (const [k, d] of Object.entries(diff)) console.log(`  ${k}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`);
    if (!Object.keys(diff).length) console.log('  без изменений');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    courseId: course.courseId,
    summary,
    exit,
    diff,
    lectures,
    parity,
    quizzes,
    gradedParity,
    overlaps,
    courseFinalCoverage,
    titlePrefixes,
    titleProblems,
    practicals,
    reviewByReasonLang,
    studentData,
    rescored,
  };
  console.log(`\nJSON: ${writePreview(args, report)}`);
  return 0;
}

run(main);
