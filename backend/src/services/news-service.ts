import type {
  ContextSnapshot,
  ConversationTurnSummary,
  NewsItem,
  SessionPreferences
} from "../models/types.js";

type RssProvider = {
  getLatest(categories: SessionPreferences["newsCategories"]): Promise<NewsItem[]> | NewsItem[];
};

export class NewsService {
  constructor(private readonly rssProvider: RssProvider) {}

  async getCandidates(
    preferences: SessionPreferences,
    snapshot?: ContextSnapshot | null,
    conversationHistory: ConversationTurnSummary[] = []
  ): Promise<NewsItem[]> {
    const items = await this.rssProvider.getLatest(preferences.newsCategories);
    if (!snapshot) {
      return items;
    }

    const calmContext =
      !snapshot.nav.offRoute &&
      !snapshot.nav.approachingManeuver &&
      !snapshot.motion.isPaused &&
      snapshot.motion.currentSpeedMetersPerSecond >= 1.5;
    if (!calmContext) {
      return [];
    }

    const recentConversationText = conversationHistory
      .slice(-6)
      .map((entry) => entry.transcriptPreview.toLowerCase())
      .join(" ");
    const recentTerms = new Set(
      recentConversationText
        .split(/[^a-z0-9]+/i)
        .map((term) => term.trim())
        .filter((term) => term.length >= 5)
    );

    return items
      .filter((item) => {
        const headlineTerms = `${item.headline} ${item.summary}`
          .toLowerCase()
          .split(/[^a-z0-9]+/i)
          .map((term) => term.trim())
          .filter((term) => term.length >= 5);
        const overlappingTerms = headlineTerms.filter((term) => recentTerms.has(term));
        return overlappingTerms.length < 2;
      })
      .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  }
}
