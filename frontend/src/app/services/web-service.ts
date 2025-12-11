import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { map, tap, catchError } from 'rxjs/operators';
import { BehaviorSubject, throwError } from 'rxjs';


@Injectable({
  providedIn: 'root',
})
export class WebService {
  pageSize = 10;
  public API_BASE = 'http://localhost:5000/api/v1.0';

  private tokenKey = 'jwt_token';
  private tokenSubject = new BehaviorSubject<boolean>(false);
  token$ = this.tokenSubject.asObservable();
  private currentUsername: string | null = null;
  private currentRole: string | null = null;

  constructor(private http: HttpClient) {
    this.initTokenState();
  }

  // --- Auth helpers ---
  public initTokenState() {
    const stored = this.getToken();
    if (stored) {
      // Check if token is expired
      if (this.isTokenExpired(stored)) {
        console.warn('[Auth] Token has expired, clearing');
        this.clearToken();
        this.tokenSubject.next(false);
        return;
      }
      
      this.tokenSubject.next(true);
      // Decode JWT to get username and role (basic decode, no verification)
      try {
        const payload = JSON.parse(atob(stored.split('.')[1]));
        this.currentUsername = payload.username;
        this.currentRole = payload.role;
      } catch (e) {
        this.currentUsername = null;
        this.currentRole = null;
      }
    } else {
      this.tokenSubject.next(false);
    }
  }

  // Check if JWT token is expired
  private isTokenExpired(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (!payload.exp) return false; // No expiration claim
      const expirationTime = payload.exp * 1000; // Convert to milliseconds
      return Date.now() > expirationTime;
    } catch (e) {
      console.error('[Auth] Failed to decode token for expiration check:', e);
      return true; // If we can't decode, treat as expired
    }
  }

  storeToken(token: string) {
    localStorage.setItem(this.tokenKey, token);
    this.tokenSubject.next(true);
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      this.currentUsername = payload.username;
      this.currentRole = payload.role;
      
      // Log expiration time for debugging
      if (payload.exp) {
        const expiresAt = new Date(payload.exp * 1000);
        console.log('[Auth] Token stored, expires at:', expiresAt);
      }
    } catch (e) {
      this.currentUsername = null;
      this.currentRole = null;
    }
  }

  getToken(): string | null {
    const token = localStorage.getItem(this.tokenKey);
    // Check if token is expired before returning
    if (token && this.isTokenExpired(token)) {
      console.warn('[Auth] Token expired, clearing');
      this.clearToken();
      return null;
    }
    return token;
  }

  getUsername(): string | null {
    return this.currentUsername;
  }

  getRole(): string | null {
    return this.currentRole;
  }

  isAdmin(): boolean {
    return this.currentRole === 'admin';
  }

  clearToken() {
    localStorage.removeItem(this.tokenKey);
    this.tokenSubject.next(false);
    this.currentUsername = null;
    this.currentRole = null;
  }

  // Validate token with backend (moves decoding logic to backend)
  validateToken() {
    const token = this.getToken();
    if (!token) {
      return;
    }

    return this.http.get<any>(`${this.API_BASE}/auth/validate`, { headers: this.authHeaders() }).pipe(
      tap(res => {
        if (res?.data?.valid) {
          this.currentUsername = res.data.username;
          this.currentRole = res.data.role;
        } else {
          this.clearToken();
        }
      }),
      catchError(err => {
        this.clearToken();
        return throwError(() => err);
      })
    ).subscribe();
  }

  // Get current user info from backend
  getCurrentUser() {
    return this.http.get<any>(`${this.API_BASE}/auth/me`, { headers: this.authHeaders() }).pipe(
      map(res => res?.data ?? res),
      catchError(err => this.handleHttpError(err))
    );
  }

  login(username: string, password: string) {
    const body = new FormData();
    body.append('username', username);
    body.append('password', password);
    return this.http.post<any>(`${this.API_BASE}/auth/login`, body).pipe(
      tap(res => {
        const token = res?.data?.token || res?.token;
        if (token) this.storeToken(token);
      })
    );
  }

  register(username: string, password: string, role: 'user' | 'admin' = 'user') {
    const body = new FormData();
    body.append('username', username);
    body.append('password', password);
    body.append('role', role);
    return this.http.post<any>(`${this.API_BASE}/auth/register`, body);
  }

  private authHeaders(): Record<string, string> {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {} as Record<string, string>;
  }

  // Handle HTTP errors (especially 401 Unauthorized)
  private handleHttpError(error: HttpErrorResponse) {
    if (error.status === 401) {
      console.warn('[Auth] Received 401 Unauthorized, clearing token');
      this.clearToken();
    } else if (error.status === 400) {
      console.error('[API] Bad Request (400):', error.error?.message || error.message);
    } else if (error.status === 404) {
      console.error('[API] Not Found (404):', error.error?.message || error.message);
    } else if (error.status === 500) {
      console.error('[API] Server Error (500):', error.error?.message || error.message);
    } else {
      console.error('[API] HTTP Error:', error.status, error.error?.message || error.message);
    }
    return throwError(() => error);
  }

  // Paginated games from backend with optional server-side sorting
  getGames(page: number, sortBy?: string) {
    console.log('Fetching games for page:', page, 'sortBy:', sortBy);
    let url = `${this.API_BASE}/games?pn=${page}&ps=${this.pageSize}`;
    if (sortBy) {
      url += `&sort=${sortBy}`;
    }
    return this.http.get<any>(url).pipe(
      map(res => {
        const pagination = res?.pagination;
        if (pagination) {
          res.total_pages = Math.ceil((pagination.total_results || 0) / (pagination.page_size || this.pageSize));
          // Expose pagination links from backend
          res.links = pagination.links || {};
        } else {
          res.total_pages = 1;
          res.links = {};
        }
        return res;
      })
    );
  }

  // Get sorted games (server-side sorting and pagination)
  getGamesSorted(page: number, sortBy: 'topRated' | 'value' | 'sentiment') {
    console.log('Fetching sorted games:', sortBy, 'page:', page);
    return this.http.get<any>(`${this.API_BASE}/games?pn=${page}&ps=${this.pageSize}&sort=${sortBy}`).pipe(
      map(res => {
        const pagination = res?.pagination;
        if (pagination) {
          res.total_pages = Math.ceil((pagination.total_results || 0) / (pagination.page_size || this.pageSize));
          res.links = pagination.links || {};
        } else {
          res.total_pages = 1;
          res.links = {};
        }
        return res;
      })
    );
  }

  // Single game from backend
  getGame(appid: number) {
    console.log('Fetching game details for appid:', appid);
    return this.http.get<any>(`${this.API_BASE}/games/${appid}`).pipe(
      map((res: any) => res?.data ?? res)
    );
  }

  // Get enriched game data (includes Steam details in one call)
  getEnrichedGame(appid: number) {
    console.log('Fetching enriched game details for appid:', appid);
    return this.http.get<any>(`${this.API_BASE}/games/${appid}/enriched`).pipe(
      map((res: any) => res?.data ?? res)
    );
  }

  // Backend proxy call for Steam store details (avoids client-side 403/CORS)
  getSteamDetails(appid: number) {
    // Steam proxy is mounted at /api/steam/<appid> (no /v1.0 prefix)
    const steamProxyBase = this.API_BASE.replace('/v1.0', '');
    return this.http.get<any>(`${steamProxyBase}/steam/${appid}`);
  }

  // Filtered games
  filterGames(params: any, page: number) {
    const query = new URLSearchParams({ ...params, pn: page, ps: this.pageSize }).toString();
    console.log('Filtering games with query:', query);
    return this.http.get<any>(`${this.API_BASE}/games/filter?${query}`).pipe(
      map(res => {
        const pagination = res?.pagination;
        if (pagination) {
          res.total_pages = Math.ceil((pagination.total_results || 0) / (pagination.page_size || this.pageSize));
          res.links = pagination.links || {};
        } else {
          res.total_pages = 1;
          res.links = {};
        }
        return res;
      })
    );
  }

  // Stats
  getGameStats() {
    return this.http.get<any>(`${this.API_BASE}/games/stats`);
  }

  // Get game with reviews in single call (more efficient)
  getGameWithReviews(appid: number) {
    return this.http.get<any>(`${this.API_BASE}/games/${appid}/with-reviews`, { headers: this.authHeaders() }).pipe(
      map(res => res?.data ?? res)
    );
  }

  // Public access to game with reviews (no auth headers)
  getGameWithReviewsPublic(appid: number) {
    return this.http.get<any>(`${this.API_BASE}/games/${appid}/with-reviews`).pipe(
      map(res => res?.data ?? res)
    );
  }

  // Get all reviews across all games (admin)
  getAllReviews(page: number = 1, pageSizeOverride?: number) {
    const ps = pageSizeOverride ?? this.pageSize;
    return this.http.get<any>(`${this.API_BASE}/games/reviews?pn=${page}&ps=${ps}`, { headers: this.authHeaders() }).pipe(
      map(res => {
        const pagination = res?.pagination;
        if (pagination) {
          res.total_pages = Math.ceil((pagination.total_results || 0) / (pagination.page_size || ps));
          res.links = pagination.links || {};
        } else {
          res.total_pages = 1;
          res.links = {};
        }
        return res;
      })
    );
  }

  // Public all-reviews (no auth headers)
  getAllReviewsPublic(page: number = 1, pageSizeOverride?: number) {
    const ps = pageSizeOverride ?? this.pageSize;
    return this.http.get<any>(`${this.API_BASE}/games/reviews?pn=${page}&ps=${ps}`).pipe(
      map(res => {
        const pagination = res?.pagination;
        if (pagination) {
          res.total_pages = Math.ceil((pagination.total_results || 0) / (pagination.page_size || ps));
          res.links = pagination.links || {};
        } else {
          res.total_pages = 1;
          res.links = {};
        }
        return res;
      })
    );
  }

  // Post a user review to backend
  postReview(appid: number, review: {
    username?: string;
    comment: string;
    rating: number;
  }) {
    const body = new FormData();
    // Use provided username, or fallback to logged-in username, or 'Anonymous'
    const displayName = review.username?.trim() || this.currentUsername || 'Anonymous';
    body.append('username', displayName);
    body.append('comment', review.comment);
    body.append('rating', String(review.rating));
    return this.http.post<any>(`${this.API_BASE}/games/${appid}/reviews`, body, { headers: this.authHeaders() }).pipe(
      catchError(err => this.handleHttpError(err))
    );
  }

  // Update a review
  updateReview(appid: number, reviewId: string, review: {
    comment: string;
    rating: number;
  }) {
    console.log('[WebService] Updating review:', { appid, reviewId, review });
    const body = new FormData();
    body.append('comment', review.comment);
    body.append('rating', String(review.rating));
    // Send review_id in both path and body for backward compatibility
    body.append('review_id', reviewId);
    
    // Log what we're sending
    console.log('[WebService] PUT body:', {
      comment: review.comment,
      rating: review.rating,
      review_id: reviewId
    });
    
    return this.http.put<any>(`${this.API_BASE}/games/${appid}/reviews/${reviewId}`, body, { headers: this.authHeaders() }).pipe(
      tap(res => console.log('[WebService] PUT response:', res)),
      catchError(err => this.handleHttpError(err))
    );
  }

  // Delete a review
  deleteReview(appid: number, reviewId: string) {
    return this.http.delete<any>(`${this.API_BASE}/games/${appid}/reviews/${reviewId}`, { headers: this.authHeaders() }).pipe(
      catchError(err => this.handleHttpError(err))
    );
  }

  // Get filtered and sorted reviews from backend
  getFilteredReviews(appid: number, filter: 'all' | 'positive' | 'negative' = 'all', sort: 'date' | 'rating' | 'username' = 'date') {
    return this.http.get<any>(`${this.API_BASE}/games/${appid}/reviews/filtered?filter=${filter}&sort=${sort}`).pipe(
      map(res => res?.data ?? res)
    );
  }

  // ============================================================
  // ADVANCED ANALYTICS ENDPOINTS
  // ============================================================

  // Get top games by metric (positive, metacritic_score, or peak_ccu)
  getTopGames(metric: 'positive' | 'metacritic_score' | 'peak_ccu' = 'positive', limit: number = 10) {
    return this.http.get<any>(`${this.API_BASE}/games/advanced/top?metric=${metric}&limit=${limit}`).pipe(
      map(res => res?.data ?? res)
    );
  }

  // Get sentiment breakdown for games
  getSentimentBreakdown(limit: number = 10) {
    return this.http.get<any>(`${this.API_BASE}/games/advanced/sentiment?limit=${limit}`).pipe(
      map(res => res?.data ?? res)
    );
  }

  // Get value for money games
  getValueForMoney(limit: number = 10) {
    return this.http.get<any>(`${this.API_BASE}/games/advanced/value?limit=${limit}`).pipe(
      map(res => res?.data ?? res)
    );
  }

  // Smart search with advanced filters
  smartSearch(params: {
    q?: string;
    developer?: string;
    genre?: string;
    tag?: string;
    price_min?: number;
    price_max?: number;
    metacritic_min?: number;
    sort?: string;
    order?: 'asc' | 'desc';
    page?: number;
  }) {
    const queryParams = new URLSearchParams();
    if (params.q) queryParams.append('q', params.q);
    if (params.developer) queryParams.append('developer', params.developer);
    if (params.genre) queryParams.append('genre', params.genre);
    if (params.tag) queryParams.append('tag', params.tag);
    if (params.price_min !== undefined) queryParams.append('price_min', String(params.price_min));
    if (params.price_max !== undefined) queryParams.append('price_max', String(params.price_max));
    if (params.metacritic_min !== undefined) queryParams.append('metacritic_min', String(params.metacritic_min));
    if (params.sort) queryParams.append('sort', params.sort);
    if (params.order) queryParams.append('order', params.order);
    queryParams.append('pn', String(params.page || 1));
    queryParams.append('ps', String(this.pageSize));

    return this.http.get<any>(`${this.API_BASE}/games/advanced/search?${queryParams.toString()}`).pipe(
      map(res => {
        const pagination = res?.pagination;
        if (pagination) {
          res.total_pages = Math.ceil((pagination.total_results || 0) / (pagination.page_size || this.pageSize));
          res.links = pagination.links || {};
        } else {
          res.total_pages = 1;
          res.links = {};
        }
        return res;
      })
    );
  }

  // Lorem ipsum helper (used for mock reviews)
  getLoremIpsum(paragraphs: number) {
    const API_key = 'tFyhHBPbX8foMBrm9cXZkw==AWPcQIS2IvKCh7Vt';
    return this.http.get<any>(
      'https://api.api-ninjas.com/v1/loremipsum?paragraphs=' + paragraphs,
      { headers: { 'X-Api-Key': API_key } }
    );
  }

  // ============================================================
  // DASHBOARD & STATISTICS ENDPOINTS (Backend-processed)
  // ============================================================

  // Get comprehensive dashboard statistics (single call)
  getDashboardStats() {
    return this.http.get<any>(`${this.API_BASE}/dashboard/stats`).pipe(
      map(res => res?.data ?? res)
    );
  }

  // Get recent reviews with automatic flattening and hour count
  getRecentReviews(limit: number = 6) {
    return this.http.get<any>(`${this.API_BASE}/reviews/recent?limit=${limit}`).pipe(
      map(res => res?.data ?? res)
    );
  }

  // Get enriched top games (with Steam data already included)
  getTopGamesEnriched(metric: 'positive' | 'metacritic_score' | 'peak_ccu' = 'positive', limit: number = 10) {
    return this.http.get<any>(`${this.API_BASE}/games/advanced/top-enriched?metric=${metric}&limit=${limit}`).pipe(
      map(res => res?.data ?? res)
    );
  }

  // Get review statistics for a game
  getReviewStats(appid: number) {
    return this.http.get<any>(`${this.API_BASE}/games/${appid}/reviews/stats`).pipe(
      map(res => res?.data ?? res)
    );
  }

  // Batch fetch Steam details for multiple games (single API call)
  getSteamDetailsBatch(appids: number[]) {
    return this.http.post<any>(`${this.API_BASE.replace('/v1.0', '')}/steam/batch`, { appids }).pipe(
      map(res => res ?? {})
    );
  }

  // Fetch from pagination link (HATEOAS)
  getFromLink(url: string) {
    return this.http.get<any>(url).pipe(
      map(res => {
        const pagination = res?.pagination;
        if (pagination) {
          res.total_pages = Math.ceil((pagination.total_results || 0) / (pagination.page_size || this.pageSize));
          res.links = pagination.links || {};
        } else {
          res.total_pages = 1;
          res.links = {};
        }
        return res;
      })
    );
  }

  // Admin: Get all reviews with server-side search
  getAdminReviews(page: number = 1, perPage: number = 20, search: string = '') {
    let url = `${this.API_BASE}/admin/reviews?page=${page}&per_page=${perPage}`;
    if (search) {
      url += `&search=${encodeURIComponent(search)}`;
    }
    return this.http.get<any>(url, { headers: this.authHeaders() }).pipe(
      map(res => res?.data ?? res),
      catchError(err => this.handleHttpError(err))
    );
  }

  // ============================================================
  // STEAM PROXY ENDPOINTS (Additional)
  // ============================================================

  // Get Steam screenshots
  getSteamScreenshots(appid: number) {
    const steamProxyBase = this.API_BASE.replace('/v1.0', '');
    return this.http.get<any>(`${steamProxyBase}/steam/${appid}/screenshots`).pipe(
      map(res => res ?? {})
    );
  }

  // Get Steam trailers
  getSteamTrailers(appid: number) {
    const steamProxyBase = this.API_BASE.replace('/v1.0', '');
    return this.http.get<any>(`${steamProxyBase}/steam/${appid}/trailers`).pipe(
      map(res => res ?? {})
    );
  }

  // Get Steam achievements
  getSteamAchievements(appid: number) {
    const steamProxyBase = this.API_BASE.replace('/v1.0', '');
    return this.http.get<any>(`${steamProxyBase}/steam/${appid}/achievements`).pipe(
      map(res => res ?? {})
    );
  }

  // Get Steam achievement percentages
  getSteamAchievementPercentages(appid: number) {
    const steamProxyBase = this.API_BASE.replace('/v1.0', '');
    return this.http.get<any>(`${steamProxyBase}/steam/${appid}/achievement-percentages`).pipe(
      map(res => res ?? {})
    );
  }

  // Search Steam store
  searchSteam(query: string) {
    const steamProxyBase = this.API_BASE.replace('/v1.0', '');
    return this.http.get<any>(`${steamProxyBase}/steam/search?q=${encodeURIComponent(query)}`).pipe(
      map(res => res ?? {})
    );
  }

  // Get all image URLs for a game
  getSteamImages(appid: number) {
    const steamProxyBase = this.API_BASE.replace('/v1.0', '');
    return this.http.get<any>(`${steamProxyBase}/steam/${appid}/images`).pipe(
      map(res => res ?? {})
    );
  }

  // Steam image URL helpers
  getSteamHeaderImage(appid: number): string {
    return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;
  }

  getSteamCapsuleImage(appid: number): string {
    return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`;
  }

  // ============================================================
  // DEVELOPERS ENDPOINTS
  // ============================================================


  // Get all unique developers with their games (admin)
  getDevelopers() {
    return this.http.get<any>(`${this.API_BASE}/games/developers`, { headers: this.authHeaders() }).pipe(
      map(res => res?.data ?? res),
      catchError(err => this.handleHttpError(err))
    );
  }

  // Rename a developer (admin)
  renameDeveloper(oldName: string, newName: string) {
    return this.http.post<any>(`${this.API_BASE}/games/developers/rename`, { old_name: oldName, new_name: newName }, { headers: this.authHeaders() }).pipe(
      map(res => res?.data ?? res),
      catchError(err => this.handleHttpError(err))
    );
  }

  // Delete a developer (admin)
  deleteDeveloper(name: string) {
    return this.http.post<any>(`${this.API_BASE}/games/developers/delete`, { name }, { headers: this.authHeaders() }).pipe(
      map(res => res?.data ?? res),
      catchError(err => this.handleHttpError(err))
    );
  }

  // Get developer/publisher info for a specific game
  getGameDevelopers(appid: number) {
    return this.http.get<any>(`${this.API_BASE}/games/${appid}/developers`).pipe(
      map(res => res?.data ?? res),
      catchError(err => this.handleHttpError(err))
    );
  }

  // ============================================================
  // ADMIN LOGS ENDPOINT (Audit Trail)
  // ============================================================

  // Get admin logs (audit trail) - admin only
  getAdminLogs(page: number = 1) {
    return this.http.get<any>(`${this.API_BASE}/admin/logs?pn=${page}&ps=${this.pageSize}`, { headers: this.authHeaders() }).pipe(
      map(res => {
        const pagination = res?.pagination;
        if (pagination) {
          res.total_pages = Math.ceil((pagination.total_results || 0) / (pagination.page_size || this.pageSize));
          res.links = pagination.links || {};
        } else {
          res.total_pages = 1;
          res.links = {};
        }
        return res;
      }),
      catchError(err => this.handleHttpError(err))
    );
  }

  // ============================================================
  // GAME CRUD OPERATIONS (Admin)
  // ============================================================

  // Create a new game (admin only)
  createGame(gameData: any) {
    const body = new FormData();
    // Required top-level fields
    body.append('appid', String(gameData.appid));
    body.append('name', gameData.name);
    body.append('release_date', gameData.release_date || '');
    body.append('price', String(gameData.price));
    // Metadata fields (as JSON strings)
    body.append('developers', JSON.stringify(gameData.developers || []));
    body.append('publishers', JSON.stringify(gameData.publishers || []));
    body.append('genres', JSON.stringify(gameData.genres || []));
    body.append('tags', JSON.stringify(gameData.tags || []));
    body.append('supported_languages', JSON.stringify(gameData.supported_languages || []));
    // Optional fields
    if (gameData.short_description) body.append('short_description', gameData.short_description);
    if (gameData.peak_ccu) body.append('peak_ccu', String(gameData.peak_ccu));
    return this.http.post<any>(`${this.API_BASE}/games`, body, { headers: this.authHeaders() }).pipe(
      map(res => res?.data ?? res),
      catchError(err => this.handleHttpError(err))
    );
  }

  // Update an existing game (admin only)
  updateGame(appid: number, gameData: any) {
    const body = new FormData();
    // Add all game fields to FormData
    Object.keys(gameData).forEach(key => {
      if (gameData[key] !== null && gameData[key] !== undefined) {
        body.append(key, typeof gameData[key] === 'object' ? JSON.stringify(gameData[key]) : String(gameData[key]));
      }
    });
    
    return this.http.put<any>(`${this.API_BASE}/games/${appid}`, body, { headers: this.authHeaders() }).pipe(
      map(res => res?.data ?? res),
      catchError(err => this.handleHttpError(err))
    );
  }

  // Delete a game (admin only)
  deleteGame(appid: number) {
    return this.http.delete<any>(`${this.API_BASE}/games/${appid}`, { headers: this.authHeaders() }).pipe(
      map(res => res?.data ?? res),
      catchError(err => this.handleHttpError(err))
    );
  }

  // =============================
  // MISC ANALYTICS ENDPOINTS
  // =============================

  // Get all misc game entries (with optional page)
  getMiscGames(page: number = 1) {
    return this.http.get<any>(`${this.API_BASE}/games/misc?pn=${page}`, { headers: this.authHeaders() }).pipe(
      catchError(err => this.handleHttpError(err))
    );
  }


  // Add or update misc fields for a game (admin only)
  setMiscFields(appid: number, miscData: any) {
    const body = new FormData();
    // Add all misc fields
    body.append('supported_languages', JSON.stringify(miscData.supported_languages || []));
    body.append('genres', JSON.stringify(miscData.genres || []));
    body.append('tags', JSON.stringify(miscData.tags || []));
    body.append('peak_ccu', String(miscData.peak_ccu || 0));
    body.append('publishers', JSON.stringify(miscData.publishers || []));
    // Add core fields if present
    if (miscData.appid !== undefined) body.append('appid', String(miscData.appid));
    if (miscData.name !== undefined) body.append('name', miscData.name);
    if (miscData.developers !== undefined) body.append('developers', JSON.stringify(miscData.developers));
    if (miscData.publishers !== undefined) body.append('publishers', JSON.stringify(miscData.publishers));

    // Debug: log FormData contents
    const debugObj: any = {};
    body.forEach((value, key) => {
      debugObj[key] = value;
    });
    console.log('[WebService] setMiscFields sending (PUT):', debugObj);

    return this.http.put<any>(`${this.API_BASE}/games/misc/${appid}`, body, { headers: this.authHeaders() }).pipe(
      map(res => res?.data ?? res),
      catchError(err => this.handleHttpError(err))
    );
  }
}
