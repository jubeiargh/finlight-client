import { Article } from '../types';

/**
 * Transforms raw article data from API/WebSocket to properly typed Article object
 * Converts string dates to Date objects and string confidence values to numbers
 */
export function transformArticle(rawArticle: any): Article {
  const article = { ...rawArticle };

  // Convert publishDate string to Date object
  if (article.publishDate) {
    article.publishDate = new Date(article.publishDate);
  }

  // Convert company confidence from string to number if present
  if (article.companies && Array.isArray(article.companies)) {
    article.companies = article.companies.map((company: any) => ({
      ...company,
      confidence: company.confidence ? parseFloat(company.confidence) : undefined,
    }));
  }

  // Convert article confidence from string to number if present
  if (article.confidence) {
    article.confidence = parseFloat(article.confidence);
  }

  return article as Article;
}

/**
 * Transforms an array of raw articles to properly typed Article objects
 */
export function transformArticles(rawArticles: any[]): Article[] {
  return rawArticles.map(transformArticle);
}
