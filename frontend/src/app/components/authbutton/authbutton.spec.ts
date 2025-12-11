import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { AuthService } from '@auth0/auth0-angular';

import { Authbutton } from './authbutton';

describe('Authbutton', () => {
  let component: Authbutton;
  let fixture: ComponentFixture<Authbutton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Authbutton, RouterTestingModule, HttpClientTestingModule],
      providers: [
        {
          provide: AuthService,
          useValue: {
            isAuthenticated$: of(false),
            user$: of(null),
            loginWithRedirect: () => Promise.resolve(),
            logout: () => {}
          }
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Authbutton);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
