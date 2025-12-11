import { bootstrapApplication } from '@angular/platform-browser';
import { provideAuth0 } from '@auth0/auth0-angular';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';   
import { routes } from './app/app.routes';        
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { timingInterceptor } from './app/interceptors/timing.interceptor';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

bootstrapApplication(App, {
  providers: [
    provideAuth0({
      domain: "dev-uys77d42j1vm0qdd.us.auth0.com",
      clientId: "4ujmTHl6Ea5cfAqEgNpBHrwdAurhknVq",
      authorizationParams: {
        redirect_uri: window.location.origin
      },
      useRefreshTokens: true,
      cacheLocation: 'localstorage'
    }),
    provideHttpClient(withInterceptors([timingInterceptor])),
    provideRouter(routes),   
    appConfig.providers,
    provideCharts(withDefaultRegisterables()),
  ]
}).catch((err) => console.error(err));