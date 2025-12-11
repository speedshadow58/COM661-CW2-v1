
import { Component, ChangeDetectorRef, OnDestroy, AfterViewInit, HostListener, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule, NgIf, NgFor, NgClass} from '@angular/common';
import { PlaytimeChartComponent } from './playtime-chart.component';
import { catchError, Observable, of, Subject, BehaviorSubject, timer } from 'rxjs';
import { map, takeUntil, retryWhen, delayWhen, tap } from 'rxjs/operators';
import { AuthService } from '@auth0/auth0-angular';
import { WebService } from '../../services/web-service';
import Hls from 'hls.js';

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, NgIf, NgFor, NgClass, PlaytimeChartComponent, RouterLink],
  templateUrl: './game.html',
  styleUrls: ['./game.css']
})
export class Game implements OnInit, OnDestroy, AfterViewInit {
    goToEditGame(appid: number) {
      // Navigate to admin game management and trigger edit form for this appid
      window.location.href = `/admin/games?edit=${appid}`;
    }
  isAdmin = false;

      // Prevent flicker: only set fallback once
      onImageError(event: Event) {
        const img = event.target as HTMLImageElement;
        if (!img.dataset['fallback']) {
          img.src = 'assets/not-available.svg';
          img.dataset['fallback'] = 'true';
        }
      }
    // Helper for template Math.min
    min(a: number, b: number): number {
      return Math.min(a, b);
    }
  appid!: number;

  private gameSubject = new BehaviorSubject<any>(null);
  game$ = this.gameSubject.asObservable();

  gameSummary: any = null;

  reviewForm: FormGroup;
  backendLoginForm: FormGroup;
  reviews: any[] = [];
  backendReviewsLoaded = false;
  backendReviewStats: any = null;
  backendAuthError: string | null = null;
  reviewPercentages: any = { positivePct: 0, negativePct: 0 };
  token$!: Observable<boolean>;
  editingReviewId: string | null = null;
  reviewSortBy: 'date' | 'rating' | 'username' = 'date';
  reviewFilter: 'all' | 'positive' | 'negative' = 'all';

  steamDetails: any;
  steamScreenshots: any[] = [];
  steamTrailer: any;
  currentSlide = 0;

  trailerPlaying = false;
  maxRetry = 5;
  retryCount = 0;

  selectedScreenshot: any = null;

  private destroy$ = new Subject<void>();

  // ----- Achievements state -----
  allAchievements: any[] = [];         // full achievement objects from ISteamUserStats
  achPerPage = 25;
  currentAchPage = 1;
  totalAchPages = 1;
  hoveredAchievement: any = null;

  constructor(
    private route: ActivatedRoute,
    private fb: FormBuilder,
    public auth: AuthService,
    private cdr: ChangeDetectorRef,
    private webService: WebService
  ) {
    this.token$ = this.webService.token$;
    this.reviewForm = this.fb.group({
      username: [''],
      comment: ['', Validators.required],
      rating: [0, [Validators.required, Validators.min(0), Validators.max(100)]]
    });

    this.backendLoginForm = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required]
    });
  }

  ngOnInit() {
      this.isAdmin = this.webService.isAdmin();
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.appid = +params['appid'];
      this.backendReviewsLoaded = false;  // Reset flag for new game
      this.loadGameData();  // Load game data
      this.loadReviewsData();  // Load reviews separately
      this.loadSteamData();
      this.loadLoremReviews();
    });
  }

  // -------------------------------------------------------------------------
  // ███ GAME DATA WITH RETRY
  // -------------------------------------------------------------------------
  loadGameData() {
    this.webService.getGame(this.appid).pipe(
      retryWhen(errors => errors.pipe(
        tap(err => console.warn('[Game] Retry due to error:', err)),
        delayWhen(() => timer(1000))
      )),
      catchError(err => {
        console.error('[Game] Failed to load game:', err);
        return of(null);
      }),
      takeUntil(this.destroy$)
    ).subscribe(game => {
      this.gameSubject.next(game);
      this.cdr.detectChanges();
    });
  }

  // -------------------------------------------------------------------------
  // ███ LOAD REVIEWS (from with-reviews endpoint)
  // -------------------------------------------------------------------------
  loadReviewsData(forceRefresh: boolean = false) {
    this.webService.getGameWithReviews(this.appid).pipe(
      catchError(err => {
        console.error('[Game] Failed to load reviews:', err);
        return of(null);
      }),
      takeUntil(this.destroy$)
    ).subscribe(game => {
      // Always update reviews when forceRefresh=true, or on first load
      if (game?.reviews && (forceRefresh || !this.backendReviewsLoaded)) {
        // Normalize and filter reviews from with-reviews endpoint
        let reviewsData = game.reviews;
        if (reviewsData?.list && Array.isArray(reviewsData.list)) {
          reviewsData.list = reviewsData.list
            .map((r: any) => {
              const cleanId = this.normalizeReviewId(r);
              return {
                ...r,
                _id: cleanId || r._id || r.id,
                source: 'backend'
              };
            })
            .filter((r: any) => r._id && r._id !== null && r._id !== 'null');
          
          console.log('[Review] Loaded', reviewsData.list.length, 'reviews from with-reviews endpoint');
        }
        
        this.backendReviewStats = reviewsData;
        this.backendReviewsLoaded = true;
        this.reviewPercentages = this.getReviewPercentages();
        this.cdr.detectChanges();
      }
    });
  }

  // -------------------------------------------------------------------------
  // ███ STEAM DATA WITH ACHIEVEMENTS
  // -------------------------------------------------------------------------
  loadSteamData() {
    this.webService.getSteamDetails(this.appid).pipe(
      catchError(err => { console.error('[Steam] Failed to load details:', err); return of(null); })
    ).subscribe(details => {
      const apiData = details?.[this.appid]?.data;
      if (!apiData) return;

      this.steamDetails = apiData;
      this.steamScreenshots = apiData.screenshots || [];
      this.steamTrailer = apiData.movies?.[0] || null;

      // Fetch achievements schema from ISteamUserStats (contains icons, descriptions)
      this.loadSteamAchievements();

      this.cdr.detectChanges();
      setTimeout(() => this.setupVideoPlayer(), 50);
    });
  }

  refreshSteamDetails() {
    console.log('[Steam] Manual refresh details');
    this.loadSteamData();
  }

  // -------------------------------------------------------------------------
  // ███ ACHIEVEMENTS: load, paging, helpers
  // -------------------------------------------------------------------------
  loadSteamAchievements() {
    console.log('[Achievements] Loading schema for appid', this.appid);

    // Step 1: Load the achievement schema (icons, names, descriptions)
    this.webService.getSteamAchievements(this.appid).pipe(
      catchError(err => {
        console.warn('[Achievements] Failed to fetch schema', err);
        return of(null);
      }),
      takeUntil(this.destroy$)
    ).subscribe((schemaRes: any) => {
      const schema = schemaRes?.game?.availableGameStats?.achievements || [];
      if (!schema.length) {
        console.warn('[Achievements] No achievements returned in schema.');
        this.allAchievements = [];
        this.updateAchievementPaging();
        this.cdr.detectChanges();
        return;
      }

      // Normalize schema
      this.allAchievements = schema.map((a: any) => ({
        name: a.name,
        displayName: a.displayName || a.name,
        description: a.description || '',
        icon: a.icon || null,
        icongray: a.icongray || null,
        hidden: a.hidden || false,
        rarity: null // will fill in next step
      }));

      // Step 2: Load global achievement percentages
      this.webService.getSteamAchievementPercentages(this.appid).pipe(
        catchError(err => {
          console.warn('[Achievements] Failed to fetch global percentages', err);
          return of(null);
        }),
        takeUntil(this.destroy$)
      ).subscribe((percentRes: any) => {
        const percentages: { name: string; percent: number }[] =
          (percentRes as any)?.achievementpercentages?.achievements || [];

        // Match each achievement by name
        this.allAchievements.forEach(a => {

          const pct = percentages.find(p => p.name === a.name);
          a.rarity = pct ? pct.percent : null;
        });

        console.log('[Achievements] Loaded', this.allAchievements.length, 'items with percentages');
        this.updateAchievementPaging();
        this.cdr.detectChanges();
      });
    });
  }



  updateAchievementPaging() {
    this.totalAchPages = Math.max(1, Math.ceil(this.allAchievements.length / this.achPerPage));
    if (this.currentAchPage > this.totalAchPages) this.currentAchPage = this.totalAchPages;
  }

  // getter used by template for current page results
  get pagedAchievements(): any[] {
    if (!this.allAchievements?.length) return [];
    this.updateAchievementPaging();
    const start = (this.currentAchPage - 1) * this.achPerPage;
    return this.allAchievements.slice(start, start + this.achPerPage);
  }

  prevAchPage() {
    if (this.currentAchPage > 1) {
      this.currentAchPage--;
    }
  }

  nextAchPage() {
    if (this.currentAchPage < this.totalAchPages) {
      this.currentAchPage++;
    }
  }

  // Hover handlers for tooltip
  hoverAchievement(ach: any) { this.hoveredAchievement = ach; }
  leaveAchievement() { this.hoveredAchievement = null; }

  // pick a bootstrap color class based on rarity (rarer -> gold/primary)
  getAchievementColor(ach: any): string {
    const rarity = Number(ach?.rarity ?? 100); // if null treat as common
    if (isNaN(rarity)) return 'secondary';
    if (rarity <= 5) return 'warning';   // very rare
    if (rarity <= 20) return 'primary';  // rare
    if (rarity <= 50) return 'success';  // uncommon
    return 'secondary';                  // common
  }

  // convenience getters for template compatibility
  get achievementsList(): any[] {
    return this.allAchievements || [];
  }

  get achievementsTotal(): number {
    return this.allAchievements?.length || 0;
  }

  getAchievementImage(ach: any): string {
    if (!ach || !ach.icon) return '';

    const icon = ach.icon.trim();
    // If it already looks like a full URL, use directly
    if (icon.startsWith('http://') || icon.startsWith('https://')) {
      return icon;
    }
    // Else build the Steam CDN URL
    return `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${this.appid}/${icon}`;
  }

  sortAchievements(criteria: 'rarity' | 'name') {
  if (!this.allAchievements?.length) return;

  if (criteria === 'rarity') {
    // Sort ascending: very rare first
    this.allAchievements.sort((a, b) => {
      const rA = a.rarity != null ? Number(a.rarity) : 100;
      const rB = b.rarity != null ? Number(b.rarity) : 100;
      return rA - rB;
    });
  } else if (criteria === 'name') {
    this.allAchievements.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
  }

  // reset to first page after sorting
  this.currentAchPage = 1;
  this.updateAchievementPaging();
  this.cdr.detectChanges();
}




  // -------------------------------------------------------------------------
  // ███ TRAILER PLAYBACK + RETRY
  // -------------------------------------------------------------------------
  refreshSteamTrailer() {
    console.log('[Trailer] Refreshing trailer URL…');

    this.webService.getSteamTrailers(this.appid).pipe(
      retryWhen(errors => errors.pipe(
        tap(err => console.warn('[Trailer] Retry fetching trailer:', err)),
        delayWhen(() => timer(2000))
      )),
      catchError(err => {
        console.error('[Trailer] Failed to refresh trailer:', err);
        return of(null);
      }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      const newTrailer = res?.[this.appid]?.data?.movies?.[0];
      if (!newTrailer) return;
      this.steamTrailer = newTrailer;
      this.cdr.detectChanges();
      setTimeout(() => this.setupVideoPlayer(), 50);
    });
  }

  playTrailer() {
    this.trailerPlaying = true;
    this.setupVideoPlayer();
  }

  setupVideoPlayer() {
    const video = document.getElementById('trailer') as HTMLVideoElement;
    if (!video || !this.steamTrailer) return;

    const hlsUrl = this.steamTrailer.hls_h264;
    if (!hlsUrl) return;

    if (Hls.isSupported()) {
      const hls = new Hls({ debug: true });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => { }));
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) this.refreshSteamTrailer();
      });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.play().catch(() => { });
    }

    video.onerror = () => this.refreshSteamTrailer();
  }

  handleVideoRetry() {
    if (this.retryCount < this.maxRetry) {
      this.retryCount++;
      console.warn(`[Trailer] Retry #${this.retryCount}`);
      this.refreshSteamTrailer();
      setTimeout(() => this.setupVideoPlayer(), 1000 * this.retryCount);
    } else {
      console.error('[Trailer] Max retries reached');
    }
  }

  ngAfterViewInit() { setTimeout(() => this.setupVideoPlayer(), 100); }

  // -------------------------------------------------------------------------
  // ███ REVIEWS + SCREENSHOTS
  // -------------------------------------------------------------------------
  loadLoremReviews() {
    const randomCount = Math.floor(Math.random() * 10) + 1;
    this.webService.getLoremIpsum(1).pipe(
      catchError(() => of('Lorem ipsum placeholder text.'))
    ).subscribe((response: any) => {
      let sentences: string[] = [];
      if (typeof response === 'string') sentences = response.split(/(?<=\.)\s+/);
      else if (response.text) sentences = response.text.split(/(?<=\.)\s+/);
      else sentences = ['Lorem ipsum placeholder text.'];

      sentences = sentences.slice(0, randomCount);
      this.reviews = sentences.map((text, i) => {
        const firstWord = text.split(/\s+/)[0].replace(/[^\w]/g, '');
        return {
          _id: `lorem-${i}`,
          source: 'lorem',
          username: firstWord || `User${i + 1}`,
          comment: text,
          rating: Math.floor(Math.random() * 101)
        };
      });

      // Update review percentages reactively
      this.reviewPercentages = this.getReviewPercentages();
      this.cdr.detectChanges();
    });
  }

  getAllReviews(): any[] {
    if (this.backendReviewStats?.list && Array.isArray(this.backendReviewStats.list)) {
      return [...this.backendReviewStats.list, ...this.reviews];
    }

    // Fallback for legacy aggregate-only data
    if (this.backendReviewStats?.review_snippet) {
      return [{
        _id: 'snippet',
        username: 'Recent reviewer',
        comment: this.backendReviewStats.review_snippet,
        rating: Math.round(Number(this.backendReviewStats.metacritic_score ?? 0))
      }, ...this.reviews];
    }

    // If no backend data, show placeholder lorem reviews
    return this.reviews;
  }

  getReviewPercentages() {
    const allReviews = this.getAllReviews();
    if (!allReviews.length) return { positivePct: 0, negativePct: 0 };
    
    const positive = allReviews.filter(r => r.rating >= 50).length;
    const negative = allReviews.filter(r => r.rating < 50).length;
    const total = positive + negative;
    
    const positivePct = Math.round((positive / total) * 100);
    const negativePct = Math.round((negative / total) * 100);
    
    // Ensure sum doesn't exceed 100% due to rounding
    const sum = positivePct + negativePct;
    if (sum > 100) {
      const diff = sum - 100;
      return {
        positivePct: Math.max(0, positivePct - diff),
        negativePct: negativePct
      };
    }
    return { positivePct, negativePct };
  }

  submitReview() {
    if (!this.reviewForm.valid) return;
    const payload = this.reviewForm.value;

    console.log('[Review] Submitting review:', payload);
    console.log('[Review] Token present:', !!this.webService.getToken());
    
    if (this.editingReviewId) {
      // Update existing review
      this.webService.updateReview(this.appid, this.editingReviewId, payload).pipe(
        catchError(err => {
          console.error('[Review] Failed to update review:', err);
          return of(null);
        })
      ).subscribe(res => {
        console.log('[Review] Update response:', res);
        if (res) {
          this.loadReviewsData(true);  // Force refresh reviews
          this.reviewForm.reset({ comment: '', rating: 0 });
          this.editingReviewId = null;
          this.cdr.detectChanges();
        }
      });
    } else {
      // Create new review
      // Optimistically add the review to the list immediately
      const newReview = {
        _id: `temp-${Date.now()}`,
        source: 'backend',
        username: this.webService.getUsername() || 'You',
        comment: payload.comment,
        rating: payload.rating,
        created_at: new Date().toISOString()
      };
      
      // Add to backend reviews list if it exists
      if (this.backendReviewStats?.list && Array.isArray(this.backendReviewStats.list)) {
        this.backendReviewStats.list.unshift(newReview);
      }
      
      // Update percentages immediately
      this.reviewPercentages = this.getReviewPercentages();
      this.reviewForm.reset({ comment: '', rating: 0 });
      this.cdr.detectChanges();
      
      // Then submit to backend
      this.webService.postReview(this.appid, payload).pipe(
        catchError(err => {
          console.error('[Review] Failed to submit review:', err);
          console.error('[Review] Error response:', err.error);
          return of(null);
        })
      ).subscribe(res => {
        console.log('[Review] Backend response:', res);
        if (res) {
          this.loadReviewsData(true);  // Force refresh reviews to replace temp ID
          this.cdr.detectChanges();
        } else {
          console.warn('[Review] No response from backend, review may not have persisted');
        }
      });
    }
  }

  editReview(review: any) {
    console.log('[Review] editReview CLICKED - full object:', JSON.stringify(review, null, 2));
    const reviewId = this.normalizeReviewId(review);
    console.log('[Review] Normalized reviewId:', reviewId);
    if (!reviewId || review?.source === 'lorem') {
      console.log('[Review] Edit blocked:', { reviewId, source: review?.source });
      return;
    }

    console.log('[Review] Enter edit mode for', reviewId, review);
    this.editingReviewId = reviewId;
    this.reviewForm.patchValue({
      comment: review.comment,
      rating: review.rating
    });

    // Scroll the form into view so the user sees edit mode
    const formCard = document.getElementById('review-form-card');
    if (formCard) formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    this.cdr.detectChanges();
  }

  deleteReview(review: any) {
    console.log('[Review] deleteReview CLICKED', review);
    if (!confirm('Delete this review?')) return;
    
    const reviewId = this.normalizeReviewId(review);
    console.log('[Review] Delete normalized reviewId:', reviewId);
    if (!reviewId || review?.source === 'lorem') return;
    this.webService.deleteReview(this.appid, reviewId).pipe(
      catchError(err => {
        console.error('[Review] Failed to delete:', err);
        return of(null);
      })
    ).subscribe(res => {
      if (res) {
        this.loadReviewsData(true);  // Force refresh reviews
        this.cdr.detectChanges();
      }
    });
  }

  cancelEdit() {
    this.editingReviewId = null;
    this.reviewForm.reset({ comment: '', rating: 0 });
  }

  canEditReview(review: any): boolean {
    const currentUser = this.webService.getUsername();
    const isAdmin = this.webService.isAdmin();
    console.log('[Review] canEditReview check:', { currentUser, reviewUser: review?.username, isAdmin, source: review?.source });
    if (review?.source === 'lorem') return false;
    // Admins can edit any review, users can only edit their own
    return !!currentUser && (isAdmin || currentUser === review.username);
  }

  canDeleteReview(review: any): boolean {
    const currentUser = this.webService.getUsername();
    const isAdmin = this.webService.isAdmin();
    if (review?.source === 'lorem') return false;
    // Admins can delete any review, users can only delete their own
    return !!currentUser && (isAdmin || currentUser === review.username);
  }

  getHeaderImage() { return this.webService.getSteamHeaderImage(this.appid); }
  getCapsuleImage() { return this.webService.getSteamCapsuleImage(this.appid); }

  prevSlide() { if (this.currentSlide > 0) this.currentSlide--; }
  nextSlide() { if (this.currentSlide < this.steamScreenshots.length - 1) this.currentSlide++; }
  getScreenshotCounter() { return `${this.currentSlide + 1} of ${this.steamScreenshots.length}`; }

  // -------------------------------------------------------------------------
  // ███ REVIEW SORTING, FILTERING + STATS
  // -------------------------------------------------------------------------
  sortReviews(criteria: 'rating' | 'date' | 'username') {
    this.reviewSortBy = criteria;
    this.cdr.detectChanges();
  }

  setReviewFilter(filter: 'all' | 'positive' | 'negative') {
    this.reviewFilter = filter;
    this.cdr.detectChanges();
  }

  getFilteredAndSortedReviews(): any[] {
    let reviews = this.getAllReviews();

    // Apply filter
    if (this.reviewFilter === 'positive') {
      reviews = reviews.filter(r => r.rating >= 50);
    } else if (this.reviewFilter === 'negative') {
      reviews = reviews.filter(r => r.rating < 50);
    }

    // Apply sort
    if (this.reviewSortBy === 'rating') {
      reviews.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (this.reviewSortBy === 'date') {
      reviews.sort((a, b) => {
        const dateA = new Date(a.created_at?.$date || a.created_at || 0).getTime();
        const dateB = new Date(b.created_at?.$date || b.created_at || 0).getTime();
        return dateB - dateA;
      });
    } else if (this.reviewSortBy === 'username') {
      reviews.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
    }

    return reviews;
  }

  getReviewStats() {
    const all = this.getAllReviews();
    const total = all.length;
    const positive = all.filter(r => r.rating >= 50).length;
    const negative = all.filter(r => r.rating < 50).length;
    const avgRating = total > 0 ? Math.round(all.reduce((sum, r) => sum + (r.rating || 0), 0) / total) : 0;
    
    return {
      total,
      positive,
      negative,
      avgRating,
      positivePct: total > 0 ? Math.round((positive / total) * 100) : 0,
      negativePct: total > 0 ? Math.round((negative / total) * 100) : 0
    };
  }

  openScreenshotModal(screenshot: any) { this.selectedScreenshot = screenshot; }
  closeScreenshotModal() { this.selectedScreenshot = null; }

  get trailerAvailable(): boolean {
    return !!(this.steamTrailer?.hls_h264 || this.steamTrailer?.dash_h264 || this.steamTrailer?.dash_av1);
  }
  get trailerFormatLabel(): string {
    if (this.steamTrailer?.hls_h264) return 'HLS (H.264)';
    if (this.steamTrailer?.dash_h264) return 'DASH (H.264)';
    if (this.steamTrailer?.dash_av1) return 'DASH (AV1)';
    return 'Not available';
  }
  get retryStatusLabel(): string {
    return this.retryCount > 0 ? `Retrying trailer (${this.retryCount}/${this.maxRetry})` : 'Trailer status: OK';
  }

  trackByScreenshot = (_: number, shot: any) => shot?.id || shot?.path_full || _;
  trackByReview = (_: number, r: any) => r?._id || r?.id || `${r.source || 'misc'}-${r.username}-${r.rating}-${_}`;

  private normalizeReviewId(review: any): string | undefined {
    if (!review) return undefined;
    // Handle stringified Mongo ObjectId formats like "{'$oid': '...'}"
    if (typeof review._id === 'string') {
      const match = review._id.match(/\$oid['"]?\s*[:=]\s*['"]?([a-fA-F0-9]{24})/);
      return match ? match[1] : review._id;
    }
    if (review._id?.$oid) return String(review._id.$oid);
    if (review.id?.$oid) return String(review.id.$oid);
    if (typeof review.id === 'string') {
      const match = review.id.match(/\$oid['"]?\s*[:=]\s*['"]?([a-fA-F0-9]{24})/);
      return match ? match[1] : review.id;
    }
    if (review._id) return String(review._id);
    if (review.id) return String(review.id);
    return undefined;
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent) {
    if (this.selectedScreenshot) {
      if (e.key === 'Escape') this.closeScreenshotModal();
      if (e.key === 'ArrowLeft') this.prevSlide();
      if (e.key === 'ArrowRight') this.nextSlide();
    } else {
      if (e.key === 'ArrowLeft') this.prevSlide();
      if (e.key === 'ArrowRight') this.nextSlide();
    }
  }

  calculateScore(summary: any): number {
    if (!summary) return 0;
    if (summary.average !== undefined) return Math.round(summary.average);
    const list = summary.list || [];
    if (!list.length) return 0;
    const total = list.reduce((acc: number, r: any) => acc + (r.rating || 0), 0);
    return Math.round(total / list.length);
  }

  // ---- Backend auth helpers ----
  get hasBackendToken() { return !!this.webService.getToken(); }

  loginBackend() {
    if (!this.backendLoginForm.valid) return;
    const { username, password } = this.backendLoginForm.value;
    this.backendAuthError = null;
    this.webService.login(username, password).pipe(
      catchError(err => {
        console.error('[Auth] Login failed', err);
        this.backendAuthError = err?.error?.error || 'Login failed';
        return of(null);
      }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      if (res) {
        this.backendAuthError = null;
        this.cdr.detectChanges();
      }
    });
  }

  logoutBackend() {
    this.webService.clearToken();
    this.backendAuthError = null;
    this.cdr.detectChanges();
  }

  formatReviewDate(date: any): string {
    if (!date) return '';
    
    const dateObj = new Date(date.$date || date);
    const now = new Date();
    const diffMs = now.getTime() - dateObj.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
