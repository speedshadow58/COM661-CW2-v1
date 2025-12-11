import { HttpInterceptorFn } from '@angular/common/http';
import { tap } from 'rxjs';

export const timingInterceptor: HttpInterceptorFn = (req, next) => {
  const startTime = performance.now();
  
  return next(req).pipe(
    tap({
      next: (event: any) => {
        if (event.type === 4) { // HttpEventType.Response
          const duration = performance.now() - startTime;
          const serverTiming = event.headers?.get('Server-Timing');
          
          console.log(`[API Timing] ${req.method} ${req.url}`);
          console.log(`  Client: ${duration.toFixed(2)}ms`);
          if (serverTiming) {
            console.log(`  Server-Timing: ${serverTiming}`);
          }
        }
      },
      error: (err: any) => {
        const duration = performance.now() - startTime;
        console.log(`[API Timing Error] ${req.method} ${req.url}`);
        console.log(`  Duration: ${duration.toFixed(2)}ms`);
        console.log(`  Error: ${err.status} ${err.statusText}`);
      }
    })
  );
};
