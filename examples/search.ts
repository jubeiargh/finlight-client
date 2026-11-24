// One page of search results.
import { companiesPresent, isFinlightApiError, toDate } from 'finlight-client';
import { createClient } from './client';

export async function main(): Promise<void> {
  const client = createClient();
  try {
    const page = await client.articles.search({
      query: 'ticker:NVDA',
      languages: ['en'],
      include: ['companies', 'events'],
      limit: 10,
    });
    for (const article of page.articles) {
      const published = toDate(article.publishedAt)?.toISOString() ?? 'unknown date';
      // Absent means "not requested or not in your plan", [] means "tagged, no company".
      const companies = companiesPresent(article)
        ? article.companies.map((c) => c.primaryListing?.ticker ?? c.name).join(', ')
        : 'not available';
      console.log(`${published} ${article.source.domain} ${article.title} [${companies}]`);
    }
    console.log(`more pages: ${page.pagination.hasMore}`);
  } catch (err) {
    if (isFinlightApiError(err)) {
      console.error(
        `API error ${err.status} ${err.code ?? ''}: ${err.detail ?? ''} (request ${err.requestId})`,
      );
      return;
    }
    throw err;
  }
}

if (require.main === module) void main();
