import type { common as ruCommon } from '../ru/common';
import type { Loc } from '../../types';

export const common: Loc<typeof ruCommon> = {
  appName: 'EduOpen',
  save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', add: 'Add',
  back: 'Back', next: 'Next', prev: 'Back', submit: 'Submit', loading: 'Loading…',
  error: 'Error', success: 'Done', confirm: 'Confirm', yes: 'Yes', no: 'No',
  search: 'Search', actions: 'Actions', status: 'Status', language: 'Language', logout: 'Log out',
  close: 'Close', retry: 'Retry', preview: 'Preview', publish: 'Publish',
  unpublish: 'Unpublish', generate: 'Generate', download: 'Download', open: 'Open',
  create: 'Create', empty: 'Empty', all: 'All', of: 'of', theme: 'Theme',
};
