import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { WebService } from '../../services/web-service';
import { Subject, catchError, of, takeUntil } from 'rxjs';
import { MiscAnalytics } from './misc-analytics/misc-analytics';

import { CommonModule, JsonPipe, SlicePipe } from '@angular/common';
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MiscAnalytics, JsonPipe, SlicePipe],
  templateUrl: './admin.html',
  styleUrls: ['./admin.css']
})
export class Admin implements OnInit, OnDestroy {
  // Misc Analytics properties
  stats: any = null;
  games: any[] = [];
  error: string | null = null;
  miscLoading = false;
  miscCurrentPage = 1;
  miscPageSize = 20;
  miscTotalPages = 1;
  miscSearchTerm = '';
  allReviews: any[] = [];
  filteredReviews: any[] = [];
  displayedReviews: any[] = [];
  searchTerm: string = '';
  loading = false;
  currentPage = 1;
  totalPages = 1;
  reviewsPerPage = 20;
  links: any = {};

  // Audit logs
  auditLogs: any[] = [];
  logsCurrentPage = 1;
  logsTotalPages = 1;
  logsLoading = false;
  showAuditLogs = false;
  showMisc = false;

  private destroy$ = new Subject<void>();
  expandedLogIndex: number | null = null;

  toggleExpandLog(idx: number) {
    this.expandedLogIndex = this.expandedLogIndex === idx ? null : idx;
  }

  constructor(
    private webService: WebService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadAllReviews();
    this.loadStats();
    this.loadGames();
  }
  // Misc Analytics methods
  loadStats() {
    this.webService.getDashboardStats().subscribe({
      next: (res) => { this.stats = res; this.cdr.detectChanges(); },
      error: (err) => { this.error = err.error?.message || err.message || 'Failed to load stats.'; this.cdr.detectChanges(); }
    });
  }

  loadGames() {
    this.miscLoading = true;
    this.webService.getMiscGames().subscribe({
      next: (res) => {
        this.games = res || [];
        this.miscTotalPages = Math.max(1, Math.ceil(this.games.length / this.miscPageSize));
        this.miscLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.error = err.error?.message || err.message || 'Failed to load games.';
        this.miscLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  get pagedGames() {
    const start = (this.miscCurrentPage - 1) * this.miscPageSize;
    return this.games.slice(start, start + this.miscPageSize);
  }

  goToPage(page: number) {
    if (page < 1 || page > this.miscTotalPages) return;
    this.miscCurrentPage = page;
    this.cdr.detectChanges();
  }

  searchGames() {
    // Simple client-side search by name, genre, tag, or developer
    const term = this.miscSearchTerm.trim().toLowerCase();
    if (!term) {
      this.loadGames();
      return;
    }
    this.games = this.games.filter(g =>
      g.name?.toLowerCase().includes(term) ||
      g.details?.genres?.join(',').toLowerCase().includes(term) ||
      g.details?.tags?.join(',').toLowerCase().includes(term) ||
      g.companies?.developers?.join(',').toLowerCase().includes(term)
    );
    this.miscTotalPages = Math.max(1, Math.ceil(this.games.length / this.miscPageSize));
    this.miscCurrentPage = 1;
    this.cdr.detectChanges();
  }

  loadAllReviews() {
    this.loading = true;
    this.cdr.detectChanges();
    
    // Load first page to get all reviews - we'll paginate client-side
    this.webService.getAllReviews(1).pipe(
      catchError(err => {
        console.error('[Admin] Failed to load reviews:', err);
        return of({ data: [] });
      }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      const data = res?.data || [];
      
      // Flatten reviews from all games
      this.allReviews = [];
      data.forEach((game: any) => {
        const reviews = game.reviews?.list || [];
        reviews.forEach((review: any) => {
          this.allReviews.push({
            ...review,
            gameName: game.name,
            gameAppid: game.appid
          });
        });
      });

      this.filteredReviews = [...this.allReviews];
      this.links = res?.links || {};
      this.updatePagination();
      this.loading = false;
      this.cdr.detectChanges();
    });
  }

  updatePagination() {
    this.totalPages = Math.max(1, Math.ceil(this.filteredReviews.length / this.reviewsPerPage));
    if (this.currentPage > this.totalPages) this.currentPage = 1;
    
    const start = (this.currentPage - 1) * this.reviewsPerPage;
    const end = start + this.reviewsPerPage;
    this.displayedReviews = this.filteredReviews.slice(start, end);
    this.cdr.detectChanges();
  }

  searchReviews() {
    if (!this.searchTerm.trim()) {
      this.filteredReviews = [...this.allReviews];
    } else {
      const term = this.searchTerm.toLowerCase();
      this.filteredReviews = this.allReviews.filter(r => 
        r.username?.toLowerCase().includes(term) ||
        r.comment?.toLowerCase().includes(term) ||
        r.gameName?.toLowerCase().includes(term)
      );
    }
    this.currentPage = 1;
    this.updatePagination();
  }

  deleteReview(review: any) {
    if (!confirm(`Delete review by ${review.username} for ${review.gameName}?`)) return;
    if (!review._id) {
      alert('Cannot delete: review ID is missing.');
      return;
    }
    this.webService.deleteReview(review.gameAppid, review._id).pipe(
      catchError(err => {
        console.error('[Admin] Failed to delete review:', err);
        alert('Failed to delete review');
        return of(null);
      })
    ).subscribe(res => {
      if (res) {
        // Remove from all arrays and update pagination
        this.allReviews = this.allReviews.filter(r => r._id !== review._id);
        this.filteredReviews = this.filteredReviews.filter(r => r._id !== review._id);
        this.displayedReviews = this.displayedReviews.filter(r => r._id !== review._id);
        this.updatePagination();
        this.cdr.detectChanges();
      }
    });
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.updatePagination();
    }
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.updatePagination();
    }
  }

  getRatingClass(rating: number): string {
    if (rating >= 75) return 'bg-success';
    if (rating >= 50) return 'bg-warning';
    return 'bg-danger';
  }

  getPositiveCount(): number {
    return this.allReviews.filter(r => r.rating >= 50).length;
  }

  getNegativeCount(): number {
    return this.allReviews.filter(r => r.rating < 50).length;
  }

  // Toggle between reviews, audit logs, and misc analytics
  toggleView(view?: 'reviews' | 'logs' | 'misc') {
    if (view === 'logs') {
      this.showAuditLogs = true;
      this.showMisc = false;
      if (this.auditLogs.length === 0) {
        this.loadAuditLogs();
      }
    } else if (view === 'misc') {
      this.showAuditLogs = false;
      this.showMisc = true;
    } else {
      this.showAuditLogs = false;
      this.showMisc = false;
    }
    this.cdr.detectChanges();
  }

  // Load audit logs from backend
  loadAuditLogs() {
    this.logsLoading = true;
    this.webService.getAdminLogs(this.logsCurrentPage).pipe(
      catchError(err => {
        console.error('[Admin] Failed to load audit logs:', err);
        return of({ data: [], total_pages: 1 });
      }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.auditLogs = res?.data || [];
      this.logsTotalPages = res?.total_pages || 1;
      this.logsLoading = false;
      this.cdr.detectChanges();
    });
  }

  // Audit logs pagination
  logsPrevPage() {
    if (this.logsCurrentPage > 1) {
      this.logsCurrentPage--;
      this.loadAuditLogs();
    }
  }

  logsNextPage() {
    if (this.logsCurrentPage < this.logsTotalPages) {
      this.logsCurrentPage++;
      this.loadAuditLogs();
    }
  }

  // Format timestamp for display
  formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

    // Format details for display (pretty-print JSON if possible)
    formatDetailsAsTable(details: any): { key: string, value: string }[] {
      if (!details) return [];
      let parsed: any = details;
      if (typeof details === 'string') {
        try {
          parsed = JSON.parse(details);
        } catch {
          return [{ key: 'Details', value: details }];
        }
      }
      // Remove _id fields and flatten one level for display
      const clean = (obj: any): any => {
        if (Array.isArray(obj)) {
          return obj.map(clean);
        } else if (obj && typeof obj === 'object') {
          const copy: any = {};
          for (const key of Object.keys(obj)) {
            if (key !== '_id') copy[key] = clean(obj[key]);
          }
          return copy;
        }
        return obj;
      };
      parsed = clean(parsed);
      // If it's an array, show as comma-separated
      if (Array.isArray(parsed)) {
        return [{ key: 'List', value: parsed.join(', ') }];
      }
      // If it's an object, show key-value pairs
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.entries(parsed).map(([key, value]) => ({
          key,
          value: Array.isArray(value) ? value.join(', ') : (typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value))
        }));
      }
      // Fallback for primitives
      return [{ key: 'Details', value: String(parsed) }];
    }

  // Get action badge class
  getActionClass(action: string): string {
    if (action.includes('delete') || action.includes('DELETE')) return 'badge-danger';
    if (action.includes('create') || action.includes('POST')) return 'badge-success';
    if (action.includes('update') || action.includes('PUT')) return 'badge-warning';
    return 'badge-info';
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
