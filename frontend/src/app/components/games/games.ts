import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { WebService } from '../../services/web-service';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, forkJoin, Subject, Subscription } from 'rxjs';
import { map, catchError, take, filter as rxFilter, switchMap, debounceTime, distinctUntilChanged, filter } from 'rxjs/operators';
import { Router, RouterLink, ActivatedRoute, ParamMap, NavigationEnd } from '@angular/router';
import { Game } from '../../models/game.model';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-games',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './games.html',
  styleUrls: ['./games.css']
})
export class Games implements OnInit, OnDestroy {

  // Prevent flicker: only set fallback once
  onImageError(event: Event) {
    const img = event.target as HTMLImageElement;
    if (!img.dataset['fallback']) {
      img.src = 'assets/not-available.svg';
      img.dataset['fallback'] = 'true';
    }
  }

  games_list$!: Observable<any[]>; // allow normalized shape
  page = 1;
  totalPages = 1;
  sortBy: string = ''; // 'topRated' or empty

  private filterDefaults = { genre: '', tag: '', developer: '', language: '', price_min: '', price_max: '', name: '' };

  // Filtering
  filterParams: any = { genre: '', tag: '', developer: '', language: '', price_min: '', price_max: '', name: '' };
  filteredGames: any[] = [];
  filterPage = 1;
  filterTotalPages = 1;
  filterLoading = false;

  // Steam price fetch guards
  private blockedSteamPriceAppIds = new Set<number>();
  
  // Debounce filter changes to avoid cascading requests
  private filterChangeSubject = new Subject<any>();
  private routeSub: Subscription | null = null;

  // Stats
  gameStats: any = null;
  statsLoading = false;

  // Pagination links from backend (HATEOAS)
  links: any = {};

  constructor(
    private webService: WebService,
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute,
    private router: Router
  ) {
    // Debounce filter changes by 300ms
    this.filterChangeSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(() => {
      this.applyFilters();
    });
  }

  ngOnInit() {
    // Clear any cached data when component initializes
    this.filteredGames = [];
    this.games_list$ = of([]);
    
    const qp = this.route.snapshot.queryParamMap;
    this.syncFromQuery(qp, true);

    // React to query param changes (nav click, back nav, applyFilters)
    this.routeSub = this.route.queryParamMap.subscribe((qp) => {
      // Skip initial (already handled above)
      if (this.page !== 1 || this.filteredGames.length > 0 || Object.keys(this.filterParams).some(k => this.filterParams[k])) {
        this.syncFromQuery(qp, false);
      }
    });

    // Also listen for route navigation to force reload
    this.router.events.pipe(
      rxFilter(event => event instanceof NavigationEnd),
      take(1)
    ).subscribe(() => {
      // Force a fresh load of games whenever we navigate to this route
      this.loadGames();
    });
  }

  ngOnDestroy() {
    if (this.routeSub) {
      this.routeSub.unsubscribe();
    }
  }

  private syncFromQuery(qp: ParamMap, initial: boolean) {
    const qpPage = Number(qp.get('page'));
    if (!Number.isNaN(qpPage) && qpPage > 0) {
      // Clamp page to valid range (will be further validated after totalPages is known)
      this.page = Math.max(1, qpPage);
    }

    // Check for sortBy parameter
    const sortParam = qp.get('sortBy');
    if (sortParam) {
      this.sortBy = sortParam;
    } else {
      this.sortBy = '';
    }

    // Map query params back to filters if present
    const keys = Object.keys(this.filterDefaults);
    let hasQueryFilters = false;
    const nextFilters: any = { ...this.filterDefaults };
    keys.forEach(key => {
      const val = qp.get(key);
      if (val !== null && val !== '') {
        nextFilters[key] = val;
        hasQueryFilters = true;
      }
    });

    if (hasQueryFilters || this.sortBy) {
      // URL has filters or sort—restore them and reload filtered list
      this.filterParams = nextFilters;
      this.filterPage = qpPage > 0 ? qpPage : 1;
      if (!initial) {
        // Special handling for value/sentiment sorts - only if no filters active
        if ((this.sortBy === 'value' || this.sortBy === 'sentiment') && !hasQueryFilters) {
          this.loadAdvancedSortedGames();
        } else {
          this.applyFilters();
        }
      }
    } else {
      // No filters/sortBy in URL—clear state and show default games
      this.filterParams = { ...this.filterDefaults };
      this.filterPage = 1;
      this.filteredGames = [];
      this.sortBy = '';
    }

    if (initial) {
      // On initial load, check if we should use advanced sorts or regular loading
      if ((this.sortBy === 'value' || this.sortBy === 'sentiment') && !hasQueryFilters) {
        this.loadAdvancedSortedGames();
      } else if (this.sortBy === 'topRated' && !hasQueryFilters) {
        // topRated uses dedicated loading to fetch and sort all games
        this.loadTopRatedGames();
      } else if (hasQueryFilters || this.sortBy) {
        this.applyFilters();
      } else {
        this.loadGames();
      }
      this.loadStats();
    } else if (!hasQueryFilters && !this.sortBy) {
      // Refresh default list when filters are cleared via navigation
      this.loadGames();
    }
  }

  // Load games from advanced analytics endpoints (value/sentiment)
  loadAdvancedSortedGames() {
    this.filterLoading = true;
    const pageSize = this.webService.pageSize;
    const offset = (this.filterPage - 1) * pageSize;
    
    // Fetch only enough rows for the current page (cumulative) to reduce wait time
    const fetchLimit = Math.max(this.webService.pageSize * this.filterPage, this.webService.pageSize);

    let observable;
    if (this.sortBy === 'value') {
      observable = this.webService.getValueForMoney(fetchLimit);
    } else if (this.sortBy === 'sentiment') {
      observable = this.webService.getSentimentBreakdown(fetchLimit);
    } else {
      this.filterLoading = false;
      return;
    }

    observable.pipe(
      take(1),
      switchMap((games: any) => {
        const gameList = Array.isArray(games) ? games : (games?.data || []);
        const paginated = gameList.slice(offset, offset + pageSize);
        const estimatedTotal = Math.max(gameList.length || 0, 100);

        // Show normalized data immediately (quick display), enrich in background
        const normalizedPage = paginated.map((item: any) => this.normalizeGame(item));
        
        // Then enrich with Steam prices in background (don't block display)
        setTimeout(() => {
          const detailCalls = paginated.map((g: any) => 
            this.webService.getSteamDetails(g.appid).pipe(
              take(1),
              map((steamPrice: any) => {
                const priceOverview = steamPrice?.[g.appid]?.data?.price_overview || steamPrice?.data?.price_overview;
                // Supported languages from Steam API
                let supportedLanguagesRaw = steamPrice?.[g.appid]?.data?.supported_languages || steamPrice?.data?.supported_languages || '';
                // Remove HTML tags
                supportedLanguagesRaw = typeof supportedLanguagesRaw === 'string' ? supportedLanguagesRaw.replace(/<[^>]+>/g, '') : supportedLanguagesRaw;
                // Split by comma and trim
                const supportedLanguages = supportedLanguagesRaw.split(',').map((lang: string) => lang.trim()).filter((lang: string) => lang);
                return { ...g, price_overview: priceOverview || g.price_overview, supported_languages: supportedLanguages.length ? supportedLanguages : g.supported_languages };
              }),
              catchError(() => of(g))
            )
          );

          forkJoin(detailCalls).pipe(
            take(1),
            catchError(() => of(paginated))
          ).subscribe((enriched: any[]) => {
            // Update with enriched prices and languages
            const enrichedNormalized = enriched.map((item: any) => this.normalizeGame(item));
            this.filteredGames = enrichedNormalized;
            this.cdr.detectChanges();
          });
        }, 0);

        return of({ games: normalizedPage, total: estimatedTotal });
      }),
      catchError(err => {
        console.error('[Advanced Sort] Error', err);
        return of({ games: [], total: 0 });
      })
    ).subscribe({
      next: ({ games, total }: { games: any[]; total: number; }) => {
        this.filteredGames = games;
        // Use estimated total to keep pagination buttons visible
        const totalResults = total || games.length || 100;
        this.filterTotalPages = Math.max(1, Math.ceil(totalResults / this.webService.pageSize));
        this.filterLoading = false;
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        console.error('[Advanced Sort] Subscription error', err);
        this.filteredGames = [];
        this.filterLoading = false;
      }
    });
  }

  hasActiveFilters() {
    return Object.keys(this.filterParams).some(key => {
      const val = this.filterParams[key];
      return val !== '' && val != null;
    });
  }

  // Debounced filter trigger (use when filters change, not on button click)
  onFilterChange() {
    this.filterChangeSubject.next(this.filterParams);
  }

  // Fetch accurate Steam API price for a game
  // Extract price as a number (in GBP) from any format, prioritizing Steam API
  private extractPrice(game: any): number {
    // Try formatted first to extract cents
    const formatted = game?.price_overview?.final_formatted || game?.metadata?.price_overview?.final_formatted;
    
    // Try direct cents value from Steam API
    const finalCents = game?.price_overview?.final ?? game?.metadata?.price_overview?.final;
    if (Number.isFinite(finalCents)) {
      return finalCents / 100;
    }
    
    // Fallback to pre-converted GBP values
    const candidates = [game?.price_gbp, game?.price, game?.metadata?.price];
    const first = candidates.find(v => v !== undefined && v !== null);
    if (Number.isFinite(first)) {
      return Number(first);
    }
    
    return 0;
  }

  // Format price without rounding up (truncates to 2 decimal places)
  formatPrice(game: any): string {
    const formatted = game?.price_overview?.final_formatted;
    if (formatted) return formatted;

    const metaFormatted = game?.metadata?.price_overview?.final_formatted;
    if (metaFormatted) return metaFormatted;

    const price = this.extractPrice(game);
    if (price === 0) return 'Free';
    return `£${price.toFixed(2)}`;
  }

  // Load games sorted by top rated (highest review score first)
  loadTopRatedGames() {
    this.filterLoading = true;
    const pageSize = this.webService.pageSize;
    
    // Use backend sorting - just fetch the current page with topRated sort
    this.webService.getGames(this.filterPage, 'topRated').pipe(
      take(1),
      switchMap((res: any) => {
        console.log('[TopRated] Response:', res);
        const games = res?.data || [];
        const pagination = res?.pagination;
        
        this.filterTotalPages = pagination?.total_pages || 1;
        
        // Normalize games
        const normalized = games.map((g: any) => this.normalizeGame(g));
        
        console.log('[TopRated] Page', this.filterPage, 'has', normalized.length, 'items');
        
        // Enrich with Steam prices (parallel forkJoin safe for page-sized batches)
        const enrichedGames = normalized.map((game: any) => 
          this.webService.getSteamDetails(game.appid).pipe(
            take(1),
            map((steamData: any) => {
              const priceOverview = steamData?.[game.appid]?.data?.price_overview || steamData?.data?.price_overview;
              // Supported languages from Steam API
              let supportedLanguagesRaw = steamData?.[game.appid]?.data?.supported_languages || steamData?.data?.supported_languages || '';
              // Remove HTML tags
              supportedLanguagesRaw = typeof supportedLanguagesRaw === 'string' ? supportedLanguagesRaw.replace(/<[^>]+>/g, '') : supportedLanguagesRaw;
              // Split by comma and trim
              const supportedLanguages = supportedLanguagesRaw.split(',').map((lang: string) => lang.trim()).filter((lang: string) => lang);
              return { ...game, price_overview: priceOverview || game.price_overview, supported_languages: supportedLanguages.length ? supportedLanguages : game.supported_languages };
            }),
            catchError(() => of(game))
          )
        );
        return forkJoin(enrichedGames.length > 0 ? enrichedGames : [of([])]).pipe(
          catchError(() => of(normalized)) // Fallback if Steam API fails
        );
      }),
      catchError(err => {
        console.error('[TopRated] Error', err);
        this.filterLoading = false;
        return of([]);
      })
    ).subscribe({
      next: (games: any) => {
        console.log('[TopRated] Final games for display:', games.length);
        this.filteredGames = Array.isArray(games) ? games : [];
        this.filterLoading = false;
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        console.error('[TopRated] Subscription error', err);
        this.filteredGames = [];
        this.filterLoading = false;
      }
    });
  }

  // normalize fields we want to display so template can read consistent props
  private normalizeGame(g: any) {
    // Map backend fields to what template expects
    let developers = g.metadata?.developers || g.developers || [];
    let publishers = g.metadata?.publishers || g.publishers || [];
    
    // Handle stringified arrays: ["['Name']"] → ['Name']
    if (Array.isArray(developers)) {
      developers = developers.map((d: any) => {
        if (typeof d === 'string' && d.startsWith('[')) {
          try {
            // Convert single quotes to double quotes for valid JSON
            const jsonStr = d.replace(/'/g, '"');
            const parsed = JSON.parse(jsonStr);
            return Array.isArray(parsed) ? parsed : [parsed];
          } catch (e) {
            return d;
          }
        }
        return d;
      }).flat();
    }
    
    if (Array.isArray(publishers)) {
      publishers = publishers.map((p: any) => {
        if (typeof p === 'string' && p.startsWith('[')) {
          try {
            // Convert single quotes to double quotes for valid JSON
            const jsonStr = p.replace(/'/g, '"');
            const parsed = JSON.parse(jsonStr);
            return Array.isArray(parsed) ? parsed : [parsed];
          } catch (e) {
            return p;
          }
        }
        return p;
      }).flat();
    }
    
    // Ensure we have arrays and filter out empty/null strings
    developers = Array.isArray(developers) ? developers.filter((d: any) => d && d !== '') : (developers ? [developers] : []);
    publishers = Array.isArray(publishers) ? publishers.filter((p: any) => p && p !== '') : (publishers ? [publishers] : []);

    // Extract review score - prioritize direct review_score field
    let reviewScore = g.review_score ?? null;
    if (reviewScore === null || reviewScore === undefined) {
      if (g.reviews?.positive !== undefined && g.reviews?.num_reviews_total > 0) {
        const positive = g.reviews.positive || 0;
        const total = g.reviews.num_reviews_total || 1;
        reviewScore = Math.round((positive / total) * 100);
      } else if (g.reviews?.pct_pos_total !== undefined && g.reviews?.pct_pos_total !== null) {
        reviewScore = g.reviews.pct_pos_total;
      } else if (g.positive_percent !== undefined) {
        reviewScore = g.positive_percent;
      }
    }
    if (typeof reviewScore === 'number' && Number.isFinite(reviewScore)) {
      reviewScore = Math.min(100, Math.max(0, reviewScore));
    }
    // Flatten and stringify tags and supported_languages for display
    function flattenAndStringify(arr: any[]): string[] {
      if (!Array.isArray(arr)) return [];
      return arr.flatMap((item: any) => {
        if (Array.isArray(item)) {
          return flattenAndStringify(item);
        } else if (typeof item === 'string') {
          // Try to parse stringified dict or array
          if (item.startsWith('{') && item.endsWith('}')) {
            try {
              const keys = Object.keys(Function('return ' + item)());
              return keys;
            } catch {
              return [item];
            }
          } else if (item.startsWith("[") && item.endsWith("]")) {
            try {
              const jsonStr = item.replace(/'/g, '"');
              const parsed = JSON.parse(jsonStr);
              return flattenAndStringify(parsed);
            } catch {
              return [item];
            }
          }
          return [item];
        } else {
          return [String(item)];
        }
      });
    }

    // Always normalize tags and supported_languages for all game objects
    let normalizedTags = flattenAndStringify(g.tags || []);
    let normalizedSupportedLanguages = flattenAndStringify(g.supported_languages || []);

    return {
      ...g,
      developers: developers,
      publishers: publishers,
      review_score: reviewScore,
      developerName: developers.length > 0 ? developers[0] : '',
      publisherName: publishers.length > 0 ? publishers[0] : '',
      tags: normalizedTags,
      supported_languages: normalizedSupportedLanguages
    };
  }

  loadGames() {
    this.games_list$ = this.webService.getGames(this.page).pipe(
      switchMap((res: any) => {
        const pagination = res?.pagination;
        this.totalPages = pagination ? Math.ceil((pagination.total_results ?? 0) / (pagination.page_size ?? 1)) : 1;
        this.links = res?.links || {};
        
        // Validate page is within bounds - redirect if needed
        if (this.page > this.totalPages) {
          this.page = this.totalPages;
          this.syncPageQuery();
          return of([]); // Return empty, will reload with correct page
        }
        
        let data = res?.data ?? [];
        
        this.syncPageQuery();
        const normalized = data.map((g: any) => this.normalizeGame(g));
        
        // Apply topRated sorting AFTER normalization
        if (this.sortBy === 'topRated') {
          normalized.sort((a: any, b: any) => {
            const scoreA = a.review_score ?? 0;
            const scoreB = b.review_score ?? 0;
            return scoreB - scoreA;
          });
        }
        
        // Enrich all games with Steam API prices (parallel safe for page sizes)
        const enrichedGames = normalized.map((game: any) => 
          this.webService.getSteamDetails(game.appid).pipe(
            take(1),
            map((steamData: any) => {
              const priceOverview = steamData?.[game.appid]?.data?.price_overview || steamData?.data?.price_overview;
              // Supported languages from Steam API
              let supportedLanguagesRaw = steamData?.[game.appid]?.data?.supported_languages || steamData?.data?.supported_languages || '';
              // Remove HTML tags
              supportedLanguagesRaw = typeof supportedLanguagesRaw === 'string' ? supportedLanguagesRaw.replace(/<[^>]+>/g, '') : supportedLanguagesRaw;
              // Split by comma and trim
              const supportedLanguages = supportedLanguagesRaw.split(',').map((lang: string) => lang.trim()).filter((lang: string) => lang);
              return { ...game, price_overview: priceOverview || game.price_overview, supported_languages: supportedLanguages.length ? supportedLanguages : game.supported_languages };
            }),
            catchError(() => of(game))
          )
        );
        return forkJoin(enrichedGames).pipe(
          catchError(() => of(normalized)) // Fallback to non-enriched if Steam API fails
        );
      }),
      catchError(err => {
        console.error('[Games] Failed to load:', err);
        return of([]);
      })
    );
  }

  loadStats() {
    this.statsLoading = true;
    console.log('[Stats] Loading stats from:', this.webService.API_BASE + '/games/stats');
    this.webService.getGameStats().pipe(take(1)).subscribe({
      next: (res: any) => {
        console.log('[Stats] Full response:', res);
        console.log('[Stats] Response.data:', res.data);
        this.gameStats = res.data ? res.data : res;
        console.log('[Stats] Final gameStats:', this.gameStats);
        console.log('[Stats] Keys:', Object.keys(this.gameStats));
        this.statsLoading = false;
      },
      error: (err: any) => {
        console.error('[Stats] Failed to load:', err);
        console.error('[Stats] Error details:', err.error);
        this.statsLoading = false;
      }
    });
  }

  trackByAppId(index: number, game: any) {
    return game.appid;
  }

  // Default pagination
  nextPage() {
    if (this.page < this.totalPages) {
      this.page++;
      this.loadGames();
    }
  }
  previousPage() {
    if (this.page > 1) {
      this.page--;
      this.loadGames();
    }
  }

  goToPage(target: any) {
    const requested = Number(target);
    if (Number.isNaN(requested)) return;
    const clamped = Math.min(Math.max(1, requested), this.totalPages);
    if (clamped === this.page) return;
    this.page = clamped;
    this.loadGames();
  }

  private syncPageQuery() {
    // Keep current page in the URL so back nav restores it
    const qParams: any = { page: this.page };
    if (this.sortBy) {
      qParams.sortBy = this.sortBy;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: qParams,
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  // Filter pagination
  nextFilterPage() {
    if (this.filterPage < this.filterTotalPages) { 
      this.filterPage++; 
      this.persistFilterPage(); 
      if ((this.sortBy === 'value' || this.sortBy === 'sentiment') && !this.hasActiveFilters()) {
        this.loadAdvancedSortedGames();
      } else {
        this.applyFilters();
      }
    }
  }
  prevFilterPage() {
    if (this.filterPage > 1) { 
      this.filterPage--; 
      this.persistFilterPage(); 
      if ((this.sortBy === 'value' || this.sortBy === 'sentiment') && !this.hasActiveFilters()) {
        this.loadAdvancedSortedGames();
      } else {
        this.applyFilters();
      }
    }
  }

  goToFilterPage(target: any) {
    const requested = Number(target);
    if (Number.isNaN(requested)) return;
    const clamped = Math.min(Math.max(1, requested), this.filterTotalPages);
    if (clamped === this.filterPage) return;
    this.filterPage = clamped;
    this.persistFilterPage();
    if ((this.sortBy === 'value' || this.sortBy === 'sentiment') && !this.hasActiveFilters()) {
      this.loadAdvancedSortedGames();
    } else {
      this.applyFilters();
    }
  }

  private persistFilterPage() {
    const cleanedParams: any = {};
    Object.keys(this.filterParams).forEach(key => {
      if (this.filterParams[key] !== '' && this.filterParams[key] != null) {
        cleanedParams[key] = this.filterParams[key];
      }
    });
    const qParams: any = { page: this.filterPage, ...cleanedParams };
    if (this.sortBy) {
      qParams.sortBy = this.sortBy;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: qParams,
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  // Apply filters
  applyFilters() {
  // Advanced sorts (value/sentiment) don't support filtering, so clear them
  if (this.sortBy === 'value' || this.sortBy === 'sentiment') {
    this.sortBy = '';
  }

  this.filterLoading = true;

  // Build a cleaned object with only non-empty values
  const cleanedParams: any = {};
  Object.keys(this.filterParams).forEach(key => {
    if (this.filterParams[key] !== '' && this.filterParams[key] != null) {
      cleanedParams[key] = this.filterParams[key];
    }
  });

  const queryParams = new URLSearchParams({ ...cleanedParams, page: this.filterPage } as any).toString();
  console.log(`[Filter] Requesting /games/filter?${queryParams}`);

  // Persist filters to URL so they survive back nav
  const qParams: any = { page: this.filterPage, ...cleanedParams };
  if (this.sortBy) {
    qParams.sortBy = this.sortBy;
  }
  this.router.navigate([], {
    relativeTo: this.route,
    queryParams: qParams,
    queryParamsHandling: 'merge',
    replaceUrl: true
  });

  this.webService.filterGames(cleanedParams, this.filterPage).pipe(take(1)).subscribe({
    next: (res: any) => {
      let data = res.data || [];
      console.log('[Filter] Response received:', res);
      console.log('[Filter] Data length:', data.length);
      
      let games = data.map((g: any) => this.normalizeGame(g));
      
      // Apply sorting AFTER normalization if needed
      if (this.sortBy === 'topRated') {
        games = games.sort((a: any, b: any) => {
          const scoreA = a.review_score ?? 0;
          const scoreB = b.review_score ?? 0;
          return scoreB - scoreA;
        });
      }

      // Enrich with Steam prices via backend proxy
      const enrichCalls = games.map((g: any) => 
        this.webService.getSteamDetails(g.appid).pipe(
          take(1),
          map((steamData: any) => {
            const priceOverview = steamData?.[g.appid]?.data?.price_overview || steamData?.data?.price_overview;
            // Supported languages from Steam API
            let supportedLanguagesRaw = steamData?.[g.appid]?.data?.supported_languages || steamData?.data?.supported_languages || '';
            // Remove HTML tags
            supportedLanguagesRaw = typeof supportedLanguagesRaw === 'string' ? supportedLanguagesRaw.replace(/<[^>]+>/g, '') : supportedLanguagesRaw;
            // Split by comma and trim
            const supportedLanguages = supportedLanguagesRaw.split(',').map((lang: string) => lang.trim()).filter((lang: string) => lang);
            return { ...g, price_overview: priceOverview || g.price_overview, supported_languages: supportedLanguages.length ? supportedLanguages : g.supported_languages };
          }),
          catchError(() => of(g))
        )
      );
      forkJoin(enrichCalls).pipe(
        catchError(() => of(games))
      ).subscribe((enriched: any[]) => {
        this.filteredGames = enriched;
        console.log('[Filter] Enriched games:', this.filteredGames);
        this.filterTotalPages = res.total_pages || 1;
        
        // Validate filterPage is within bounds
        if (this.filterPage > this.filterTotalPages) {
          this.filterPage = this.filterTotalPages;
          this.applyFilters(); // Re-apply with correct page
          return;
        }
        
        this.filterLoading = false;
        this.cdr.detectChanges();
      });
    },
    error: (err: any) => {
      console.error('[Filter] Error', err);
      this.filteredGames = [];
      this.filterLoading = false;
    }
  });
}



  resetFilters() {
    this.filterParams = { genre: '', tag: '', developer: '', language: '', price_min: '', price_max: '', name: '' };
    this.filterPage = 1;
    this.filteredGames = [];
    this.sortBy = '';
    // Clear all query params and reset to default state
    this.router.navigate(['/games'], { queryParams: { page: 1 } });
    this.loadGames();
  }


}
