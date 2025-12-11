import { Component, Inject } from '@angular/core';
import { AuthService } from '@auth0/auth0-angular';
import { DOCUMENT } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { WebService } from '../../services/web-service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-authbutton',
  imports: [AsyncPipe, CommonModule, ReactiveFormsModule],
  providers : [Router],
  templateUrl: './authbutton.html',
  styleUrl: './authbutton.css',
})
export class Authbutton {

  loginForm: FormGroup;
  registerForm: FormGroup;
  backendAuthError: string | null = null;
  backendRegisterError: string | null = null;
  showRegister = false;
  loginSuccessMsg: string | null = null;
  registerSuccessMsg: string | null = null;
  isLoggingIn = false;
  isRegistering = false;
  token$!: Observable<boolean>;

  constructor(
    @Inject(DOCUMENT) public document: Document,
    public auth: AuthService,
    public router: Router,
    private fb: FormBuilder,
    private webService: WebService
  ) {
    this.token$ = this.webService.token$;
    this.loginForm = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required]
    });

    this.registerForm = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
      role: ['user', Validators.required]
    });
  }

  submitBackendLogin() {
    if (!this.loginForm.valid) return;
    const { username, password } = this.loginForm.value;
    this.backendAuthError = null;
    this.loginSuccessMsg = null;
    this.isLoggingIn = true;
    this.webService.login(username, password).subscribe({
      next: () => {
        this.backendAuthError = null;
        this.loginSuccessMsg = 'Logged in';
        this.isLoggingIn = false;
      },
      error: (err) => {
        console.error('[Auth] Backend login failed', err);
        this.webService.clearToken(); // Always clear token on error
        this.backendAuthError = err?.error?.error || 'Login failed';
        this.isLoggingIn = false;
        this.loginForm.reset(); // Reset form so user can try again
      }
    });
  }

  logoutBackend() {
    this.webService.clearToken();
    this.loginSuccessMsg = null;
    this.registerSuccessMsg = null;
  }

  submitRegister() {
    if (!this.registerForm.valid) return;
    const { username, password, role } = this.registerForm.value;
    this.backendRegisterError = null;
    this.registerSuccessMsg = null;
    this.isRegistering = true;
    this.webService.register(username, password, role).subscribe({
      next: (res) => {
        this.backendRegisterError = null;
        this.registerSuccessMsg = res?.message || 'User registered successfully';
        this.isRegistering = false;
        this.registerForm.reset({ username: '', password: '', role: 'user' });
        this.showRegister = false;
      },
      error: (err) => {
        console.error('[Auth] Register failed', err);
        this.backendRegisterError = err?.error?.error || 'Register failed';
        this.isRegistering = false;
      }
    });
  }

}
