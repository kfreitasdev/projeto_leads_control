export default async function handler(req, res) {
  const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || 'https://contact.glowryia.com').replace(/\/$/, '');
  const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || 'MVLHjvbssUzkX1WE24ToyBbA';
  const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '2';
  
  const headers = { 
    'Content-Type': 'application/json',
    'api_access_token': CHATWOOT_API_TOKEN 
  };

  const routesToTest = [
    // Padrões de Extensão fazer.ai
    `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/extensions/kanban/kanban_tasks`,
    `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/extensions/kanban/boards/4/tasks`,
    `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/fazer_ai/kanban/tasks`,
    `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban/boards/4/tasks`,
    `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban/tasks`,
    // Padrão do MCP Server (provável)
    `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/4/kanban_tasks`
  ];

  const results = [];
  for (const url of routesToTest) {
    try {
      const resp = await fetch(url, { headers });
      const contentType = resp.headers.get('content-type') || '';
      results.push({ url, status: resp.status, type: contentType });
    } catch (e) {
      results.push({ url, error: e.message });
    }
  }

  return res.status(200).json({
    diagnostics: results,
    hint: "Procure por qualquer status que NÃO seja 404."
  });
}
