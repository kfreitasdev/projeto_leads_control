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

  const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || '').replace(/\/$/, '');
  const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
  const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '2';
  const INBOX_ID = process.env.INBOX_ID || '25';
  const KANBAN_BOARD_ID = process.env.KANBAN_BOARD_ID;

  if (!CHATWOOT_BASE_URL || !CHATWOOT_API_TOKEN) {
    return res.status(500).json({ error: 'Server misconfigured: missing Chatwoot credentials' });
  }

  const { name, phone, summary } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: 'Missing required fields: name, phone' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'api_access_token': CHATWOOT_API_TOKEN
  };

  const kanbanLogs = [];

  try {
    // 1. Buscar/Criar Contato
    let contactId = null;
    const searchRes = await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(phone)}`, { headers });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.payload?.length > 0) contactId = searchData.payload[0].id;
    }

    if (!contactId) {
      const createRes = await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, phone_number: phone })
      });
      const cData = await createRes.json();
      contactId = cData.payload?.contact?.id || cData.payload?.id;
    }

    // 2. Criar Conversa
    const convRes = await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inbox_id: Number(INBOX_ID), contact_id: Number(contactId) })
    });
    const convData = await convRes.json();
    const conversationId = convData.payload?.id || convData.id;

    // 3. Nota Privada
    if (conversationId && summary) {
      await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: `📞 ${summary}`, private: true })
      });
    }

    // 4. Integração Kanban (Diagnóstico Ativado)
    if (KANBAN_BOARD_ID && conversationId && summary) {
      kanbanLogs.push(`Iniciando busca no board ${KANBAN_BOARD_ID} para Conv #${conversationId}`);
      const retryDelays = [3000, 3000, 4000];
      
      for (let i = 0; i < retryDelays.length; i++) {
        kanbanLogs.push(`Tentativa ${i+1}/${retryDelays.length} (Aguardando ${retryDelays[i]}ms)`);
        await new Promise(r => setTimeout(r, retryDelays[i]));

        const listUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks`;
        const listRes = await fetch(listUrl, { headers });
        
        if (!listRes.ok) {
          kanbanLogs.push(`Erro ao listar: ${listRes.status}`);
          continue;
        }

        const tasksData = await listRes.json();
        const tasksList = tasksData.payload || tasksData;

        if (Array.isArray(tasksList)) {
          kanbanLogs.push(`Encontradas ${tasksList.length} tasks.`);
          
          // Busca precisa por padrão de título vindo do Chatwoot
          let targetTask = tasksList.find(t => t.title && t.title.includes(`#${conversationId}`));
          
          if (!targetTask) {
            targetTask = tasksList.find(t => String(t.conversation_id) === String(conversationId));
          }

          if (targetTask) {
            kanbanLogs.push(`Card achado: ID ${targetTask.id} ("${targetTask.title}")`);
            const upRes = await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks/${targetTask.id}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ description: `📝 Resumo de Lead:\n\n${summary}\n\n---\nEnvio via Babyland Hub` })
            });
            
            if (upRes.ok) {
              kanbanLogs.push('✅ Sucesso: Card atualizado!');
              break;
            } else {
              const err = await upRes.text();
              kanbanLogs.push(`❌ Erro no PATCH [${upRes.status}]: ${err.substring(0, 50)}`);
            }
          } else {
            kanbanLogs.push(`Card #${conversationId} não encontrado.`);
            if (i === retryDelays.length - 1 && tasksList.length > 0) {
              kanbanLogs.push(`Exemplos de cards que vi: ${tasksList.slice(0, 2).map(t => t.title).join(' | ')}`);
            }
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      conversation_id: conversationId,
      kanban_report: kanbanLogs
    });

  } catch (error) {
    console.error('[Fatal Error]', error);
    return res.status(500).json({ success: false, error: error.message, kanban_report: kanbanLogs });
  }
}