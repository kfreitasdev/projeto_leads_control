export default async function handler(req, res) {
  const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || 'https://contact.glowryia.com').replace(/\/$/, '');
  const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || 'MVLHjvbssUzkX1WE24ToyBbA';
  
  const headers = { 
    'Content-Type': 'application/json',
    'api_access_token': CHATWOOT_API_TOKEN 
  };

  const results = [];
  // Testa Account 1 e 2
  for (const accId of ['1', '2']) {
    const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${accId}/kanban_boards/4/kanban_tasks`;
    try {
      const resp = await fetch(url, { headers });
      results.push({ account: accId, url, status: resp.status });
    } catch (e) {
      results.push({ account: accId, error: e.message });
    }
  }

  return res.status(200).json(results);
}
