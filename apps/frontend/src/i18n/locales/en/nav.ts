import type { nav as ruNav } from '../ru/nav';
import type { Loc } from '../../types';

export const nav: Loc<typeof ruNav> = {
  myCourses: 'My courses', courses: 'Courses', users: 'Users', cohorts: 'Cohorts',
  dashboards: 'Analytics', overview: 'Overview', export: 'Export', audit: 'Audit', profile: 'Profile',
};
