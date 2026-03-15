import type { NewsCategory, NewsItem } from "../models/types.js";

export class MockRssProvider {
  getLatest(categories: NewsCategory[]): NewsItem[] {
    const now = new Date().toISOString();
    const catalog: Record<NewsCategory, NewsItem> = {
      tech: {
        id: "news_tech_1",
        category: "tech",
        headline: "AI assistants are moving toward tighter real-time orchestration",
        summary: "Teams are shifting from chat-only responses toward structured live coordination flows.",
        source: "TechCrunch",
        publishedAt: now
      },
      world: {
        id: "news_world_1",
        category: "world",
        headline: "Cities are expanding car-light waterfront projects",
        summary: "Urban planners continue to prioritize pedestrian-first corridors and public access.",
        source: "BBC World",
        publishedAt: now
      },
      sports: {
        id: "news_sports_1",
        category: "sports",
        headline: "Endurance coaching keeps leaning into pacing consistency",
        summary: "Training conversations are emphasizing sustainable effort and smoother pacing decisions.",
        source: "ESPN",
        publishedAt: now
      }
    };
    return categories.map((category) => catalog[category]);
  }
}
