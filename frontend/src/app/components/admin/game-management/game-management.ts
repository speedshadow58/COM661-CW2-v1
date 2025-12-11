import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { WebService } from '../../../services/web-service';
import { Subject, catchError, of, takeUntil } from 'rxjs';

@Component({
  selector: 'app-game-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './game-management.html',
  styleUrls: ['./game-management.css']
})
export class GameManagement implements OnInit, OnDestroy {
      onImageError(event: Event) {
        (event.target as HTMLImageElement).src = 'assets/not-available.svg';
      }
    formatGBP(price: number): string {
      if (price === 0) return 'Free';
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(price);
    }
  games: any[] = [];
  loading = false;
  currentPage = 1;
  totalPages = 1;
  searchTerm = '';
  
  // Form state
  showForm = false;
  isEditing = false;
  currentGame: any = this.getEmptyGame();
  
  private destroy$ = new Subject<void>();

  constructor(private webService: WebService, private router: Router, private cdr: ChangeDetectorRef) {
    // Open edit form immediately if ?edit=appid is present
    const url = new URL(window.location.href);
    const editAppId = url.searchParams.get('edit');
    if (editAppId) {
      this.showForm = true;
      this.isEditing = true;
      this.currentGame = { ...this.getEmptyGame(), appid: Number(editAppId) };
    }
    // Reload games on every navigation to this route
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd && event.urlAfterRedirects.includes('/admin/games')) {
        this.loadGames();
        // After loading, update the form with the correct game data
        if (editAppId) {
          setTimeout(() => {
            const game = this.games.find(g => String(g.appid) === editAppId);
            if (game) {
              this.openEditForm(game);
            }
          }, 300);
        }
      }
    });
  }

  ngOnInit() {
    this.loadGames();
  }

  loadGames() {
    this.loading = true;
    this.webService.getGames(this.currentPage).pipe(
      catchError(err => {
        console.error('[GameManagement] Failed to load games:', err);
        return of({ data: [], total_pages: 1 });
      }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.games = res?.data || [];
      this.totalPages = res?.total_pages || 1;
      this.loading = false;
      // Apply client-side search filter if needed
      if (this.searchTerm.trim()) {
        this.filterGames();
      }
      // No longer update prices from Steam API after loading from DB
      this.cdr.detectChanges();
    });
  }

  filterGames() {
    if (!this.searchTerm.trim()) {
      this.loadGames();
      return;
    }
    
    const term = this.searchTerm.toLowerCase();
    this.games = this.games.filter(g => 
      g.name?.toLowerCase().includes(term) ||
      g.developer?.toLowerCase().includes(term) ||
      g.publisher?.toLowerCase().includes(term) ||
      String(g.appid).includes(term)
    );
  }

  searchGames() {
    this.currentPage = 1;
    this.loadGames();
  }

  // Form management
  openCreateForm() {
    this.currentGame = this.getEmptyGame();
    this.isEditing = false;
    this.showForm = true;
  }

  openEditForm(game: any) {
    // Show the form immediately with current data
    this.currentGame = { ...game };
    this.isEditing = true;
    this.showForm = true;
    // Fetch the latest game data from backend and update fields when it arrives
    this.webService.getGame(game.appid).subscribe((freshGame: any) => {
      const g = freshGame || game;
      // Only update fields, keep the form open
      this.currentGame = { ...g };
      this.currentGame.developer = Array.isArray(g.developers) ? g.developers.join(', ') : (typeof g.developers === 'string' ? g.developers : (g.developer || ''));
      this.currentGame.publisher = Array.isArray(g.publishers) ? g.publishers.join(', ') : (typeof g.publishers === 'string' ? g.publishers : (g.publisher || ''));
      this.currentGame.genres = Array.isArray(g.genres) ? g.genres.join(', ') : (typeof g.genres === 'string' ? g.genres : (g.genre || ''));
      this.currentGame.tags = Array.isArray(g.tags) ? g.tags.join(', ') : (typeof g.tags === 'string' ? g.tags : (g.tag || ''));
      this.currentGame.supported_languages = Array.isArray(g.supported_languages) ? g.supported_languages.join(', ') : (typeof g.supported_languages === 'string' ? g.supported_languages : (g.supported_language || ''));
      this.currentGame.positive = g.positive ?? (g.reviews?.positive ?? 0);
      this.currentGame.negative = g.negative ?? (g.reviews?.negative ?? 0);
      this.currentGame.metacritic_score = g.metacritic_score ?? (g.reviews?.metacritic_score ?? null);
      this.currentGame.peak_ccu = g.peak_ccu ?? (g.playtime?.peak_ccu ?? 0);
      this.currentGame.short_description = g.short_description ?? '';
      this.currentGame.header_image = g.header_image ?? '';
      this.currentGame.release_date = g.release_date ?? '';
      this.currentGame.price = g.price ?? 0;
      this.currentGame.average_playtime = g.average_playtime ?? 0;
      this.currentGame.median_playtime = g.median_playtime ?? 0;
      this.currentGame.owners = g.owners ?? '';
      this.currentGame.website = g.website ?? '';
      this.currentGame.required_age = g.required_age ?? 0;
      this.currentGame.achievements = g.achievements ?? 0;
      this.cdr.detectChanges();
    });
  }

  closeForm() {
    this.showForm = false;
    this.currentGame = this.getEmptyGame();
  }

  saveGame() {
    if (!this.validateGame()) {
      return;
    }

    this.loading = true;



    // Prepare all fields for backend (arrays as JSON strings)
    const gameToSend = { ...this.currentGame };

    // Map developer/publisher (singular) to developers/publishers (plural arrays)
    if (gameToSend.developer) {
      gameToSend.developers = JSON.stringify(gameToSend.developer.split(',').map((s: string) => s.trim()).filter((s: string) => s));
    }
    if (gameToSend.publisher) {
      gameToSend.publishers = JSON.stringify(gameToSend.publisher.split(',').map((s: string) => s.trim()).filter((s: string) => s));
    }

    // Convert other comma-separated fields to arrays
    const arrayFields = ['genres', 'tags', 'supported_languages'];
    arrayFields.forEach(field => {
      if (typeof gameToSend[field] === 'string') {
        const arr = gameToSend[field].split(',').map((s: string) => s.trim()).filter((s: string) => s);
        gameToSend[field] = JSON.stringify(arr);
      } else if (Array.isArray(gameToSend[field])) {
        gameToSend[field] = JSON.stringify(gameToSend[field]);
      }
    });

    // Ensure positive, negative, and metacritic_score are sent as strings
    if (gameToSend.positive !== undefined && gameToSend.positive !== null) {
      gameToSend.positive = String(gameToSend.positive);
    }
    if (gameToSend.negative !== undefined && gameToSend.negative !== null) {
      gameToSend.negative = String(gameToSend.negative);
    }
    if (gameToSend.metacritic_score !== undefined && gameToSend.metacritic_score !== null) {
      gameToSend.metacritic_score = String(gameToSend.metacritic_score);
    }

    if (this.isEditing) {
      // Update existing game
      this.webService.updateGame(this.currentGame.appid, gameToSend).pipe(
        catchError(err => {
          console.error('[GameManagement] Failed to update game:', err);
          alert('Failed to update game: ' + (err.error?.message || err.message));
          return of(null);
        }),
        takeUntil(this.destroy$)
      ).subscribe(res => {
        this.loading = false;
        if (res) {
          alert('Game updated successfully!');
          this.closeForm();
          this.loadGames();
        }
      });
    } else {
      // Create new game
      this.webService.createGame(gameToSend).pipe(
        catchError(err => {
          console.error('[GameManagement] Failed to create game:', err);
          alert('Failed to create game: ' + (err.error?.message || err.message));
          return of(null);
        }),
        takeUntil(this.destroy$)
      ).subscribe(res => {
        this.loading = false;
        if (res) {
          alert('Game created successfully!');
          this.closeForm();
          this.loadGames();
        }
      });
    }
  }

  deleteGame(game: any) {
    if (!confirm(`Delete game "${game.name}" (appid: ${game.appid})?\n\nThis action cannot be undone.`)) {
      return;
    }

    this.loading = true;
    this.webService.deleteGame(game.appid).pipe(
      catchError(err => {
        console.error('[GameManagement] Failed to delete game:', err);
        alert('Failed to delete game: ' + (err.error?.message || err.message));
        return of(null);
      }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.loading = false;
      if (res) {
        alert('Game deleted successfully!');
        this.loadGames();
      }
    });
  }

  validateGame(): boolean {
    if (!this.currentGame.appid || this.currentGame.appid <= 0) {
      alert('AppID is required and must be positive');
      return false;
    }
    if (!this.currentGame.name?.trim()) {
      alert('Game name is required');
      return false;
    }
    return true;
  }

  getEmptyGame() {
    return {
      appid: null,
      name: '',
      release_date: '',
      developer: '',
      publisher: '',
      positive: 0,
      negative: 0,
      average_playtime: 0,
      median_playtime: 0,
      owners: '',
      price: 0,
      genres: '',
      tags: '',
      short_description: '',
      header_image: '',
      website: '',
      metacritic_score: null,
      peak_ccu: 0,
      required_age: 0,
      achievements: 0
    };
  }

  // Pagination
  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadGames();
    }
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.loadGames();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
