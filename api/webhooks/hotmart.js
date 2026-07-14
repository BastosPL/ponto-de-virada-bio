const crypto = require('crypto');

const DATASET_ID = '1378410657468733';
const GRAPH_API_VERSION = 'v21.0';

const PRODUCT_MAP = {
  '7956947': { name: 'IA Lucrativa', value: 37.90 },
  '7956748': { name: 'Obsidian Inteligente', value: 32.90 },
};

function sha256(value) {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '');
}

async function sendPurchaseToMeta(payload) {
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${DATASET_ID}/events`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [payload],
        access_token: process.env.META_CAPI_ACCESS_TOKEN,
      }),
    }
  );
  const result = await response.json();
  console.log('[hotmart-webhook] Meta CAPI response:', JSON.stringify(result));
  return result;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const body = req.body || {};

  if (body.hottok !== process.env.HOTMART_HOTTOK) {
    console.warn('[hotmart-webhook] hottok inválido, requisição rejeitada');
    res.status(401).json({ error: 'invalid hottok' });
    return;
  }

  const event = body.event;
  if (event !== 'PURCHASE_APPROVED' && event !== 'PURCHASE_COMPLETE') {
    res.status(200).json({ ignored: true, event });
    return;
  }

  const data = body.data || {};
  const purchase = data.purchase || {};
  const buyer = data.buyer || {};
  const product = data.product || {};

  const productInfo = PRODUCT_MAP[String(product.id)] || {
    name: product.name || 'Produto Hotmart',
    value: purchase.price?.value || 0,
  };

  const eventPayload = {
    event_name: 'Purchase',
    event_time: Math.floor(new Date(purchase.approved_date || purchase.order_date || Date.now()).getTime() / 1000),
    event_id: `hotmart-${data.purchase?.transaction || purchase.transaction}`,
    action_source: 'website',
    event_source_url: data.subscription?.plan?.name ? undefined : `https://go.hotmart.com/${product.id}`,
    user_data: {
      em: buyer.email ? [sha256(buyer.email)] : undefined,
      ph: buyer.checkout_phone ? [sha256(normalizePhone(buyer.checkout_phone))] : undefined,
      fn: buyer.name ? [sha256(buyer.name.split(' ')[0])] : undefined,
      client_ip_address: req.headers['x-forwarded-for']?.split(',')[0],
      client_user_agent: req.headers['user-agent'],
    },
    custom_data: {
      currency: purchase.price?.currency_value || 'BRL',
      value: purchase.price?.value || productInfo.value,
      content_name: productInfo.name,
      content_ids: [String(product.id)],
      content_type: 'product',
    },
  };

  try {
    const result = await sendPurchaseToMeta(eventPayload);
    res.status(200).json({ received: true, meta_result: result });
  } catch (err) {
    console.error('[hotmart-webhook] erro ao enviar para Meta CAPI:', err);
    res.status(200).json({ received: true, meta_error: true });
  }
};
