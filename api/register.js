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

  // ── Env vars (sem fallback de token) ──
  const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || '').replace(/\/$/, '');
  const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
  const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '2';
  const INBOX_ID = process.env.INBOX_ID || '25';

  if (!CHATWOOT_BASE_URL || !CHATWOOT_API_TOKEN) {
    console.error('Missing CHATWOOT_BASE_URL or CHATWOOT_API_TOKEN env vars');
    return res.status(500).json({ error: 'Server misconfigured: missing Chatwoot credentials' });
  }

  // ── Validação de entrada ──
  const { name, phone, summary } = req.body || {};

  if (!name || !phone) {
    return res.status(400).json({ error: 'Missing required fields: name, phone' });
  }

  // Validação E.164 (ex: +5511999999999)
  const e164Regex = /^\+[1-9]\d{6,14}$/;
  if (!e164Regex.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone format. Use E.164 (e.g. +5511999999999)' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'api_access_token': CHATWOOT_API_TOKEN
  };

  try {
    // ── Step 1: Buscar contato por telefone ──
    let contactId = null;

    const searchUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(phone)}`;
    const searchRes = await fetch(searchUrl, { headers });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.payload?.length > 0) {
        contactId = searchData.payload[0].id;
      }
    }

    // ── Step 2: Criar contato se não existe ──
    if (!contactId) {
      const createContactRes = await fetch(
        `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`,
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
        const errText = await createContactRes.text();
        console.error(`Contact creation failed [${createContactRes.status}]:`, errText);
        return res.status(500).json({ error: 'Failed to create contact' });
      }

      const contactData = await createContactRes.json();
      contactId = contactData.payload?.contact?.id || contactData.payload?.id;

      if (!contactId) {
        console.error('No contact ID in response');
        return res.status(500).json({ error: 'Failed to get contact ID from response' });
      }
    }

    // ── Step 3: Criar conversa no inbox ──
    const conversationRes = await fetch(
      `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          inbox_id: Number(INBOX_ID),
          contact_id: Number(contactId)
        })
      }
    );

    if (!conversationRes.ok) {
      const errText = await conversationRes.text();
      console.error(`Conversation creation failed [${conversationRes.status}]:`, errText);
      return res.status(500).json({ error: 'Failed to create conversation' });
    }

    const conversationData = await conversationRes.json();
    const conversationId = conversationData.payload?.id || conversationData.id;

    if (!conversationId) {
      console.error('No conversation ID in response');
      return res.status(500).json({ error: 'Failed to get conversation ID' });
    }

    // ── Step 4: Inserir nota privada (com tratamento de erro) ──
    let noteAdded = false;
    if (summary) {
      const noteRes = await fetch(
        `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            content: `📞 ${summary}`,
            private: true
          })
        }
      );
      noteAdded = noteRes.ok;
      if (!noteRes.ok) {
        console.error(`Note creation failed [${noteRes.status}]`);
      }
    }

    // ── Labels removidas. ──

    // ── Step 5: Atualizar Kanban Task (Opcional) ──
    const KANBAN_BOARD_ID = process.env.KANBAN_BOARD_ID;
    let kanbanUpdated = false;

    if (KANBAN_BOARD_ID && summary) {
      console.log('[Kanban] Iniciando processo de atualização...');
      
      // Tentativa isolada para não quebrar o fluxo principal
      try {
        // Delay mínimo para garantir que o card foi criado pela automação do Chatwoot
        await new Promise(r => setTimeout(r, 800));

        const tasksRes = await fetch(
          `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks?conversation_id=${conversationId}`,
          { headers }
        );

        if (tasksRes.ok) {
          const tasksData = await tasksRes.json();
          const tasksList = tasksData.payload || tasksData;
          
          if (Array.isArray(tasksList) && tasksList.length > 0) {
            const taskCardId = tasksList[0].id;
            console.log(`[Kanban] Card encontrado: ${taskCardId}. Atualizando...`);

            const updateRes = await fetch(
              `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks/${taskCardId}`,
              {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ description: `📝 Resumo do Lead:\n${summary}` })
              }
            );
            kanbanUpdated = updateRes.ok;
          } else {
            console.warn('[Kanban] Card não encontrado para a conversa:', conversationId);
          }
        }
      } catch (kanbanErr) {
        console.error('[Kanban] Erro silencioso (ignorado para não quebrar o lead):', kanbanErr.message);
      }
    }

    // ── Resposta de sucesso ──
    return res.status(200).json({
      success: true,
      contact_id: contactId,
      conversation_id: conversationId,
      note_added: noteAdded,
      kanban_updated: kanbanUpdated
    });

  } catch (error) {
    console.error('Unexpected error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}