import type { roles as ruRoles } from '../ru/roles';
import type { Loc } from '../../types';

export const roles: Loc<typeof ruRoles> = { STUDENT: 'Student', COURSE_MANAGER: 'Course manager', ADMIN: 'Administrator' };
