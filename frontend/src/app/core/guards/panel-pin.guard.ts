import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

const PIN_KEY = 'papeleria_admin_pin';

export const panelPinGuard: CanActivateFn = () => {
  const router = inject(Router);
  const actual = localStorage.getItem(PIN_KEY);

  if (actual) {
    return true;
  }

  const pin = window.prompt('Ingresa el PIN del panel');
  if (!pin?.trim()) {
    router.navigateByUrl('/');
    return false;
  }

  localStorage.setItem(PIN_KEY, pin.trim());
  return true;
};

export function getAdminPin(): string {
  return localStorage.getItem(PIN_KEY) || '';
}
