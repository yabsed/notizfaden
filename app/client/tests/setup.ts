import { request, type FullConfig } from '@playwright/test';

export default async function setup(config: FullConfig) {
  for (const url of [config.projects[0].use.baseURL!, process.env.NOTIZFADEN_PREVIEW_URL || 'http://localhost:5176']) {
    const client = await request.newContext({ baseURL: url });
    try {
      const response = await client.get('/api/health');
      if (!response.ok() || (await response.json()).testDatabase !== true) {
        throw new Error(`Refusing to run account-creating tests at ${url}: the API must use a database ending in _test. Run npm run test:env.`);
      }
    } finally { await client.dispose(); }
  }
}
