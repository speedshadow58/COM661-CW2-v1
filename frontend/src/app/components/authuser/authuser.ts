import { Component } from '@angular/core';
import { AuthService } from '@auth0/auth0-angular';
import { AsyncPipe, CommonModule } from '@angular/common';

@Component({
  selector: 'app-authuser',
  standalone: true,
  imports: [AsyncPipe, CommonModule],
  templateUrl: './authuser.html',
  styleUrls: ['./authuser.css'],
})
export class Authuser {
  constructor(protected auth: AuthService) {}

  // Optional helper to get login state observable
  get isAuthenticated$() {
    return this.auth.isAuthenticated$;
  }

  // Optional helper to get user profile observable
  get user$() {
    return this.auth.user$;
  }
}
