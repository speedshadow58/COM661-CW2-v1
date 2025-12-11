import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { AuthService } from '@auth0/auth0-angular';

import { Game } from './game';

describe('Game', () => {
  let component: Game;
  let fixture: ComponentFixture<Game>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Game, HttpClientTestingModule, RouterTestingModule],
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

    fixture = TestBed.createComponent(Game);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
