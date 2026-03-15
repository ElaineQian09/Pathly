import type { NewsItem, SessionPreferences } from "../models/types.js";

type RssProvider = {
  getLatest(categories: SessionPreferences["newsCategories"]): Promise<NewsItem[]> | NewsItem[];
};

export class NewsService {
  constructor(private readonly rssProvider: RssProvider) {}

  async getCandidates(preferences: SessionPreferences): Promise<NewsItem[]> {
    return await this.rssProvider.getLatest(preferences.newsCategories);
  }
}
