import { common } from './common';
import { nav } from './nav';
import { roles } from './roles';
import { errors } from './errors';
import { status } from './status';
import { languages } from './languages';
import { difficulty } from './difficulty';
import { conditions } from './conditions';
import { ui } from './ui';
import { shell } from './shell';
import { auth } from './auth';
import { consent } from './consent';
import { student } from './student';
import { catalog } from './catalog';
import { register } from './register';
import { course } from './course';
import { certificate } from './certificate';
import { profile } from './profile';
import { verify } from './verify';
import { lecture } from './lecture';
import { quiz } from './quiz';
import { practical } from './practical';
import { manager } from './manager';
import { admin } from './admin';
import { dashboard } from './dashboard';
import { requests } from './requests';
import { issues } from './issues';
import type { Loc } from '../../types';
import type { Resources } from '../ru';

/** Қазақ тіліндегі локаль (§6.2): әр кеңістік — жеке файл, кілттер Loc<ru> бойынша тексеріледі. */
export const kk: Loc<Resources> = {
  // FE0: common, nav, roles, errors, status, languages, difficulty, conditions, ui, shell
  common, nav, roles, errors, status, languages, difficulty, conditions, ui, shell,
  // FE1: auth, consent, student, catalog, register, course, certificate, profile, verify
  auth, consent, student, catalog, register, course, certificate, profile, verify,
  // FE2: lecture
  lecture,
  // FE3: quiz
  quiz,
  // FE4: practical
  practical,
  // FE5: manager, admin, dashboard, requests, issues
  manager, admin, dashboard, requests, issues,
};
