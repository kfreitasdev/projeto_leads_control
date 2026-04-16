export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, phone, summary, qualification } = req.body;

  if (!name || !phone || !qualification) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL || 'https://contact.glowryia.com/';
  const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
  const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '2';
  const INBOX_ID = process.env.INBOX_ID || '23';

  const headers = {
    'Content-Type': 'application/json',
    'api_access_token': CHATWOOT_API_TOKEN
  };

  try {
    let contactId = null;

    const searchRes = await fetch(
      `${CHATWOOT_BASE_URL}api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(phone)}`,
      { headers }
    );

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.payload && searchData.payload.length > 0) {
        contactId = searchData.payload[0].id;
      }
    }

    if (!contactId) {
      const createContactRes = await fetch(
        `${CHATWOOT_BASE_URL}api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: name,
            phone_number: phone
          })
        }
      );

      if (!createContactRes.ok) {
        const err = await createContactRes.text();
        return res.status(500).json({ error: 'Failed to create contact', details: err });
      }

      const contactData = await createContactRes.json();
      contactId = contactData.payload.id;
    }

    const conversationRes = await fetch(
      `${CHATWOOT_BASE_URL}api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          inbox_id: INBOX_ID,
          contact_id: contactId,
          source_id: phone
        })
      }
    );

    if (!conversationRes.ok) {
      const err = await conversationRes.text();
      return res.status(500).json({ error: 'Failed to create conversation', details: err });
    }

    const conversationData = await conversationRes.json();
    const conversationId = conversationData.payload.id;

    if (summary) {
      await fetch(
        `${CHATWOOT_BASE_URL}api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            content: summary,
            private: true
          })
        }
      );
    }

    await fetch(
      `${CHATWOOT_BASE_URL}api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/labels`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          labels: [qualification]
        })
      }
    );

    return res.status(200).json({
      success: true,
      contact_id: contactId,
      conversation_id: conversationId
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}