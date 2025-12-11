import { Routes } from '@angular/router';
import { adminGuard } from './guards/admin.guard';

export const routes: Routes = [
  {
    path: 'home',
    loadComponent: () => import('./components/home/home').then(m => m.Home)
  },
  {
    path: 'games',
    loadComponent: () => import('./components/games/games').then(m => m.Games)
  },
  {
    path: 'games/:appid',
    loadComponent: () => import('./components/game/game').then(m => m.Game)
  },
  {
    path: 'admin',
    loadComponent: () => import('./components/admin/admin').then(m => m.Admin),
    canActivate: [adminGuard]
  },
  {
    path: 'admin/games',
    loadComponent: () => import('./components/admin/game-management/game-management').then(m => m.GameManagement),
    canActivate: [adminGuard]
  },
  {
    path: 'admin/developers',
    loadComponent: () => import('./components/admin/developer-management/developer-management').then(m => m.DeveloperManagement),
    canActivate: [adminGuard]
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full'
  }
];