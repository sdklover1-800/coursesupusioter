/**
 * Промпт-шаблоны (§5.2–5.4) — точка входа (barrel). Сами шаблоны:
 *  - ./prompts/generation.ts — генерация теста и практического задания;
 *  - ./prompts/dialog.ts — сократический тьютор, судья, однокальный режим.
 * PROMPT_VERSION — версия промптов диалога (сохраняется в сессии, FR-R.7).
 */
export * from './prompts/generation.js';
export * from './prompts/dialog.js';
export { DIALOG_PROMPT_VERSION as PROMPT_VERSION } from './prompts/dialog.js';
