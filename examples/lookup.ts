// Lookups: an article by id or link, companies, and the source catalog.
import { contentPresent, isFinlightApiError } from 'finlight-client';
import { createClient } from './client';

export async function main(link = 'https://www.reuters.com/markets/example'): Promise<void> {
  const client = createClient();
  try {
    const article = await client.articles.getByLink(link, { include: ['content'] });
    console.log(article.id, article.title);
    // content: absent = not requested or no plan access; null = no text exists.
    if (contentPresent(article))
      console.log(article.content === null ? 'no text' : article.content.slice(0, 200));
    const again = await client.articles.get(article.id);
    console.log(`same article: ${again.link === article.link}`);
  } catch (err) {
    // A 404 is an error, not an empty result. Articles from before the id rollout are reachable by link only.
    if (isFinlightApiError(err) && err.apiKind === 'not_found') console.log('not found');
    else throw err;
  }

  const [company] = await client.companies.search({ q: 'NVDA', mic: 'XNAS' });
  if (company) {
    const record = await client.companies.get(company.companyId);
    console.log(record.name, record.primaryListing?.ticker, record.sector);
  }
  const sources = await client.sources.list();
  console.log(`${sources.length} sources, first: ${sources[0]?.domain}`);
}

if (require.main === module) void main(process.argv[2]);
