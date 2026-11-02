import { createRouter } from '@tanstack/react-router';
import { ErrorScreen, NotFound } from '@/components/status-screens';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: ErrorScreen,
  });
}
