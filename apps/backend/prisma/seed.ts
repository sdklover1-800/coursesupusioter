import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

/**
 * Демо-данные: администратор, менеджер, студенты, когорты и один готовый курс
 * (структура 3×5, тесты + практическое задание) на русском — чтобы платформу
 * можно было запустить и пройти сразу. Пароли — стартовые (сменить при входе).
 */
const prisma = new PrismaClient();
const hash = (p: string) => argon2.hash(p, { type: argon2.argon2id });

async function main() {
  console.log('🌱 Сидирование…');

  // Когорты (условия эксперимента, FR-R.1)
  const aiCohort = await prisma.cohort.upsert({ where: { name: 'AI без преподавателя' }, update: {}, create: { name: 'AI без преподавателя', condition: 'AI_ASSISTED', description: 'Экспериментальная: обучение с ИИ-ассистентом' } });
  const teacherCohort = await prisma.cohort.upsert({ where: { name: 'С преподавателем' }, update: {}, create: { name: 'С преподавателем', condition: 'WITH_TEACHER', description: 'Контрольная: с живым преподавателем' } });

  // Пользователи
  const admin = await prisma.user.upsert({ where: { email: 'admin@edu.kz' }, update: {}, create: { email: 'admin@edu.kz', name: 'Администратор', role: 'ADMIN', interfaceLanguage: 'ru', passwordHash: await hash('Admin123!') } });
  await prisma.user.upsert({ where: { email: 'manager@edu.kz' }, update: {}, create: { email: 'manager@edu.kz', name: 'Менеджер Курсов', role: 'COURSE_MANAGER', interfaceLanguage: 'ru', passwordHash: await hash('Manager123!') } });
  const student = await prisma.user.upsert({ where: { email: 'student@edu.kz' }, update: {}, create: { email: 'student@edu.kz', name: 'Айгерим Студент', role: 'STUDENT', interfaceLanguage: 'ru', cohortId: aiCohort.id, passwordHash: await hash('Student123!') } });
  await prisma.user.upsert({ where: { email: 'student2@edu.kz' }, update: {}, create: { email: 'student2@edu.kz', name: 'Данияр Студент', role: 'STUDENT', interfaceLanguage: 'kk', cohortId: teacherCohort.id, passwordHash: await hash('Student123!') } });

  // Демо-курс: «Основы критического мышления» (RU), 3×5.
  // Идемпотентность: повторный сид не должен плодить дубли курса.
  const existingDemo = await prisma.courseLanguageVersion.findFirst({
    where: { title: 'Основы критического мышления' },
  });
  if (existingDemo) {
    console.log('ℹ️  Демо-курс уже существует — пропуск создания.');
    console.log('✅ Готово. Входы: admin@edu.kz / Admin123!, manager@edu.kz / Manager123!, student@edu.kz / Student123!');
    return;
  }

  const course = await prisma.course.create({
    data: {
      defaultLanguage: 'ru',
      status: 'PUBLISHED',
      createdById: admin.id,
      languageVersions: {
        create: {
          language: 'ru',
          title: 'Основы критического мышления',
          description: 'Демо-курс: аргументация, логические ошибки, оценка источников.',
          status: 'PUBLISHED',
          publishedAt: new Date(),
          modules: {
            create: [0, 1, 2].map((mi) => ({
              orderIndex: mi,
              title: mi === 0 ? 'Модуль 1. Аргументация' : mi === 1 ? 'Модуль 2. Логические ошибки' : 'Модуль 3. Итоговая практика',
              assessmentType: mi === 2 ? 'PRACTICAL' : 'QUIZ',
              coversWholeCourse: mi === 2,
              lectures: {
                create: [0, 1, 2, 3, 4].map((li) => ({
                  orderIndex: li,
                  title: `Лекция ${mi + 1}.${li + 1}`,
                  youtubeVideoId: 'dQw4w9WgXcQ',
                  transcriptText: `Расшифровка лекции ${mi + 1}.${li + 1}. Здесь излагается материал по теме критического мышления: понятия, примеры и разбор. Текст используется как источник для ИИ-генерации тестов и практических заданий.`,
                })),
              },
            })),
          },
        },
      },
    },
    include: { languageVersions: { include: { modules: true } } },
  });

  const version = course.languageVersions[0]!;
  const [m1, m2, m3] = version.modules.sort((a, b) => a.orderIndex - b.orderIndex);

  // Тесты для модулей 1 и 2 (обычно генерируются ИИ; здесь заранее для демо)
  for (const mod of [m1!, m2!]) {
    const quiz = await prisma.quiz.create({ data: { moduleId: mod.id, title: `Тест: ${mod.title}`, passThreshold: 0.6, maxAttempts: 3 } });
    await prisma.quizQuestion.createMany({
      data: [
        { quizId: quiz.id, type: 'SINGLE_CHOICE', prompt: 'Что такое аргумент?', options: ['Набор фактов', 'Утверждение с обоснованием', 'Мнение без доказательств', 'Вопрос'], correctOptionIds: [1], explanation: 'Аргумент — это утверждение, подкреплённое обоснованием (посылками).', difficulty: 'EASY', orderIndex: 0, isAIGenerated: true },
        { quizId: quiz.id, type: 'TRUE_FALSE', prompt: 'Апелляция к личности (ad hominem) — это логическая ошибка.', options: ['Верно', 'Неверно'], correctOptionIds: [0], explanation: 'Да, это подмена аргумента нападками на оппонента.', difficulty: 'MEDIUM', orderIndex: 1, isAIGenerated: true },
        { quizId: quiz.id, type: 'SINGLE_CHOICE', prompt: 'Какой признак отличает надёжный источник?', options: ['Яркий заголовок', 'Проверяемые ссылки и авторство', 'Большое число репостов', 'Эмоциональность'], correctOptionIds: [1], explanation: 'Надёжность определяется проверяемостью и авторитетностью источника.', difficulty: 'MEDIUM', orderIndex: 2, isAIGenerated: true },
      ],
    });
  }

  // Практическое задание для модуля 3 (охватывает весь курс)
  await prisma.practicalTask.create({
    data: {
      moduleId: m3!.id,
      title: 'Итоговое практическое задание',
      scenarioPrompt: 'Перед вами спорное утверждение из СМИ: «Новое исследование доказало, что X всегда приводит к Y». Разберите это утверждение критически и придите к обоснованному выводу о его надёжности.',
      referenceSolution: 'Надёжный вывод: утверждение некорректно из-за подмены корреляции причинностью, отсутствия выборки/контроля и слова «всегда». Верный ответ — утверждение не доказано и требует проверки методологии.',
      rubricSpec: { key_points: ['Различение корреляции и причинности', 'Проверка методологии и выборки', 'Критика абсолютизации («всегда»)'], answer_reached_criteria: 'Студент явно указывает на подмену причинности и необходимость проверки методологии, делая вывод о ненадёжности утверждения.' },
      difficulty: 'MEDIUM',
      tokenBudget: 18000,
      maxAiMessages: 22,
      isAIGenerated: true,
    },
  });

  // Запись демо-студента на курс
  await prisma.enrollment.upsert({
    where: { userId_courseId: { userId: student.id, courseId: course.id } },
    update: {},
    create: { userId: student.id, courseId: course.id, languageVersionId: version.id },
  });

  console.log('✅ Готово. Входы: admin@edu.kz / Admin123!, manager@edu.kz / Manager123!, student@edu.kz / Student123!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
