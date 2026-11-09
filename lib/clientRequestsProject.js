export const CLIENT_REQUESTS_ID = 'client-requests';

export const CLIENT_REQUESTS_PROJECT = {
  id: CLIENT_REQUESTS_ID,
  key: 'CR',
  name: 'Client requests',
  description: 'Requests raised by client accounts.',
  color: '#8777D9',
};

export const CLIENT_REQUESTS_TABS = [
  'summary',
  'board',
  'list',
  'calendar',
  'timeline',
  'reports',
  'docs',
  'attachments',
  'archived',
];

export function clientRequestsHref(tab = 'summary') {
  if (tab === 'summary') return '/client-requests';
  return `/client-requests/${tab}`;
}
