export default async function handler(req, res) {
  const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || '').replace(/\/$/, '');
  const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
  const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '2';
  const KANBAN_BOARD_ID = '4';

  const headers = { 
    'Content-Type': 'application/json',
    'api_access_token': CHATWOOT_API_TOKEN 
  };

  try {
    const listRes = await fetch(
      `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks`,
      { headers }
    );
    
    const data = await listRes.json();
    return res.status(200).json({
      board_id: KANBAN_BOARD_ID,
      status: listRes.status,
      tasks_found: Array.isArray(data.payload || data) ? (data.payload || data).length : 'not_an_array',
      sample: (data.payload || data)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
