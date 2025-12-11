import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { WebService } from '../services/web-service';

@Injectable()
export class HttpErrorInterceptor implements HttpInterceptor {
  constructor(private webService: WebService) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(
      catchError((error: HttpErrorResponse) => {
        // Handle 401 Unauthorized - token expired or invalid
        if (error.status === 401) {
          console.warn('[HttpInterceptor] Received 401 Unauthorized, clearing token');
          this.webService.clearToken();
        } else if (error.status === 400) {
          console.error('[HttpInterceptor] Bad Request (400):', error.error?.message || error.message);
        } else if (error.status === 404) {
          console.error('[HttpInterceptor] Not Found (404):', error.error?.message || error.message);
        } else if (error.status === 500) {
          console.error('[HttpInterceptor] Server Error (500):', error.error?.message || error.message);
        } else if (error.status === 0) {
          console.error('[HttpInterceptor] Network Error or CORS issue:', error.message);
        } else {
          console.error('[HttpInterceptor] HTTP Error:', error.status, error.error?.message || error.message);
        }
        
        return throwError(() => error);
      })
    );
  }
}
