import { MockRssProvider } from "./rss-provider.js";
import type { NewsCategory, NewsItem } from "../models/types.js";

const FEEDS: Record<NewsCategory, string[]> = {
  tech: [
    "https://techcrunch.com/feed/",
    "https://feeds.arstechnica.com/arstechnica/index"
  ],
  world: [
    "https://feeds.bbci.co.uk/news/world/rss.xml"
  ],
  sports: [
    "https://www.espn.com/espn/rss/news"
  ]
};

const extractItems = (xml: string) => {
  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  return itemMatches.map((match) => match[1]);
};

const extractTag = (xmlFragment: string, tag: string) => {
  const match = xmlFragment.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
};

export class RealRssProvider {
  constructor(private readonly fallback: MockRssProvider) {}

  async getLatest(categories: NewsCategory[]): Promise<NewsItem[]> {
    try {
      const results = await Promise.all(
        categories.map(async (category) => {
          const responses = await Promise.all(
            (FEEDS[category] ?? []).map(async (url) => {
              const response = await fetch(url, {
                headers: {
                  "user-agent": "Pathly/0.1"
                }
              });
              return response.ok ? response.text() : "";
            })
          );

          const parsed = responses
            .flatMap((xml) => extractItems(xml))
            .slice(0, 4)
            .map((item, index) => ({
              id: `${category}_${index}_${extractTag(item, "guid") || extractTag(item, "link")}`,
              category,
              headline: extractTag(item, "title"),
              summary: extractTag(item, "description").replace(/<[^>]+>/g, "").slice(0, 220),
              source: category === "tech" ? "tech_feed" : category === "world" ? "world_feed" : "sports_feed",
              publishedAt: extractTag(item, "pubDate") ? new Date(extractTag(item, "pubDate")).toISOString() : new Date().toISOString()
            }))
            .filter((item) => item.headline);

          const deduped = new Map<string, NewsItem>();
          for (const item of parsed) {
            const key = item.headline.toLowerCase();
            if (!deduped.has(key)) {
              deduped.set(key, item);
            }
          }
          return [...deduped.values()].slice(0, 2);
        })
      );

      const flattened = results.flat();
      return flattened.length > 0 ? flattened : this.fallback.getLatest(categories);
    } catch {
      return this.fallback.getLatest(categories);
    }
  }
}
