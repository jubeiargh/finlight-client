// Walk several pages with the cursor. Every page is a metered call.
import { createClient } from './client';

export async function main(): Promise<void> {
  const client = createClient();
  const result = client.articles.searchAll(
    { query: 'eventType:earnings', orderBy: 'publishedAt', order: 'desc', limit: 50 },
    { maxPages: 3 },
  );
  let count = 0;
  for await (const article of result) {
    count += 1;
    if (count <= 5) console.log(article.id, article.title);
  }
  console.log(`${count} articles from ${result.pagesFetched} pages`);
  if (result.truncated) console.log(`continue later with cursor ${result.nextCursor}`);
}

if (require.main === module) void main();
