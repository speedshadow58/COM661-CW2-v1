
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

bootstrapApplication(App, {
  providers: [
    provideRouter(routes)
  ]
});
