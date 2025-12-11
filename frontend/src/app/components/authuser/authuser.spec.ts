import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '@auth0/auth0-angular';

import { Authuser } from './authuser';

describe('Authuser', () => {
  let component: Authuser;
  let fixture: ComponentFixture<Authuser>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Authuser],
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

    fixture = TestBed.createComponent(Authuser);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
