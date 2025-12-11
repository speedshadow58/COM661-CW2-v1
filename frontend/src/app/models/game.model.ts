export interface Game {
  appid: number;
  name: string;
  release_date: string;
  price: number;
  developers: string[];
  publishers: string[];
  genres: string[];
  tags: string[];
  supported_languages: string[];
  short_description: string;
  peak_ccu: number;
  reviews: {
    positive: number;
    negative: number;
    num_reviews_total: number;
    metacritic_score: number;
    review_snippet: string;
  };
  review_score: number;
  media?: {
    screenshots: string[];
    movies: any[];
  };
}
