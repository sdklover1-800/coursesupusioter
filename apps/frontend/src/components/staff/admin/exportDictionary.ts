import type { ExportType } from '../../../lib/staffAdmin';

/**
 * Словарь данных выгрузок (FR-R.4): столбцы в ПОРЯДКЕ CSV (apps/backend research/export.service).
 * [имя столбца, ключ описания admin.exportPage.cols.*] — ключ отличается, когда смысл
 * столбца зависит от файла (cohort_id в событиях — на момент события, status — сессии и т. п.).
 * newFrom — индекс первого столбца, дописанного в 2.0 в конец строки (прежние скрипты
 * анализа читают столбцы по позиции); newFile — файл целиком новый.
 */
export interface ExportSpec {
  columns: [column: string, descKey: string][];
  newFrom?: number;
  newFile?: boolean;
}

const c = (name: string, key = name): [string, string] => [name, key];

export const EXPORT_DICTIONARY: Record<ExportType, ExportSpec> = {
  events: {
    columns: [
      c('event_id'), c('event_type'), c('pseudo_user_id'), c('enrollment_id'), c('session_id', 'session_of_event'),
      c('cohort_id', 'cohort_at_event'), c('timestamp', 'event_time'), c('payload'),
    ],
  },
  sessions: {
    columns: [
      c('session_id'), c('pseudo_user_id'), c('cohort_id'), c('status', 'session_status'), c('ai_messages'), c('max_ai_messages'),
      c('tokens_used'), c('orchestration_mode'), c('model'), c('prompt_template'), c('verdict_reason'), c('started_at'), c('ended_at'),
      c('integrity_flags'),
      // 2.0: итог, зачётность, метрики воспроизводимости, снимок задания
      c('enrollment_id'), c('course_id'), c('practical_task_id'), c('verdict_code'), c('end_reason'), c('counted', 'session_counted'),
      c('excused'), c('student_messages'), c('confirm_calls'), c('leak_prevented'), c('leak_check_timeouts'), c('near_ceiling'),
      c('aux_input_tokens'), c('aux_cached_input_tokens'), c('aux_output_tokens'), c('aux_reasoning_tokens'),
      c('prompt_version'), c('canonical_ref'), c('scenario_sha256'), c('reference_sha256'),
    ],
    newFrom: 14,
  },
  rubric: {
    columns: [
      c('session_id'), c('pseudo_user_id'), c('cohort_id'), c('methodicalness'), c('question_quality'), c('logical_progression'),
      c('self_correction'), c('timestamp', 'message_time'), c('notes'),
      c('message_id'), c('reply_message_id'), c('reply_tokens_in'), c('reply_tokens_out'), c('reply_cached_input_tokens'),
      c('reply_reasoning_tokens'), c('reply_leak_check_leaks'),
    ],
    newFrom: 9,
  },
  quiz_attempts: {
    columns: [
      c('attempt_id'), c('pseudo_user_id'), c('cohort_id'), c('quiz_id'), c('score'), c('passed'), c('submitted_at'),
      c('enrollment_id'), c('course_id'), c('language'), c('attempt_number'), c('counted', 'attempt_counted'),
      c('started_at', 'attempt_started_at'), c('duration_sec'), c('active_duration_sec'), c('unanswered_count'), c('integrity_ack'),
      c('auto_submitted'), c('legacy'), c('presentation_seed'),
    ],
    newFrom: 7,
  },
  item_responses: {
    columns: [
      c('attempt_id'), c('pseudo_user_id'), c('cohort_id'), c('quiz_id'), c('question_id'), c('canonical_key'), c('position'),
      c('selected'), c('is_correct'), c('language'), c('attempt_number'),
    ],
    newFile: true,
  },
  lecture_progress: {
    columns: [
      c('pseudo_user_id'), c('cohort_id'), c('enrollment_id'), c('course_id'), c('language'), c('lecture_id'), c('lecture_number'),
      c('module_order_index'), c('position_sec'), c('watched_sec'), c('is_completed'), c('completed_at'), c('last_viewed_at'),
    ],
    newFile: true,
  },
  cohort_summary: {
    columns: [
      c('cohort_id', 'cohort_row_id'), c('name', 'cohort_name'), c('condition', 'cohort_condition'), c('students', 'cohort_students'),
      c('enrollments', 'cohort_enrollments'), c('completed', 'cohort_completed'), c('practical_passed'), c('practical_failed'),
      c('teacher_sessions'), c('n_students'), c('content_issues'), c('content_issues_per_enrollment'),
    ],
    newFrom: 9,
  },
};
