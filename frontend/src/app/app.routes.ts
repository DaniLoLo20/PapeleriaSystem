import { Routes } from '@angular/router';
import { panelPinGuard } from './core/guards/panel-pin.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/cliente/cliente.component').then((m) => m.ClienteComponent),
  },
  {
    path: 'panel',
    canActivate: [panelPinGuard],
    loadComponent: () => import('./pages/panel/panel.component').then((m) => m.PanelComponent),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
