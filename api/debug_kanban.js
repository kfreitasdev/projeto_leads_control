export default async function handler(req, res) {
  const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || 'https://contact.glowryia.com').replace(/\/$/, '');
  const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || 'MVLHjvbssUzkX1WE24ToyBbA';
  const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '2';
  const KANBAN_BOARD_ID = '4';

  const headers = { 
    'Content-Type': 'application/json',
    'api_access_token': CHATWOOT_API_TOKEN 
  };

  const routesToTest = [
    `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks`,
    `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/extensions/kanban/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks`,
    `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_tasks`,
    `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks?page=1`
  ];

  const results = [];
  for (const url of routesToTest) {
    try {
      const resp = await fetch(url, { headers });
      const contentType = resp.headers.get('content-type') || '';
      let body = '[Could not parse]';
      if (contentType.includes('application/json')) {
        body = await resp.json();
      } else {
        body = `HTML/Text Error: ${resp.status}`;
      }
      results.push({ url, status: resp.status, type: contentType, data: body });
    } catch (e) {
      results.push({ url, error: e.message });
    }
  }

  return res.status(200).json(results);
}
