const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || 'https://contact.glowryia.com').replace(/\/$/, '');
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN;
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID;
const INBOX_ID = process.env.INBOX_ID;
const KANBAN_BOARD_ID = process.env.KANBAN_BOARD_ID || '4';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { name, phone, email, mode, conversationId: existingConvId } = req.body;
    let kanbanLogs = [];

    try {
        let contactId, conversationId;

        // Se estivermos apenas sincronizando, pulamos a criação
        if (mode === 'sync_only' && existingConvId) {
            conversationId = existingConvId;
            kanbanLogs.push(`Modo Sincronização Manual iniciado para Conversa #${conversationId}`);
        } else {
            // PROCESSO PADRÃO: CRIAR CONTATO E CONVERSA
            // 1. Criar/Buscar Contato
            const contactRes = await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'api_access_token': CHATWOOT_API_TOKEN },
                body: JSON.stringify({ name, phone_number: phone, email, inbox_id: INBOX_ID })
            });
            const contactData = await contactRes.json();
            contactId = contactData.payload?.contact?.id || contactData.id;

            if (!contactId) throw new Error("Falha ao identificar contato");

            // 2. Criar Conversa
            const convRes = await fetch(`${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'api_access_token': CHATWOOT_API_TOKEN },
                body: JSON.stringify({ source_id: phone, inbox_id: INBOX_ID, contact_id: contactId, status: 'open' })
            });
            const convData = await convRes.json();
            conversationId = convData.id;

            if (!conversationId) throw new Error("Falha ao criar conversa");
        }

        // 3. SINCRONIZAÇÃO KANBAN (Com tentativa de localização robusta)
        const summary = `Lead: ${name}\nTelefone: ${phone}\nEmail: ${email}\nData: ${new Date().toLocaleString('pt-BR')}`;
        let kanbanSuccess = false;

        // Tentamos localizar o card no Kanban (3 tentativas com delay se for modo full)
        const maxAttempts = mode === 'sync_only' ? 2 : 3;
        const delayMs = mode === 'sync_only' ? 500 : 3000;

        for (let i = 1; i <= maxAttempts; i++) {
            kanbanLogs.push(`Busca no Kanban: Tentativa ${i}/${maxAttempts}...`);
            
            // Usamos a rota que costuma funcionar em extensões
            const listUrl = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/kanban_boards/${KANBAN_BOARD_ID}/kanban_tasks`;
            const listRes = await fetch(listUrl, {
                headers: { 'api_access_token': CHATWOOT_API_TOKEN }
            });

            if (listRes.ok) {
                const tasks = await listRes.json();
                // Busca pelo conversation_id ou pelo título padrao "#ID"
                const targetTask = tasks.find(t => 
                    t.conversation_id == conversationId || 
                    (t.title && t.title.includes(`#${conversationId}`))
                );

                if (targetTask) {
                    kanbanLogs.push(`Card encontrado! ID: ${targetTask.id}. Atualizando descrição...`);
                    const upRes = await fetch(`${listUrl}/${targetTask.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'api_access_token': CHATWOOT_API_TOKEN },
                        body: JSON.stringify({ description: summary })
                    });
                    
                    if (upRes.ok) {
                        kanbanSuccess = true;
                        kanbanLogs.push("Descrição atualizada com sucesso no Kanban.");
                        break;
                    } else {
                        kanbanLogs.push(`Erro ao atualizar card: ${upRes.status}`);
                    }
                } else {
                    kanbanLogs.push("Card ainda não encontrado no board.");
                }
            } else {
                kanbanLogs.push(`Erro na API do Kanban: ${listRes.status} (URL: ${listUrl})`);
            }

            if (i < maxAttempts) await new Promise(r => setTimeout(r, delayMs));
        }

        return res.status(200).json({
            success: true,
            contactId,
            conversationId,
            kanban_sync: kanbanSuccess,
            kanban_report: kanbanLogs
        });

    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            error: error.message,
            kanban_report: kanbanLogs 
        });
    }
}