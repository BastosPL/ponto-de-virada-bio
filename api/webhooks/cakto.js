const crypto = require('crypto');

// TODO: preencher depois que o pixel/dataset dedicado da Cakto for criado
// (Business Manager -> Events Manager -> Fontes de dados -> Adicionar -> Web).
// Enquanto META_CAKTO_DATASET_ID/META_CAKTO_CAPI_ACCESS_TOKEN não existirem
// como env vars na Vercel, este endpoint recebe o webhook mas falha ao
// tentar postar pro Meta (erro fica logado, não quebra a resposta 200).
const DATASET_ID = process.env.META_CAKTO_DATASET_ID;
const GRAPH_API_VERSION = 'v21.0';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function normalizeDigits(value) {
  return (value || '').replace(/\D/g, '');
}

function isValidSecret(provided, expected) {
  const a = Buffer.from(provided || '', 'utf8');
  const b = Buffer.from(expected || '', 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function sendPurchaseToMeta(payload) {
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${DATASET_ID}/events`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [payload],
        access_token: process.env.META_CAKTO_CAPI_ACCESS_TOKEN,
      }),
    }
  );
  const result = await response.json();
  console.log('[cakto-webhook] Meta CAPI response:', JSON.stringify(result));
  return result;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const body = req.body || {};

  // A Cakto manda a chave secreta dentro do body (raiz do JSON), não em header.
  if (!isValidSecret(body.secret, process.env.CAKTO_WEBHOOK_SECRET)) {
    console.warn('[cakto-webhook] secret inválido, requisição rejeitada');
    res.status(401).json({ error: 'invalid secret' });
    return;
  }

  if (body.event !== 'purchase_approved') {
    res.status(200).json({ ignored: true, event: body.event });
    return;
  }

  const items = Array.isArray(body.data) ? body.data : [];
  if (items.length === 0) {
    res.status(200).json({ ignored: true, reason: 'empty data[]' });
    return;
  }

  // Tipo de disparo "Agrupado": uma venda com Order Bump vem como 2+ itens
  // no mesmo evento (offer_type "main" + "orderbump", ligados por parent_order).
  // Mandamos 1 único evento Purchase pro Meta com o valor somado da transação inteira.
  const mainItem = items.find((item) => item.offer_type === 'main') || items[0];
  const customer = mainItem.customer || {};
  const nameParts = (customer.name || '').trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ');

  // NOTA: "amount" no payload de exemplo da Cakto não deixa claro se é reais
  // ou centavos (ex.: price 100 / amount 90 pra um produto de teste genérico).
  // Verificar no Test Events do Meta antes de confiar nisso em produção —
  // se o valor aparecer 100x maior/menor que o esperado, é conversão de unidade.
  const totalAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const contentIds = items.map((item) => item.product?.id).filter(Boolean);
  const contentNames = items.map((item) => item.product?.name).filter(Boolean).join(' + ');

  // fbc/fbp já vêm nativos no payload da Cakto (se capturados na LP) —
  // procurar em qualquer item, não só no principal.
  const fbc = items.map((item) => item.fbc).find(Boolean);
  const fbp = items.map((item) => item.fbp).find(Boolean);

  const eventPayload = {
    event_name: 'Purchase',
    event_time: Math.floor(new Date(mainItem.paidAt || mainItem.createdAt || Date.now()).getTime() / 1000),
    // refId é o identificador da transação (não muda entre main/orderbump) — usar pra dedup.
    event_id: `cakto-${mainItem.refId}`,
    action_source: 'website',
    user_data: {
      em: customer.email ? [sha256(customer.email)] : undefined,
      ph: customer.phone ? [sha256(normalizeDigits(customer.phone))] : undefined,
      fn: firstName ? [sha256(firstName)] : undefined,
      ln: lastName ? [sha256(lastName)] : undefined,
      // CPF não é um campo padrão do Meta CAPI, mas dá pra usar como external_id
      // hasheado — ajuda o Event Match Quality, não é obrigatório.
      external_id: customer.docNumber ? [sha256(normalizeDigits(customer.docNumber))] : undefined,
      client_ip_address: req.headers['x-forwarded-for']?.split(',')[0],
      client_user_agent: req.headers['user-agent'],
      fbc: fbc || undefined,
      fbp: fbp || undefined,
    },
    custom_data: {
      currency: 'BRL',
      value: totalAmount,
      content_name: contentNames || 'Produto Cakto',
      content_ids: contentIds,
      content_type: 'product',
    },
  };

  try {
    const result = await sendPurchaseToMeta(eventPayload);
    res.status(200).json({ received: true, meta_result: result });
  } catch (err) {
    console.error('[cakto-webhook] erro ao enviar para Meta CAPI:', err);
    res.status(200).json({ received: true, meta_error: true });
  }
};
