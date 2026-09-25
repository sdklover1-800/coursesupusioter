import type { practical as ruPractical } from '../ru/practical';
import type { Loc } from '../../types';

export const practical: Loc<typeof ruPractical> = {
  title: 'Practical task', socratic: 'Socratic assistant',
  socraticNote: 'The assistant never hands over the answer — it guides you with questions. Reason out loud.',
  start: 'Start task', send: 'Send', placeholder: 'Write your reasoning…',
  remainingReplies: 'Replies left', repliesLabel: 'assistant replies',
  thinking: 'The assistant is thinking…', waiting: 'The assistant is taking longer than usual…', charLimit: 'At most {{n}} characters',
  verdict: 'Verdict', verdictPassed: 'Task passed', verdictFailed: 'Task not passed',
  verdictAbandoned: 'Session closed', reasoning: 'Reasoning assessment',
  methodicalness: 'Methodicalness', questionQuality: 'Question quality',
  logicalProgression: 'Logical progression', selfCorrection: 'Self-correction',
  sessionEnded: 'Session ended', resume: 'Resume session',
  techError: 'The assistant is temporarily unavailable. This was not counted as a failure — please try again.',
  reachedAnswer: 'You reached the correct answer',
  scaleNote: '0–3 scale for each critical-thinking dimension',
};
