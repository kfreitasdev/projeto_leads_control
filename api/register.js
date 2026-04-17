export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || '').replace(/\/$/, '');
  const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
  const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '2';
  const INBOX_ID = process.env.INBOX_ID || '25';

  if (!CHATWOOT_BASE_URL || !CHATWOOT_API_TOKEN) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const { name, phone, summary } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'api_access_token': CHATWOOT_API_TOKEN
  };

  try {
    // 1. Search Contact
    let contactId = null;
    const searchRes = await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(phone)}`, { headers });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.payload?.length > 0) contactId = searchData.payload[0].id;
    }

    // 2. Create Contact if not exists
    if (!contactId) {
      const cRes = await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, phone_number: phone })
      });
      const cData = await cRes.json();
      contactId = cData.payload?.contact?.id || cData.payload?.id;
    }

    // 3. Create Conversation
    const convRes = await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inbox_id: Number(INBOX_ID), contact_id: Number(contactId) })
    });
    const convData = await convRes.json();
    const conversationId = convData.payload?.id || convData.id;

    // 4. Add Private Note (Summary)
    if (summary && conversationId) {
      await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: `📞 ${summary}`, private: true })
      });
    }

    // 5. Kanban Update (Silent & Resilient)
    const KANBAN_BOARD_ID = process.env.KANBAN_BOARD_ID;
    if (KANBAN_BOARD_ID && conversationId && summary) {
      // Don't await this if it might take too long, but in Vercel we should try-catch it
      try {
        // We wait just a bit for the automation to fire in Chatwoot
        setTimeout(async () => {
             const tRes = await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks?conversation_id=${conversationId}`, { headers });
             if (tRes.ok) {
               const tData = await tRes.json();
               const list = tData.payload || tData;
               if (list?.[0]?.id) {
                 await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks/${list[0].id}`, {
                   method: 'PATCH',
                   headers,
                   body: JSON.stringify({ description: `📝 Resumo do Lead:\n${summary}` })
                 });
               }
             }
        }, 1000); 
        // Note: setTimeout in Vercel Hobby might not finish if the handler returns, 
        // but it's better than blocking the main lead.
      } catch (e) { /* ignore kanban errors */ }
    }

    return res.status(200).json({ success: true, conversation_id: conversationId });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}