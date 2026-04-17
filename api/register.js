export default async function handler(req, res) {
  console.log('[API] Handler invocado - Method:', req.method);

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

  console.log(`[API] Recebido lead: ${name} (${phone})`);

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

    // ── Passo Final: Atualizar Kanban Task (Opcional - Requer KANBAN_BOARD_ID) ──
    const KANBAN_BOARD_ID = process.env.KANBAN_BOARD_ID;
    let kanbanUpdated = false;

    if (KANBAN_BOARD_ID && summary) {
      console.log(`[Kanban] Board ID: ${KANBAN_BOARD_ID}. Iniciando busca por card da Conv #${conversationId}...`);
      
      const retryDelays = [3000, 3000, 4000]; // Delays entre tentativas (total 10s)
      
      for (let i = 0; i < retryDelays.length; i++) {
        try {
          console.log(`[Kanban] Tentativa ${i + 1} de ${retryDelays.length}... aguardando ${retryDelays[i]}ms`);
          await new Promise(resolve => setTimeout(resolve, retryDelays[i]));

          // Buscamos todas as tasks do board para encontrar a nossa
          const listUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks`;
          const listRes = await fetch(listUrl, { headers });
          
          if (!listRes.ok) {
            console.warn(`[Kanban] Falha ao listar tasks [${listRes.status}] na tentativa ${i + 1}`);
            continue;
          }

          const tasksData = await listRes.json();
          const tasksList = tasksData.payload || tasksData;

          if (Array.isArray(tasksList) && tasksList.length > 0 && i === 0) {
            // Logamos a estrutura da primeira task encontrada para debug (apenas na primeira tentativa)
            console.log('[Kanban] Debug - Estrutura da Task:', JSON.stringify({
              id: tasksList[0].id,
              title: tasksList[0].title,
              conv_id: tasksList[0].conversation_id,
              keys: Object.keys(tasksList[0])
            }));
          }

          // Estratégia 1: Busca por conversation_id
          let targetTask = Array.isArray(tasksList) 
            ? tasksList.find(t => String(t.conversation_id) === String(conversationId))
            : null;

          // Estratégia 2 (Fallback): Busca por Nome do Lead no Título
          if (!targetTask && Array.isArray(tasksList)) {
            console.log(`[Kanban] Task não achada por ID. Buscando por nome "${name}"...`);
            targetTask = tasksList.find(t => 
              t.title && t.title.toLowerCase().includes(name.toLowerCase())
            );
          }

          if (targetTask) {
            console.log(`[Kanban] Task encontrada! ID: ${targetTask.id} (${targetTask.title}). Atualizando...`);
            const updateRes = await fetch(
              `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks/${targetTask.id}`,
              {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                  description: `📝 Resumo de Lead:\n\n${summary}\n\n---\nEnvio via Babyland Hub`
                })
              }
            );

            if (updateRes.ok) {
              console.log(`[Kanban] Task ${targetTask.id} atualizada com sucesso.`);
              kanbanUpdated = true;
              break; // Sucesso! Sai do loop.
            } else {
              const errTxt = await updateRes.text();
              console.error(`[Kanban] Erro ao atualizar [${updateRes.status}]:`, errTxt);
            }
          } else {
            console.log(`[Kanban] Task ainda não encontrada para a conversa ${conversationId}.`);
          }
        } catch (err) {
          console.error(`[Kanban] Erro na tentativa ${i + 1}:`, err.message);
        }
      }

      if (!kanbanUpdated) {
        console.warn(`[Kanban] Não foi possível atualizar o card após ${retryDelays.length} tentativas.`);
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