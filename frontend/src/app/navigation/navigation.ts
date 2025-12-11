import { Component, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Authbutton } from '../components/authbutton/authbutton';
import { WebService } from '../services/web-service';
import { Subject, takeUntil } from 'rxjs';


@Component({
  selector: 'app-navigation',
  imports: [RouterModule, Authbutton, CommonModule],
  templateUrl: './navigation.html',
  styleUrl: './navigation.css',
})
export class Navigation implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();


  constructor(
    public webService: WebService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  // Close the admin dropdown after clicking an option
  closeDropdown(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    // Use Bootstrap's dropdown API to close
    const target = event.target as HTMLElement;
    let dropdownMenu = target.closest('.dropdown');
    if (dropdownMenu && (window as any).bootstrap) {
      // @ts-ignore
      const dropdown = (window as any).bootstrap.Dropdown.getOrCreateInstance(dropdownMenu.querySelector('.dropdown-toggle'));
      dropdown.hide();
    }
    // Use Angular router to navigate
    const routerLink = target.getAttribute('routerLink');
    if (routerLink) {
      this.cdr.detectChanges();
      this.router.navigate([routerLink]);
    }
  }

  ngOnInit() {
    // Subscribe to token changes to update admin link visibility
    this.webService.token$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.cdr.detectChanges();
    });
  }

  isAdmin(): boolean {
    return this.webService.isAdmin();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
