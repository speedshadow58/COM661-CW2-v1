import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { WebService } from '../services/web-service';

export const adminGuard: CanActivateFn = (route, state) => {
  const webService = inject(WebService);
  const router = inject(Router);

  // Always refresh token state from localStorage before checking role
  webService["initTokenState"]?.();

  // Debug: log currentRole and token
  console.log('[AdminGuard] Checking admin access:', {
    currentRole: webService.getRole(),
    token: webService.getToken(),
    isAdmin: webService.isAdmin()
  });

  if (webService.isAdmin()) {
    return true;
  }

  console.warn('[AdminGuard] Access denied - admin role required');
  alert('Access denied. Admin privileges required.');
  router.navigate(['/']);
  return false;
};
