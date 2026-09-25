import type { manager as ruManager } from '../ru/manager';
import type { Loc } from '../../types';

export const manager: Loc<typeof ruManager> = {
  courses: 'Courses', createCourse: 'Create course', courseTitle: 'Course title',
  defaultLanguage: 'Base language', structure: 'Structure', useDefault: 'Default structure (3 modules × 5 lectures)',
  modules: 'Modules', module: 'Module', lectures: 'Lectures', lecture: 'Lecture',
  languageVersions: 'Language versions', addLanguage: 'Add language', versionStatus: 'Version status',
  editor: 'Editor', youtubeUrl: 'YouTube link', transcript: 'Text transcript',
  assessmentType: 'Assessment type', quiz: 'Quiz', practical: 'Practical',
  generateMaterials: 'Generate materials', generation: 'Generation',
  generationQueued: 'Queued', generationRunning: 'Running', generationDone: 'Done', generationError: 'Error',
  regenStrategy: 'Regeneration strategy', strategyKeep: 'Keep edits', strategyOverwrite: 'Overwrite', strategyAppend: 'Append',
  quizEditor: 'Quiz editor', addQuestion: 'Add question', questionText: 'Question text',
  options: 'Options', correctAnswer: 'Correct answer', difficulty: 'Difficulty',
  aiGenerated: 'AI', edited: 'Edited', regenerateQuestion: 'Regenerate',
  practicalEditor: 'Practical task editor', scenario: 'Scenario (visible to student)',
  referenceSolution: 'Reference solution', rubric: 'Rubric', keyPoints: 'Key points',
  answerCriteria: 'Answer-reached criteria', hiddenFromStudent: 'Hidden from student',
  tokenBudget: 'Token budget', maxMessages: 'Assistant reply limit', regenerate: 'Regenerate',
  publishReady: 'Ready to publish', publishProblems: 'Issues to publish',
  enrollStudents: 'Enroll students', enrolled: 'Enrolled', preview: 'Preview as a student',
};
