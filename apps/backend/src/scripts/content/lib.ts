/**
 * Общая «сантехника» контент-скриптов курса «Введение в политологию» (CONTENT-repair;
 * USER_DECISIONS §1, §4, §5). Каждый скрипт:
 *  - по умолчанию — предпросмотр: печатает сводку/дифф и пишет JSON предпросмотра, в БД не пишет;
 *  - пишет только с `--apply --i-have-a-backup` (перед первым применением — pg_dump);
 *  - сопоставляет данные по СОДЕРЖАНИЮ (курс — по названию ru-версии, модули — по orderIndex,
 *    лекции — по (модуль, лекция), тексты — по точным якорям), а не по cuid: те же скрипты
 *    запускаются потом на проде, где id другие;
 *  - идемпотентен: единица работы проверяет текущее состояние и ключ журнала ContentMigration
 *    `content:v1:<скрипт>:<единица>`; повторный --apply меняет 0 строк;
 *  - одна транзакция Prisma на единицу работы и одна строка сводки на единицу.
 *
 * LLM-скрипты фазы 2 пишут проверенные JSON-артефакты в content-data/politology
 * (`--draft`), а применяют их без LLM (`--apply --from <файл>`) — на проде черновики
 * НЕ перегенерируются. Импорты — только относительные `.js` (скрипты работают и из dist).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import type { ContentIssueTarget, Language, SystemReviewReason } from '@edu/shared';
import type { DraftQuestion } from '../../generation/drafts.js';
import { prisma } from '../../lib/prisma.js';
import { parseStoredAnswers, presentedQuestions, toPolicyQuestion } from '../../modules/quizzes/policy.js';
import { scoreQuiz } from '../../modules/quizzes/scoring.js';
import { type TextFix, applyTextEdits, validateTextFixes } from './revisions.js';

export { prisma };

export type Db = Prisma.TransactionClient | typeof prisma;
export const LANGS: readonly Language[] = ['ru', 'kk', 'en'];
/** Курс ищется по названию русской версии (сопоставление по содержанию, не по id). */
export const COURSE_RU_TITLE = 'Введение в политологию';
export const LEDGER_PREFIX = 'content:v1';
/** Каталог apps/backend (скрипт лежит в src/scripts/content или dist/scripts/content). */
export const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_DATA_DIR = join(BACKEND_DIR, 'content-data', 'politology');

/* ── Аргументы ──────────────────────────────────────────────────── */

export interface ScriptArgs {
  script: string;
  apply: boolean;
  backup: boolean;
  draft: boolean;
  force: boolean;
  dataDir: string;
  from: string | null;
  out: string | null;
  langs: Language[];
  argv: string[];
  has(flag: string): boolean;
  get(flag: string): string | undefined;
}

export interface ParseOptions {
  /** Скрипт умеет --draft (LLM-черновик → JSON). */
  llm?: boolean;
  /** Скрипт только читает (аудит): --apply запрещён. */
  readOnly?: boolean;
}

/** Разбор флагов (README): --apply, --i-have-a-backup, --data, --draft, --from, --lang, --force, --out. */
export function parseArgs(script: string, opts: ParseOptions = {}): ScriptArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);
  const langs = (get('--lang') ?? LANGS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const l of langs) if (!LANGS.includes(l as Language)) fail(`Неизвестный язык в --lang: ${l}`);
  const dataArg = get('--data');
  const dataDir = dataArg ? (isAbsolute(dataArg) ? dataArg : resolve(process.cwd(), dataArg)) : DEFAULT_DATA_DIR;
  const fromArg = get('--from');
  const from = fromArg ? resolveArtifactPath(fromArg, dataDir) : null;
  const args: ScriptArgs = {
    script,
    apply: has('--apply'),
    backup: has('--i-have-a-backup'),
    draft: has('--draft'),
    force: has('--force'),
    dataDir,
    from,
    out: get('--out') ?? null,
    langs: langs as Language[],
    argv,
    has,
    get,
  };
  if (opts.readOnly && args.apply) fail(`${script}: скрипт только читает — --apply не поддерживается`);
  if (args.apply && !args.backup) {
    fail('--apply требует --i-have-a-backup: сначала сделайте резервную копию (pg_dump -Fc), см. scripts/content/README.md');
  }
  if (args.draft && !opts.llm) fail(`${script}: --draft есть только у LLM-скриптов фазы 2`);
  if (args.draft && args.apply) fail('--draft и --apply несовместимы: черновик пишет только JSON, применение — из файла (--from)');
  return args;
}

/** Путь артефакта: абсолютный, относительный к cwd или просто имя файла в --data. */
export function resolveArtifactPath(p: string, dataDir: string): string {
  if (isAbsolute(p)) return p;
  const cwdPath = resolve(process.cwd(), p);
  if (existsSync(cwdPath)) return cwdPath;
  return join(dataDir, p);
}

export function fail(message: string, code = 2): never {
  console.error(`❌ ${message}`);
  process.exit(code);
}

/* ── Курс по содержанию ─────────────────────────────────────────── */

const lectureSelect = {
  id: true,
  orderIndex: true,
  title: true,
  transcriptText: true,
  durationSec: true,
  summary: true,
  youtubeVideoId: true,
  miniQuiz: { select: { id: true, title: true } },
} satisfies Prisma.LectureSelect;

const moduleInclude = {
  lectures: { orderBy: { orderIndex: 'asc' }, select: lectureSelect },
  quiz: { select: { id: true, title: true, kind: true, isGraded: true } },
  practicalTask: { select: { id: true, title: true } },
} satisfies Prisma.ModuleInclude;

export interface LectureCtx {
  id: string;
  /** Сквозной номер лекции курса, с 1 (по (module.orderIndex, lecture.orderIndex)). */
  number: number;
  moduleOrder: number;
  lectureOrder: number;
  title: string;
  transcriptText: string;
  durationSec: number | null;
  summary: string | null;
  miniQuiz: { id: string; title: string } | null;
}

export interface ModuleCtx {
  id: string;
  orderIndex: number;
  title: string;
  assessmentType: string;
  coversWholeCourse: boolean;
  lectures: LectureCtx[];
  quiz: { id: string; title: string; kind: string; isGraded: boolean } | null;
  practicalTask: { id: string; title: string } | null;
}

export interface VersionCtx {
  id: string;
  language: Language;
  title: string;
  status: string;
  description: string | null;
  modules: ModuleCtx[];
  lectures: LectureCtx[];
  finalMiniQuiz: { id: string; title: string } | null;
}

export interface CourseCtx {
  courseId: string;
  status: string;
  versions: Partial<Record<Language, VersionCtx>>;
}

/** Курс «Введение в политологию» и все его языковые версии (по названию ru-версии). */
export async function loadCourse(db: Db = prisma, ruTitle = COURSE_RU_TITLE): Promise<CourseCtx> {
  const anchor = await db.courseLanguageVersion.findFirst({ where: { title: ruTitle, language: 'ru' }, select: { courseId: true } });
  if (!anchor) fail(`Курс с ru-версией «${ruTitle}» не найден`);
  const course = await db.course.findUniqueOrThrow({ where: { id: anchor.courseId }, select: { id: true, status: true } });
  const versions = await db.courseLanguageVersion.findMany({
    where: { courseId: course.id },
    include: {
      modules: { orderBy: { orderIndex: 'asc' }, include: moduleInclude },
      finalMiniQuiz: { select: { id: true, title: true } },
    },
  });
  const out: CourseCtx = { courseId: course.id, status: course.status, versions: {} };
  for (const v of versions) {
    let n = 0;
    const modules: ModuleCtx[] = v.modules.map((m) => ({
      id: m.id,
      orderIndex: m.orderIndex,
      title: m.title,
      assessmentType: m.assessmentType,
      coversWholeCourse: m.coversWholeCourse,
      quiz: m.quiz,
      practicalTask: m.practicalTask,
      lectures: m.lectures.map((l) => ({
        id: l.id,
        number: ++n,
        moduleOrder: m.orderIndex,
        lectureOrder: l.orderIndex,
        title: l.title,
        transcriptText: l.transcriptText,
        durationSec: l.durationSec,
        summary: l.summary,
        miniQuiz: l.miniQuiz,
      })),
    }));
    out.versions[v.language as Language] = {
      id: v.id,
      language: v.language as Language,
      title: v.title,
      status: v.status,
      description: v.description,
      modules,
      lectures: modules.flatMap((m) => m.lectures),
      finalMiniQuiz: v.finalMiniQuiz,
    };
  }
  return out;
}

export function version(course: CourseCtx, lang: Language): VersionCtx {
  const v = course.versions[lang];
  if (!v) fail(`У курса нет языковой версии ${lang}`);
  return v;
}

/** «kk-07» — код лекции в отчётах и ключах журнала. */
export const lectureCode = (lang: string, n: number) => `${lang}-${String(n).padStart(2, '0')}`;

export function lectureByNumber(v: VersionCtx, n: number): LectureCtx {
  const l = v.lectures.find((x) => x.number === n);
  if (!l) fail(`${v.language}: лекция №${n} не найдена`);
  return l;
}

export function lectureByPos(v: VersionCtx, moduleOrder: number, lectureOrder: number): LectureCtx | undefined {
  return v.lectures.find((l) => l.moduleOrder === moduleOrder && l.lectureOrder === lectureOrder);
}

/** Оцениваемые модули с тестом (I–IV): M1..M4 по порядку модулей. */
export function gradedModules(v: VersionCtx): (ModuleCtx & { key: string; quiz: NonNullable<ModuleCtx['quiz']> })[] {
  return v.modules
    .filter((m) => m.assessmentType === 'QUIZ' && m.quiz?.isGraded)
    .map((m, i) => ({ ...m, key: `M${i + 1}`, quiz: m.quiz! }));
}

/** Модуль итогового практикума (весь курс) — единственный с PracticalTask. */
export function practicalModule(v: VersionCtx): ModuleCtx | undefined {
  return v.modules.find((m) => m.practicalTask) ?? undefined;
}

/* ── Переносимые ссылки (артефакты не хранят локальные cuid) ─────── */

/** Лекция-источник вопроса в артефакте: по позиции, а не по id. */
export interface LectureRef {
  module: number;
  lecture: number;
  /** Сквозной номер (для чтения человеком). */
  number: number;
}

export type QuizLocator = { kind: 'MODULE_FINAL'; module: number } | { kind: 'LECTURE_MINI'; lecture: number } | { kind: 'COURSE_FINAL' };

export const locatorLabel = (lang: string, loc: QuizLocator) =>
  loc.kind === 'MODULE_FINAL' ? `${lang}:M${loc.module + 1}` : loc.kind === 'LECTURE_MINI' ? `${lang}:mini-${String(loc.lecture).padStart(2, '0')}` : `${lang}:course-final`;

/** id теста по переносимому локатору (или null — нет такого теста). */
export function resolveQuiz(v: VersionCtx, loc: QuizLocator): string | null {
  if (loc.kind === 'MODULE_FINAL') return v.modules.find((m) => m.orderIndex === loc.module)?.quiz?.id ?? null;
  if (loc.kind === 'LECTURE_MINI') return v.lectures.find((l) => l.number === loc.lecture)?.miniQuiz?.id ?? null;
  return v.finalMiniQuiz?.id ?? null;
}

export function lectureRefOf(v: VersionCtx, lectureId: string | null): LectureRef | null {
  if (!lectureId) return null;
  const l = v.lectures.find((x) => x.id === lectureId);
  return l ? { module: l.moduleOrder, lecture: l.lectureOrder, number: l.number } : null;
}

export function lectureIdOf(v: VersionCtx, ref: LectureRef | null | undefined): string | null {
  if (!ref) return null;
  return lectureByPos(v, ref.module, ref.lecture)?.id ?? null;
}

/* ── Журнал ContentMigration ────────────────────────────────────── */

export const ledgerKey = (script: string, unit: string) => `${LEDGER_PREFIX}:${script}:${unit}`;

/** Ключ «фаза A выполнена» (snapshot-sessions) — его проверяют graded-bank и canonical-practical. */
export const PHASE_A_DONE_KEY = `${LEDGER_PREFIX}:snapshot-sessions:done`;

/** Отказ записи, если фаза A не выполнена или появились новые попытки/сессии без снимка. */
export async function assertPhaseA(db: Db = prisma): Promise<void> {
  if (!(await ledgerGet(db, PHASE_A_DONE_KEY))) fail('Фаза A не выполнена: сначала snapshot-sessions.ts --apply');
  const s = await db.practicalSession.count({ where: { taskSnapshot: { equals: Prisma.DbNull } } });
  const a = await db.quizAttempt.count({ where: { presentation: { equals: Prisma.DbNull } } });
  if (s || a) fail(`После фазы A появились данные без снимка (сессий ${s}, попыток ${a}) — повторите snapshot-sessions.ts --apply`);
}

export async function ledgerGet(db: Db, key: string) {
  return db.contentMigration.findUnique({ where: { key } });
}

export async function ledgerPut(db: Db, key: string, detail: Record<string, unknown>): Promise<void> {
  await db.contentMigration.create({ data: { key, detail: detail as Prisma.InputJsonValue } });
}

/* ── Системные отметки на проверку (ContentIssue origin SYSTEM) ──── */

export interface ReviewFlag {
  reason: SystemReviewReason;
  targetType: ContentIssueTarget;
  targetId: string;
  courseId: string;
  languageVersionId: string | null;
  comment: string;
  /** По умолчанию review:v1:<reason>:<targetId>. */
  dedupeKey?: string;
}

/**
 * Отметка «на проверку» в очереди менеджера: origin SYSTEM, reporterId null, context
 * CONTENT_PIPELINE. Идемпотентна по dedupeKey. Возвращает true, если создана.
 */
export async function flagForReview(db: Db, f: ReviewFlag): Promise<boolean> {
  const dedupeKey = f.dedupeKey ?? `review:v1:${f.reason}:${f.targetId}`;
  const existing = await db.contentIssue.findUnique({ where: { dedupeKey }, select: { id: true } });
  if (existing) return false;
  await db.contentIssue.create({
    data: {
      origin: 'SYSTEM',
      reporterId: null,
      targetType: f.targetType,
      targetId: f.targetId,
      reason: f.reason,
      comment: f.comment,
      context: 'CONTENT_PIPELINE',
      courseId: f.courseId,
      languageVersionId: f.languageVersionId,
      dedupeKey,
    },
  });
  return true;
}

/**
 * Снимает (DISMISSED) открытые СИСТЕМНЫЕ отметки с вопросов, которые ушли в архив
 * (их заменил новый банк) — чтобы очередь менеджера не зарастала устаревшими задачами.
 * Жалобы студентов не трогаются.
 */
export async function dismissSystemFlags(db: Db, targetIds: string[], note: string): Promise<number> {
  if (!targetIds.length) return 0;
  const r = await db.contentIssue.updateMany({
    // Только отметки контент-скриптов (dedupeKey review:v1:…), не чужие системные отметки.
    where: { origin: 'SYSTEM', status: 'OPEN', targetType: 'QUIZ_QUESTION', targetId: { in: targetIds }, dedupeKey: { startsWith: 'review:v1:' } },
    data: { status: 'DISMISSED', note, resolvedAt: new Date() },
  });
  return r.count;
}

/* ── Отчёт ───────────────────────────────────────────────────────── */

export type UnitStatus = 'changed' | 'would-change' | 'skip' | 'error';

/** Строки «unit · changed/skip · reason» и итоговая сводка. */
export class Report {
  readonly rows: { unit: string; status: UnitStatus; reason: string }[] = [];
  constructor(readonly script: string, readonly apply: boolean) {}

  line(unit: string, status: UnitStatus, reason: string): void {
    this.rows.push({ unit, status, reason });
    const mark = status === 'changed' ? '✔' : status === 'would-change' ? '→' : status === 'error' ? '✖' : '·';
    console.log(`${mark} ${unit} · ${status} · ${reason}`);
  }

  get errors() {
    return this.rows.filter((r) => r.status === 'error').length;
  }

  summary(): string {
    const c = (s: UnitStatus) => this.rows.filter((r) => r.status === s).length;
    return `${this.script}: ${this.apply ? 'ПРИМЕНЕНО' : 'ПРЕДПРОСМОТР'} · changed ${c('changed')} · would-change ${c('would-change')} · skip ${c('skip')} · error ${c('error')}`;
  }
}

/* ── Файлы: предпросмотр и артефакты ─────────────────────────────── */

/** JSON предпросмотра — вне репозитория (tmp) или по --out. Возвращает путь. */
export function writePreview(args: ScriptArgs, data: unknown): string {
  const path =
    args.out ?? join(tmpdir(), 'eduopen-content-preview', `${args.script}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}

export function readArtifact<T>(path: string): T {
  if (!existsSync(path)) fail(`Артефакт не найден: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Правки человека в артефакте: meta.reviewEdits / reviewNotes / textFixes (сколько записей). */
export function reviewedEntries(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    const meta = (JSON.parse(readFileSync(path, 'utf8')) as { meta?: Record<string, unknown> }).meta ?? {};
    return ['reviewEdits', 'reviewNotes', 'textFixes'].reduce((n, k) => n + (Array.isArray(meta[k]) ? (meta[k] as unknown[]).length : 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Пишет артефакт в content-data (стабильный JSON, 2 пробела). Проверенный человеком артефакт
 * (есть записи в meta.reviewEdits/reviewNotes/textFixes) черновик НЕ перезаписывает: без
 * --overwrite-reviewed он пишется рядом, в `<имя>.draft-<время>.json` — правки рецензента
 * переносятся вручную (отдельный флаг, а не --force: у --draft некоторых скриптов --force уже
 * означает «перегенерировать и заданное вручную»).
 */
export function writeArtifact(dataDir: string, name: string, data: unknown, opts: { overwriteReviewed?: boolean } = {}): string {
  mkdirSync(dataDir, { recursive: true });
  let path = join(dataDir, name);
  const reviewed = reviewedEntries(path);
  if (reviewed && !opts.overwriteReviewed) {
    path = join(dataDir, name.replace(/\.json$/u, `.draft-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    console.warn(`⚠ ${name} проверен человеком (правок рецензента: ${reviewed}) — черновик записан отдельно: ${path}; перезапись — только с --overwrite-reviewed`);
  }
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Число непробельных символов (инвариант склейки абзацев). */
export const nonWs = (s: string) => s.replace(/\s+/gu, '').length;

/** Сколько раз подстрока встречается в тексте. */
export function countOf(text: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = text.indexOf(needle);
  while (i !== -1) {
    n++;
    i = text.indexOf(needle, i + needle.length);
  }
  return n;
}

/** Замена по точному якорю с проверкой числа попаданий. */
export function replaceAnchor(text: string, anchor: string, replacement: string, expected: number, where: string): string {
  const n = countOf(text, anchor);
  if (n !== expected) throw new Error(`${where}: якорь «${anchor}» найден ${n} раз(а), ожидалось ${expected}`);
  return text.split(anchor).join(replacement);
}

/** Завершение процесса: отключить Prisma и выйти (redis LLM-шлюза закрывается вместе с процессом). */
export async function finish(code = 0): Promise<never> {
  await prisma.$disconnect().catch(() => undefined);
  process.exit(code);
}

/** Обёртка main: ошибки → ✖ и код 1. */
export function run(main: () => Promise<number | void>): void {
  main()
    .then((code) => finish(typeof code === 'number' ? code : 0))
    .catch(async (e: unknown) => {
      console.error('✖', e instanceof Error ? (e.stack ?? e.message) : e);
      await finish(1);
    });
}

/* ── Расшифровки: общие регулярные выражения (fix-transcripts, audit, durations) ── */

/** Заголовок раздела «[mm:ss–mm:ss] Заголовок» (терпимо к пробелам: «[00:00 –01 : 30 ]»). */
export const TIMECODE_LINE_RE = /^\s*\[\s*(\d{1,3})\s*:\s*(\d{2})\s*[–—-]\s*(\d{1,3})\s*:\s*(\d{2})\s*\]\s*(.*)$/;

/** Нормализованный заголовок раздела: «[00:00–01:30] Заголовок». */
export function normalizeTimecodeLine(line: string): string {
  const m = TIMECODE_LINE_RE.exec(line);
  if (!m) return line;
  const pad = (x: string) => x.padStart(2, '0');
  const title = m[5]!.trim();
  return `[${pad(m[1]!)}:${m[2]}–${pad(m[3]!)}:${m[4]}]${title ? ` ${title}` : ''}`;
}

export const isTimecodeLine = (line: string) => TIMECODE_LINE_RE.test(line);

/** Начала разделов «mm:ss–mm:ss» по порядку (паритет таймкодов ru/kk/en). */
export function timecodeRanges(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = TIMECODE_LINE_RE.exec(line);
    if (m) out.push(`${m[1]!.padStart(2, '0')}:${m[2]}–${m[3]!.padStart(2, '0')}:${m[4]}`);
  }
  return out;
}

/**
 * Реплики чат-ассистента и сессии перевода, попавшие в расшифровки (en-01, en-02,
 * ru-02, kk-02) + общие шаблоны для аудита.
 */
export const CHAT_ARTIFACT_RES: RegExp[] = [
  /этот же текст, также с хронометражем/i,
  /^\s*Orchestrated translation/i,
  /^\s*Готово\s*[—–-]/,
  /^\s*Document\s*·/,
  /^\s*отправь\s+(в\s+окно|текст\s+в\s+диалог)/i,
  /^\s*Resolved to /,
  /^\s*Вот текст лекции/,
  /блот\s*\d/i,
  /^\s*ЛЕКЦИЯ\s*№\s*\d+\s*-\s*казақша/,
  /^\s*Created a file/,
  /^\s*Присылайте\s/,
  /^\s*Recognized request/,
  /переведи\s+на\s+(казахский|английский|русский)/i,
  /^\s*Конечно\s*[—–-]\s*вот/,
  /^\s*(Sure|Here is|Here's)[,!]?\s+(the|your)\s+(translation|text|lecture)/i,
];

export const isChatArtifact = (line: string) => CHAT_ARTIFACT_RES.some((re) => re.test(line));

/** Строка служебных метаданных производства видео (до первого таймкода). */
export const META_LINE_RE =
  /^\s*(?:Курс\s*:|Course\s*:|Пән\s*:|Video\s+(?:Duration|length)(?![\p{L}\p{N}])|Format\s*:|Runtime(?![\p{L}\p{N}])|Хронометраж(?![\p{L}\p{N}])|Формат\S*\s*:|Тіл\s*:|Язык\s*:|Language\s*:|Бейнедәрістің\s+ұзақтығы|Бейненің\s+(?:хронометражы|ұзақтығы)|Видео\s+хронометраж\S*|Объ[её]м(?![\p{L}\p{N}])|Көлемі\s*:|Мәтін\s+көлемі|Word\s+count(?![\p{L}\p{N}])|Length\s*:)/iu;

/** Строка-название курса в шапке («ВВЕДЕНИЕ В ПОЛИТОЛОГИЮ», «Курс «…»», ««…» курсы»). */
export const COURSE_NAME_LINE_RE =
  /^\s*(?:INTRODUCTION TO POLITICAL SCIENCE|ВВЕДЕНИЕ В ПОЛИТОЛОГИЮ|САЯСАТТАНУҒА КІРІСПЕ|Course\s+["“«].*["”»]|Курс\s+«[^»]*»|«[^»]*»\s+курсы)\s*$/u;

/** Метаданные, «приклеенные» к строке названия: режем с этой позиции (если она > 0). */
export const INLINE_META_RE =
  /(?:Курс|Course|Пән)\s*:|(?:Video\s+(?:length|duration)|Хронометраж\s+видео|Видео\s+хронометраж\S*|Бейненің\s+(?:хронометражы|ұзақтығы))\s*:/u;

export const isMetaLine = (line: string) => META_LINE_RE.test(line) || COURSE_NAME_LINE_RE.test(line);

/** Хвост «End of Lecture 3», «№4 дәрістің аяқталуы», «Конец лекции». */
export const END_TRAILER_RE = /^\s*(?:End\s+of\s+(?:the\s+)?Lecture(?![\p{L}\p{N}])|Конец\s+лекции(?![\p{L}\p{N}])|(?:№\s*)?\d*\s*-?\s*дәрістің\s+(?:аяқталуы|соңы)(?![\p{L}\p{N}])|Дәріс\s+соңы\s*$)/iu;

/** Начало приложения «Материалы для закрепления» / «Key Concepts» (после него строки не склеиваются). */
export const APPENDIX_START_RE =
  /^\s*(?:Материалы\s+для\s+закрепления|Supplementary\s+Materials|Materials\s+for\s+Reinforcement|Бекіт\S*\s+арналған\s+материалдар|Ключевые\s+понятия|Key\s+Concepts|Негізгі\s+ұғымдар)(?![\p{L}\p{N}])/iu;

/** Строки прозы разделов (без заголовков, списков и приложения) — для метрики «предложение на строку». */
export function proseLines(text: string): string[] {
  const lines = text.split('\n');
  const first = lines.findIndex(isTimecodeLine);
  const out: string[] = [];
  for (const l of lines.slice(Math.max(0, first))) {
    if (APPENDIX_START_RE.test(l)) break;
    if (!l.trim() || isTimecodeLine(l) || /^\s*(?:[•●▪◦\-–]|\d+[.)])/.test(l)) continue;
    out.push(l);
  }
  return out;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Медиана длины строки прозы < 150 — расшифровка «одно предложение — одна строка». */
export const SENTENCE_PER_LINE_MEDIAN = 150;

export function isSentencePerLine(text: string): boolean {
  const p = proseLines(text);
  return p.length >= 20 && median(p.map((l) => l.length)) < SENTENCE_PER_LINE_MEDIAN;
}

/* ── Казахская лексика (A20) ─────────────────────────────────────── */

/** Однозначные опечатки/кальки в казахских текстах: [шаблон, замена, подпись]. */
export const KK_LEXICON: { re: RegExp; to: string; label: string }[] = [
  { re: /(?<![\p{L}])берту(?![\p{L}])/gu, to: 'беру', label: 'берту→беру' },
  { re: /(?<![\p{L}])үздіксіс(?![\p{L}])/gu, to: 'үздіксіз', label: 'үздіксіс→үздіксіз' },
  { re: /(?<![\p{L}])яйни(?![\p{L}])/gu, to: 'яғни', label: 'яйни→яғни' },
  { re: /(?<![\p{L}])аспекте(?![\p{L}])/gu, to: 'аспектіде', label: 'аспекте→аспектіде' },
  { re: /айырмашылық қайда\?/gu, to: 'айырмашылық неде?', label: '«айырмашылық қайда?»→«айырмашылық неде?»' },
  { re: /(?<![\p{L}])ретинде(?![\p{L}])/gu, to: 'ретінде', label: 'ретинде→ретінде' },
];

/** Попадания лексикона в тексте: подпись → число. */
export function kkLexiconHits(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { re, label } of KK_LEXICON) {
    const n = (text.match(re) ?? []).length;
    if (n) out[label] = n;
  }
  return out;
}

export function applyKkLexicon(text: string): { text: string; hits: Record<string, number> } {
  const hits = kkLexiconHits(text);
  let out = text;
  for (const { re, to } of KK_LEXICON) out = out.replace(re, to);
  return { text: out, hits };
}

/* ── Вопросы ─────────────────────────────────────────────────────── */

export interface QuestionRow {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  correctOptionIds: number[];
  explanation: string | null;
  optionRationales: string[] | null;
  sourceLectureId: string | null;
  sourceTimecode: string | null;
  canonicalKey: string | null;
  orderIndex: number;
  archivedAt: Date | null;
}

export function toQuestionRow(q: {
  id: string;
  type: string;
  prompt: string;
  options: unknown;
  correctOptionIds: unknown;
  explanation: string | null;
  optionRationales: unknown;
  sourceLectureId: string | null;
  sourceTimecode: string | null;
  canonicalKey: string | null;
  orderIndex: number;
  archivedAt: Date | null;
}): QuestionRow {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: Array.isArray(q.options) ? q.options.map(String) : [],
    correctOptionIds: Array.isArray(q.correctOptionIds) ? q.correctOptionIds.filter((x): x is number => Number.isInteger(x)) : [],
    explanation: q.explanation,
    optionRationales: Array.isArray(q.optionRationales) ? q.optionRationales.map(String) : null,
    sourceLectureId: q.sourceLectureId,
    sourceTimecode: q.sourceTimecode,
    canonicalKey: q.canonicalKey,
    orderIndex: q.orderIndex,
    archivedAt: q.archivedAt,
  };
}

/** Неархивные вопросы теста по orderIndex. */
export async function activeQuestions(db: Db, quizId: string): Promise<QuestionRow[]> {
  const rows = await db.quizQuestion.findMany({ where: { quizId, archivedAt: null }, orderBy: { orderIndex: 'asc' } });
  return rows.map(toQuestionRow);
}

/** Текстовые поля вопроса, которые правят текстовые скрипты (формулировка, варианты, пояснения). */
export interface QuestionTextEdit {
  prompt: string;
  options: string[];
  explanation: string | null;
  optionRationales: string[] | null;
  changedFields: string[];
}

/**
 * Применяет текстовую функцию ко всем текстовым полям вопроса. Порядок вариантов и
 * ключ НЕ меняются (правка допустима и для «замороженных» вопросов с попытками).
 */
export function editQuestionText(q: QuestionRow, fn: (s: string) => string): QuestionTextEdit {
  const prompt = fn(q.prompt);
  const options = q.options.map(fn);
  const explanation = q.explanation === null ? null : fn(q.explanation);
  const optionRationales = q.optionRationales ? q.optionRationales.map(fn) : null;
  const changedFields = [
    prompt !== q.prompt ? 'prompt' : '',
    options.some((o, i) => o !== q.options[i]) ? 'options' : '',
    explanation !== q.explanation ? 'explanation' : '',
    optionRationales && optionRationales.some((r, i) => r !== q.optionRationales![i]) ? 'optionRationales' : '',
  ].filter(Boolean);
  return { prompt, options, explanation, optionRationales, changedFields };
}

/** Неархивные вопросы всех тестов курса (оцениваемые, мини-квизы, итоговый) с языком и локатором. */
export async function courseQuestions(db: Db, course: CourseCtx): Promise<{ lang: Language; locator: QuizLocator; quizId: string; graded: boolean; q: QuestionRow }[]> {
  const out: { lang: Language; locator: QuizLocator; quizId: string; graded: boolean; q: QuestionRow }[] = [];
  for (const lang of LANGS) {
    const v = course.versions[lang];
    if (!v) continue;
    const quizzes: { locator: QuizLocator; id: string; graded: boolean }[] = [
      ...v.modules.filter((m) => m.quiz).map((m) => ({ locator: { kind: 'MODULE_FINAL', module: m.orderIndex } as QuizLocator, id: m.quiz!.id, graded: m.quiz!.isGraded })),
      ...v.lectures.filter((l) => l.miniQuiz).map((l) => ({ locator: { kind: 'LECTURE_MINI', lecture: l.number } as QuizLocator, id: l.miniQuiz!.id, graded: false })),
      ...(v.finalMiniQuiz ? [{ locator: { kind: 'COURSE_FINAL' } as QuizLocator, id: v.finalMiniQuiz.id, graded: false }] : []),
    ];
    for (const z of quizzes) {
      for (const q of await activeQuestions(db, z.id)) out.push({ lang, locator: z.locator, quizId: z.id, graded: z.graded, q });
    }
  }
  return out;
}

/* ── Ревизия рецензента после применения (meta.textFixes) ─────────── */

export interface ApplyTextFixesOptions {
  script: string;
  fixes: readonly TextFix[];
  course: CourseCtx;
  langs: readonly Language[];
  apply: boolean;
  force: boolean;
  report: Report;
  /** Причина отложить правку (или null) — напр., незавершённая серия попыток у студентов. */
  guard?: (fix: TextFix, q: QuestionRow, quizId: string) => Promise<string | null>;
}

/**
 * Переносит правки рецензента (`meta.textFixes`) на стенд, где артефакт УЖЕ применён: вопрос
 * ищется по canonicalKey (или позиции + снимку формулировки), правка — по точному якорю
 * «было → стало» (revisions.applyTextEdits). Порядок вариантов и ключ не меняются. Одна
 * транзакция и одна строка сводки на правку; журнал `content:v1:<скрипт>:fix:<id>`; отметка на
 * проверку — если задана в правке. На стенде, получившем уже исправленный артефакт, — «уже исправлено».
 */
export async function applyTextFixes(o: ApplyTextFixesOptions): Promise<void> {
  const invalid = validateTextFixes(o.fixes);
  for (const p of invalid) o.report.line('textFixes', 'error', p);
  if (invalid.length) return;
  for (const fix of o.fixes) {
    if (!o.langs.includes(fix.lang)) continue;
    const unit = `fix:${fix.id}`;
    const key = ledgerKey(o.script, unit);
    const v = version(o.course, fix.lang);
    const quizId = resolveQuiz(v, fix.quiz);
    if (!quizId) {
      o.report.line(unit, 'error', `тест ${locatorLabel(fix.lang, fix.quiz)} не найден`);
      continue;
    }
    if (await ledgerGet(prisma, key)) {
      o.report.line(unit, 'skip', 'уже применено (журнал)');
      continue;
    }
    const qs = await activeQuestions(prisma, quizId);
    const q = fix.canonicalKey ? qs.find((x) => x.canonicalKey === fix.canonicalKey) : qs.find((x) => x.orderIndex === fix.orderIndex);
    const where = `${locatorLabel(fix.lang, fix.quiz)} ${fix.canonicalKey ?? `#${(fix.orderIndex ?? 0) + 1}`}`;
    if (!q) {
      o.report.line(unit, fix.canonicalKey ? 'error' : 'skip', `${where}: вопроса нет${fix.canonicalKey ? ' (банк не применён?)' : ' (иной стенд)'}`);
      continue;
    }
    const outcome = applyTextEdits(q, fix.edits);
    if (outcome.status === 'already') {
      o.report.line(unit, 'skip', `${where}: уже исправлено`);
      continue;
    }
    if (fix.prompt !== undefined && q.prompt !== fix.prompt) {
      o.report.line(unit, 'skip', `${where}: формулировка отличается от снимка (иной стенд или правка вручную)`);
      continue;
    }
    if (outcome.status === 'mismatch') {
      o.report.line(unit, 'error', `${where}: ${outcome.problems.join('; ')} — ничего не записано`);
      continue;
    }
    const refusal = o.guard ? await o.guard(fix, q, quizId) : null;
    if (refusal && !o.force) {
      o.report.line(unit, 'error', `${where}: отложено — ${refusal} (--force — применить всё равно)`);
      continue;
    }
    const summary = `${where}: ${outcome.changedFields.join(', ')} · ${fix.note}${fix.review ? ` · отметка ${fix.review.reason}` : ''}${refusal ? ` · ПРИНУДИТЕЛЬНО: ${refusal}` : ''}`;
    if (!o.apply) {
      o.report.line(unit, 'would-change', summary);
      continue;
    }
    const done = await prisma.$transaction(async (tx) => {
      const row = await tx.quizQuestion.findUniqueOrThrow({ where: { id: q.id } });
      const fresh = applyTextEdits(toQuestionRow(row), fix.edits);
      if (fresh.status !== 'apply' || (await ledgerGet(tx, key))) return false;
      await tx.quizQuestion.update({
        where: { id: q.id },
        data: {
          prompt: fresh.next.prompt,
          options: fresh.next.options,
          explanation: fresh.next.explanation,
          ...(fresh.next.optionRationales ? { optionRationales: fresh.next.optionRationales } : {}),
        },
      });
      await ledgerPut(tx, key, {
        questionId: q.id,
        quizId,
        canonicalKey: q.canonicalKey,
        fields: fresh.changedFields,
        note: fix.note,
        before: { prompt: row.prompt, options: row.options, explanation: row.explanation, optionRationales: row.optionRationales },
        ...(refusal ? { forced: refusal } : {}),
      });
      if (fix.review) {
        await flagForReview(tx, {
          reason: fix.review.reason,
          targetType: 'QUIZ_QUESTION',
          targetId: q.id,
          courseId: o.course.courseId,
          languageVersionId: v.id,
          comment: fix.review.comment,
          dedupeKey: `review:v1:${fix.review.reason}:${q.id}:${fix.id}`,
        });
      }
      return true;
    });
    o.report.line(unit, done ? 'changed' : 'skip', done ? summary : `${where}: вопрос изменился во время работы — повторите`);
  }
}

/** Черновик вопроса в артефакте: как DraftQuestion, но источник — по позиции лекции. */
export interface PortableQuestion {
  type: 'SINGLE_CHOICE' | 'TRUE_FALSE';
  prompt: string;
  options: string[];
  correctOptionIds: number[];
  explanation: string | null;
  optionRationales: string[] | null;
  source: LectureRef | null;
  sourceTimecode: string | null;
  difficulty: 'VERY_EASY' | 'EASY' | 'MEDIUM' | 'HARD';
  canonicalKey?: string;
}

/* ── Пересчёт баллов прошлых попыток (инвариант студенческих данных) ── */

export interface RescoreRow {
  attemptId: string;
  quizId: string;
  quizTitle: string;
  email: string;
  stored: number;
  rescored: number;
  storedPassed: boolean;
  rescoredPassed: boolean;
  presented: number;
  hasPresentation: boolean;
  ok: boolean;
}

/**
 * Пересчитывает балл каждой ОТПРАВЛЕННОЙ попытки по её presentation (или, у устаревших
 * без presentation, по действующим вопросам — так же, как это делает BE2) и сравнивает
 * с сохранённым. Используется фазой A, после замены банка и аудитом.
 */
export async function rescoreAttempts(db: Db, where: Prisma.QuizAttemptWhereInput = {}): Promise<RescoreRow[]> {
  const attempts = await db.quizAttempt.findMany({
    where: { submittedAt: { not: null }, ...where },
    orderBy: { startedAt: 'asc' },
    include: {
      quiz: { include: { questions: true } },
      enrollment: { select: { user: { select: { email: true } } } },
    },
  });
  return attempts.map((a) => {
    const questions = a.quiz.questions.map((q) => toPolicyQuestion(q));
    const presented = presentedQuestions(a, questions);
    const scored = scoreQuiz(
      presented.map((q) => ({ id: q.id, correctOptionIds: q.correctOptionIds })),
      parseStoredAnswers(a.answers),
      a.quiz.passThreshold,
    );
    return {
      attemptId: a.id,
      quizId: a.quizId,
      quizTitle: a.quiz.title,
      email: a.enrollment.user.email,
      stored: a.score,
      rescored: scored.score,
      storedPassed: a.passed,
      rescoredPassed: scored.passed,
      presented: presented.length,
      hasPresentation: a.presentation !== null,
      ok: Math.abs(scored.score - a.score) < 1e-9,
    };
  });
}

export function printRescore(rows: RescoreRow[]): void {
  for (const r of rows) {
    console.log(
      `   ${r.ok ? '=' : '≠'} ${r.attemptId} ${r.email} «${r.quizTitle.slice(0, 50)}» stored ${round(r.stored, 4)} → rescored ${round(r.rescored, 4)} (вопросов ${r.presented}${r.hasPresentation ? '' : ', без presentation'}${r.storedPassed !== r.rescoredPassed ? `, passed ${r.storedPassed}→${r.rescoredPassed}` : ''})`,
    );
  }
}

/** DraftQuestion (BE4) → переносимый вид артефакта: лекция-источник по позиции. */
export function toPortable(v: VersionCtx, d: DraftQuestion): PortableQuestion {
  return {
    type: d.type,
    prompt: d.prompt,
    options: d.options,
    correctOptionIds: d.correctOptionIds,
    explanation: d.explanation,
    optionRationales: d.optionRationales,
    source: lectureRefOf(v, d.sourceLectureId),
    sourceTimecode: d.sourceTimecode,
    difficulty: d.difficulty,
    ...(d.canonicalKey ? { canonicalKey: d.canonicalKey } : {}),
  };
}

/** Переносимый вопрос → DraftQuestion для записи в языковую версию v (источник — по позиции). */
export function fromPortable(v: VersionCtx, p: PortableQuestion): DraftQuestion {
  return {
    type: p.type,
    prompt: p.prompt,
    options: p.options,
    correctOptionIds: p.correctOptionIds,
    explanation: p.explanation,
    optionRationales: p.optionRationales,
    sourceLectureId: lectureIdOf(v, p.source),
    sourceTimecode: p.source ? p.sourceTimecode : null,
    difficulty: p.difficulty,
    ...(p.canonicalKey ? { canonicalKey: p.canonicalKey } : {}),
  };
}

/** Вопросы, созданные контент-скриптом (уже перемешаны при генерации), помечаются в журнале shuffle. */
export async function markShuffled(db: Db, questionIds: string[], script: string): Promise<void> {
  for (const id of questionIds) {
    const key = ledgerKey('shuffle', id);
    if (!(await ledgerGet(db, key))) await ledgerPut(db, key, { shuffledAtGeneration: true, script });
  }
}

/* ── Учёт расхода LLM по скриптам (отчёт CONTENT: генерация < $3) ─── */

export interface SpendRow {
  script: string;
  at: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Дописывает расход LLM черновика в meta артефакта и в общий файл llm-spend.json рядом с артефактами. */
export function recordSpend(dataDir: string, row: SpendRow): void {
  const path = join(dataDir, 'llm-spend.json');
  const rows: SpendRow[] = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SpendRow[]) : [];
  rows.push(row);
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`);
  const total = rows.reduce((a, r) => a + r.costUsd, 0);
  console.log(`LLM: ${row.calls} вызовов · ${row.inputTokens}/${row.outputTokens} токенов · $${row.costUsd.toFixed(4)} (всего по контенту $${total.toFixed(4)})`);
}

/* ── Итоговый практикум (1f, 2c) ─────────────────────────────────── */

/** Канонический сценарий итогового практикума (USER_DECISIONS §4). */
export const CANONICAL_REF = 'polisia-v1';

/** Настройки практикума по языкам: бюджет вмещает 24 реплики (калибровка BE3), план беседы виден студенту. */
export const PRACTICAL_CONFIG: Record<Language, { tokenBudget: number; maxAiMessages: number; maxSessions: number; estimatedMinutes: number; agenda: string[] }> = {
  ru: { tokenBudget: 160000, maxAiMessages: 24, maxSessions: 2, estimatedMinutes: 25, agenda: ['Позиция', 'Аргументы из курса', 'Итоговый вывод'] },
  kk: { tokenBudget: 190000, maxAiMessages: 24, maxSessions: 2, estimatedMinutes: 25, agenda: ['Ұстаным', 'Курстан дәлелдер', 'Қорытынды тұжырым'] },
  en: { tokenBudget: 120000, maxAiMessages: 24, maxSessions: 2, estimatedMinutes: 25, agenda: ['Position', 'Arguments from the course', 'Final conclusion'] },
};

/* ── Мелочи ──────────────────────────────────────────────────────── */

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
