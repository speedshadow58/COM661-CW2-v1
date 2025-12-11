import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { WebService } from '../../services/web-service';
import { catchError, of, take, forkJoin, switchMap, map, filter, Subscription } from 'rxjs';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './home.html',
  styleUrls: ['./home.css'],
})
export class Home implements OnInit, OnDestroy {
  searchQuery = '';
  stats = {
    totalGames: 0,
    totalReviews: 0,
    topRatedGames: [] as any[],
  };
  recentReviews: any[] = [];
  recentReviewsCount: number = 0; // Count of reviews in last hour
  topGames: any[] = [];
  valueGames: any[] = [];
  sentimentGames: any[] = [];
  loading = false;
  private routerSub?: Subscription;

  constructor(
    private webService: WebService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadStats();
    this.loadRecentReviews();
    this.loadTopGames();
    this.loadValueGames();
    this.loadSentimentBreakdown();

    // Reload recent reviews when navigating back to home
    this.routerSub = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      filter((event: NavigationEnd) => event.urlAfterRedirects === '/' || event.urlAfterRedirects === '/home')
    ).subscribe(() => {
      this.loadRecentReviews();
    });
  }

  ngOnDestroy() {
    if (this.routerSub) {
      this.routerSub.unsubscribe();
    }
  }

  // Extract price as a number (in GBP) from any format, prioritizing Steam API
  private extractPrice(game: any): number {
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

  loadStats() {
    this.webService.getGameStats().pipe(
      take(1),
      catchError(err => {
        console.error('[Home] Failed to load stats:', err);
        return of(null);
      })
    ).subscribe(res => {
      if (res) {
        this.stats.totalGames = res?.data?.total_games || 0;
      }
      this.cdr.detectChanges();
    });

    // Load total reviews count (fetch all reviews like admin page)
    this.webService.getAllReviewsPublic(1).pipe(
      take(1),
      catchError(err => {
        console.error('[Home] Failed to load review count:', err);
        return of({ data: [] });
      })
    ).subscribe(res => {
      const data = res?.data || [];
      let totalReviews = 0;
      
      data.forEach((game: any) => {
        const reviews = game.reviews?.list || [];
        totalReviews += reviews.length;
      });
      
      this.stats.totalReviews = totalReviews;
      this.cdr.detectChanges();
    });
  }

  loadRecentReviews() {
    this.loading = true;
    
    // Use backend endpoint - handles all flattening, sorting, and hour counting
    this.webService.getRecentReviews(6).pipe(
      take(1),
      catchError(err => {
        console.error('[Home] Failed to load recent reviews:', err);
        return of({ reviews: [], recent_hour_count: 0 });
      })
    ).subscribe(response => {
      const data = response?.reviews || response?.data?.reviews || [];
      this.recentReviews = Array.isArray(data) ? data : [];
      this.recentReviewsCount = response?.recent_hour_count || response?.data?.recent_hour_count || 0;
      this.loading = false;
      this.cdr.detectChanges();
    });
  }

  loadTopGames() {
    this.webService.getTopGames('positive', 4).pipe(
      take(1),
      catchError(err => {
        console.error('[Home] Failed to load top games:', err);
        return of([]);
      })
    ).subscribe(games => {
      const gameList = Array.isArray(games) ? games : (games?.data || []);
      
      // Show data immediately with existing prices (instant)
      this.topGames = gameList.map((g: any) => ({
        ...g,
        price: this.extractPrice(g)
      }));
      this.cdr.detectChanges();

      // Enrich with Steam prices in background (non-blocking)
      if (gameList.length) {
        setTimeout(() => {
          const enrichCalls = gameList.map((g: any) =>
            this.webService.getSteamDetails(g.appid).pipe(
              take(1),
              map((steamData: any) => {
                const priceOverview = steamData?.[g.appid]?.data?.price_overview || steamData?.data?.price_overview;
                return {
                  ...g,
                  price_overview: priceOverview || g.price_overview,
                  reviews: g.reviews
                };
              }),
              catchError(() => of(g))
            )
          );
          
          forkJoin(enrichCalls).pipe(take(1), catchError(() => of(gameList))).subscribe((enriched: any[]) => {
            this.topGames = enriched.map((g: any) => ({
              ...g,
              price: this.extractPrice(g)
            }));
            this.cdr.detectChanges();
          });
        }, 0);
      }
    });
  }

  loadValueGames() {
    this.webService.getValueForMoney(4).pipe(
      take(1),
      catchError(err => {
        console.error('[Home] Failed to load value games:', err);
        return of([]);
      })
    ).subscribe(games => {
      const gameList = Array.isArray(games) ? games : (games?.data || []);
      const paidGames = gameList.filter((g: any) => this.extractPrice(g) > 0);
      const gamesToShow = paidGames.length ? paidGames.slice(0, 4) : gameList.slice(0, 4);
      
      // Show data immediately (instant)
      this.valueGames = gamesToShow.map((g: any) => ({
        ...g,
        price: this.extractPrice(g),
        name: g.name,
        appid: g.appid,
        value_score: g.value_score,
        positive_ratio: g.positive_ratio
      }));
      this.cdr.detectChanges();

      // Enrich with Steam prices in background (non-blocking)
      if (gamesToShow.length) {
        setTimeout(() => {
          const enrichCalls = gamesToShow.map((g: any) =>
            this.webService.getSteamDetails(g.appid).pipe(
              take(1),
              map((steamData: any) => {
                const priceOverview = steamData?.[g.appid]?.data?.price_overview || steamData?.data?.price_overview;
                return { ...g, price_overview: priceOverview || g.price_overview };
              }),
              catchError(() => of(g))
            )
          );

          forkJoin(enrichCalls).pipe(take(1), catchError(() => of(gamesToShow))).subscribe((enriched: any[]) => {
            this.valueGames = enriched.map((g: any) => ({
              ...g,
              price: this.extractPrice(g),
              name: g.name,
              appid: g.appid,
              value_score: g.value_score,
              positive_ratio: g.positive_ratio
            }));
            this.cdr.detectChanges();
          });
        }, 0);
      }
    });
  }

  loadSentimentBreakdown() {
    this.webService.getSentimentBreakdown(4).pipe(
      take(1),
      catchError(err => {
        console.error('[Home] Failed to load sentiment:', err);
        return of([]);
      })
    ).subscribe(games => {
      const gameList = Array.isArray(games) ? games : (games?.data || []);
      
      // Show data immediately (instant)
      this.sentimentGames = gameList.map((g: any) => ({
        ...g,
        price: this.extractPrice(g)
      }));
      this.cdr.detectChanges();

      // Enrich with Steam prices in background (non-blocking)
      if (gameList.length) {
        setTimeout(() => {
          const enrichCalls = gameList.map((g: any) =>
            this.webService.getSteamDetails(g.appid).pipe(
              take(1),
              map((steamData: any) => {
                const priceOverview = steamData?.[g.appid]?.data?.price_overview || steamData?.data?.price_overview;
                return {
                  ...g,
                  price_overview: priceOverview || g.price_overview
                };
              }),
              catchError(() => of(g))
            )
          );
          
          forkJoin(enrichCalls).pipe(take(1), catchError(() => of(gameList))).subscribe((enriched: any[]) => {
            this.sentimentGames = enriched.map((g: any) => ({
              ...g,
              price: this.extractPrice(g)
            }));
            this.cdr.detectChanges();
          });
        }, 0);
      }
    });
  }

  search() {
    if (this.searchQuery.trim()) {
      this.router.navigate(['/games'], { queryParams: { name: this.searchQuery, page: 1 } });
    }
  }

  browseTopRated() {
    this.router.navigate(['/games'], { queryParams: { page: 1, sortBy: 'topRated' } });
  }

  browseValueGames() {
    this.router.navigate(['/games'], { queryParams: { page: 1, sortBy: 'value' } });
  }

  browseSentimentGames() {
    this.router.navigate(['/games'], { queryParams: { page: 1, sortBy: 'sentiment' } });
  }

  browseAllGames() {
    this.router.navigate(['/games'], { queryParams: { page: 1 } });
  }

  navigateToGame(appid: number) {
    this.router.navigate(['/games', appid]);
  }

  getRatingPercent(rating: number): number {
    if (rating == null || Number.isNaN(rating)) {
      return 0;
    }
    const percent = rating <= 5 ? rating * 20 : rating;
    return Math.max(0, Math.min(100, Math.round(percent)));
  }

  onImageError(event: any, appid: number) {
    const img = event.target as HTMLImageElement;
    const currentSrc = img.src;
    
    // Try only 2 fallbacks to avoid slow page loads
    if (currentSrc.includes('cloudflare.steamstatic.com') && currentSrc.includes('/capsule_184x69.jpg')) {
      // Try Akamai CDN
      img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_184x69.jpg`;
    } else if (currentSrc.includes('akamai.steamstatic.com')) {
      // Try header image as last resort
      img.src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;
    } else {
      // Final fallback to placeholder with game ID
      img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="184" height="69"%3E%3Crect width="184" height="69" fill="%23333"/%3E%3Ctext x="50%25" y="35%25" fill="%23999" font-family="Arial" font-size="10" text-anchor="middle" dy=".3em"%3ENo Image%3C/text%3E%3Ctext x="50%25" y="65%25" fill="%23666" font-family="Arial" font-size="8" text-anchor="middle" dy=".3em"%3EID: ' + appid + '%3C/text%3E%3C/svg%3E';
      img.style.opacity = '0.6';
    }
  }
}
