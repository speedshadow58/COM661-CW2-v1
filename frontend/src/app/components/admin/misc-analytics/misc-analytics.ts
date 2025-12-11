import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { WebService } from '../../../services/web-service';
import { CommonModule, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-misc-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, JsonPipe],
  templateUrl: './misc-analytics.html',
  styleUrls: ['./misc-analytics.css']
})
export class MiscAnalytics implements OnInit {
  debugRes: any = null;
  stats: any = null;
  games: any[] = [];
  filteredGames: any[] = [];
  loading = false;
  error: string | null = null;
  success: string | null = null;
  currentPage = 1;
  pageSize = 20;
  totalPages = 1;
  searchTerm = '';

  newGame: any = { appid: '', name: '', genres: '', tags: '', developers: '', release_date: '', price: '' };
  editGameId: number | null = null;
  editGame: any = {};

  constructor(private webService: WebService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadStats();
    this.loadGames();
  }

  loadStats() {
    this.webService.getDashboardStats().subscribe({
      next: (res) => { this.stats = res; this.cdr.detectChanges(); },
      error: (err) => { this.error = err.error?.message || err.message || 'Failed to load stats.'; this.cdr.detectChanges(); }
    });
  }

  loadGames() {
    this.loading = true;
    this.webService.getMiscGames(this.currentPage).subscribe({
      next: (res) => {
        this.debugRes = res;
        this.games = (res?.data || []).map((g: any) => {
          // Normalize genres
          if (g.details?.genres) {
            g.details.genres = g.details.genres.map((genre: any) => {
              if (typeof genre === 'string' && genre.startsWith("['") && genre.endsWith("']")) {
                try {
                  return JSON.parse(genre.replace(/'/g, '"'))[0];
                } catch { return genre; }
              }
              return genre;
            });
          }
          // Normalize developers
          if (g.companies?.developers) {
            g.companies.developers = g.companies.developers.map((dev: any) => {
              if (typeof dev === 'string' && dev.startsWith("['") && dev.endsWith("']")) {
                try {
                  return JSON.parse(dev.replace(/'/g, '"'))[0];
                } catch { return dev; }
              }
              return dev;
            });
          }
          // Normalize publishers
          if (g.companies?.publishers) {
            g.companies.publishers = g.companies.publishers.map((pub: any) => {
              if (typeof pub === 'string' && pub.startsWith("['") && pub.endsWith("']")) {
                try {
                  return JSON.parse(pub.replace(/'/g, '"'))[0];
                } catch { return pub; }
              }
              return pub;
            });
          }
          return g;
        });
        this.filteredGames = [...this.games];
        // Use backend pagination if available
        if (res?.pagination) {
          this.totalPages = res.pagination.total_pages || 1;
          this.pageSize = res.pagination.page_size || this.pageSize;
        } else {
          this.totalPages = Math.max(1, Math.ceil(this.filteredGames.length / this.pageSize));
        }
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.error = err.error?.message || err.message || 'Failed to load games.';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  searchGames() {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) {
      this.currentPage = 1;
      this.loadGames();
      return;
    }
    // For search, fetch all results from backend (first 10 pages, up to 200 games)
    this.loading = true;
    const pageRequests = [];
    for (let i = 1; i <= 10; i++) {
      pageRequests.push(this.webService.getMiscGames(i));
    }
    Promise.all(pageRequests.map(r => r.toPromise())).then(results => {
      const allGames = results.flatMap(res => (res?.data || []));
      this.filteredGames = allGames.filter(g =>
        g.name?.toLowerCase().includes(term) ||
        (g.details?.genres || []).join(',').toLowerCase().includes(term) ||
        (g.details?.tags || []).join(',').toLowerCase().includes(term) ||
        (g.companies?.developers || []).join(',').toLowerCase().includes(term)
      );
      this.totalPages = Math.max(1, Math.ceil(this.filteredGames.length / this.pageSize));
      this.currentPage = 1;
      this.loading = false;
      this.cdr.detectChanges();
    });
  }

  addGame() {
    if (!this.newGame.appid || !this.newGame.name || !this.newGame.release_date || !this.newGame.price) return;
    const payload = {
      appid: this.newGame.appid,
      name: this.newGame.name,
      release_date: this.newGame.release_date,
      price: this.newGame.price,
      developers: JSON.stringify((this.newGame.developers || '').split(',').map((d: string) => d.trim()).filter(Boolean)),
      publishers: JSON.stringify([]),
      genres: JSON.stringify((this.newGame.genres || '').split(',').map((g: string) => g.trim()).filter(Boolean)),
      tags: JSON.stringify((this.newGame.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean)),
      supported_languages: JSON.stringify([]),
      short_description: '',
      peak_ccu: this.newGame.peak_ccu || 0
    };
    this.loading = true;
    this.webService.createGame(payload).subscribe({
      next: (res) => {
        // Add a short delay to ensure the game is created before updating misc fields
        setTimeout(() => {
          const miscData = {
            supported_languages: [],
            genres: (this.newGame.genres || '').split(',').map((g: string) => g.trim()).filter(Boolean),
            tags: (this.newGame.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
            peak_ccu: this.newGame.peak_ccu || 0
          };
          this.webService.setMiscFields(this.newGame.appid, miscData).subscribe({
            next: () => {
              this.newGame = { appid: '', name: '', genres: '', tags: '', developers: '', release_date: '', price: '' };
              this.loadGames();
            },
            error: (err) => {
              this.error = err.error?.message || err.message || 'Failed to set misc fields.';
              this.loading = false;
              this.cdr.detectChanges();
            }
          });
        }, 400);
      },
      error: (err) => { this.error = err.error?.message || err.message || 'Failed to add game.'; this.loading = false; this.cdr.detectChanges(); }
    });
  }

  startEditGame(game: any) {
    this.editGameId = game.appid;
    this.editGame = {
      name: game.name,
      genres: (game.details?.genres || []).join(', '),
      tags: (game.details?.tags || []).join(', '),
      supported_languages: (game.details?.supported_languages || []).join(', '),
      developers: (game.companies?.developers || []).join(', '),
      publishers: (game.companies?.publishers || []).join(', '),
      peak_ccu: game.stats?.peak_ccu || 0
    };
  }

  saveEditGame(game: any) {
    // Debug: log editGame before processing
    console.log('[MiscAnalytics] saveEditGame editGame:', this.editGame);
    const miscData = {
      appid: game.appid,
      name: this.editGame.name || game.name || '',
      genres: (this.editGame.genres || '').split(',').map((g: string) => g.trim()).filter(Boolean),
      tags: (this.editGame.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
      supported_languages: (this.editGame.supported_languages || '').split(',').map((l: string) => l.trim()).filter(Boolean),
      developers: (this.editGame.developers || '').split(',').map((d: string) => d.trim()).filter(Boolean),
      publishers: (this.editGame.publishers || '').split(',').map((p: string) => p.trim()).filter(Boolean),
      peak_ccu: this.editGame.peak_ccu || 0
    };
    this.loading = true;
    this.webService.setMiscFields(game.appid, miscData).subscribe({
      next: () => {
        this.editGameId = null;
        this.editGame = {};
        this.success = 'Game updated successfully!';
        this.loadGames();
        setTimeout(() => { this.success = null; this.cdr.detectChanges(); }, 2500);
      },
      error: (err) => { this.error = err.error?.message || err.message || 'Failed to update game.'; this.loading = false; this.cdr.detectChanges(); }
    });
  }

  cancelEditGame() {
    this.editGameId = null;
    this.editGame = {};
  }

  deleteGame(game: any) {
    if (!confirm(`Delete game ${game.name} (AppID: ${game.appid})?`)) return;
    this.loading = true;
    this.webService.deleteGame(game.appid).subscribe({
      next: () => { this.loadGames(); },
      error: (err) => { this.error = err.error?.message || err.message || 'Failed to delete game.'; this.loading = false; this.cdr.detectChanges(); }
    });
  }

  get pagedGames() {
    // If using backend pagination, just return filteredGames (already paged)
    return this.filteredGames;
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.loadGames();
  }
}
