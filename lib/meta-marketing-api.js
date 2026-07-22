const GRAPH_API_VERSION = 'v21.0';
const TOKEN = process.env.META_SYSTEM_USER_TOKEN;

function authHeaders(extra) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

async function getAdSetTargeting(adSetId) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adSetId}?fields=targeting,name,status,optimization_goal,promoted_object`;
  const response = await fetch(url, { headers: authHeaders() });
  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao buscar ad set ${adSetId}: ${JSON.stringify(result.error)}`);
  }
  return result;
}

async function restrictPlacementsToManual(adSetId) {
  const current = await getAdSetTargeting(adSetId);

  const updatedTargeting = {
    ...current.targeting,
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed'],
    instagram_positions: ['stream', 'story'],
  };
  delete updatedTargeting.audience_network_positions;
  delete updatedTargeting.messenger_positions;

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adSetId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ targeting: updatedTargeting }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao atualizar ad set ${adSetId}: ${JSON.stringify(result.error)}`);
  }

  const after = await getAdSetTargeting(adSetId);
  return { update_result: result, targeting_after: after.targeting };
}

async function getAdStatus(adId) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adId}?fields=status,effective_status,name`;
  const response = await fetch(url, { headers: authHeaders() });
  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao buscar anúncio ${adId}: ${JSON.stringify(result.error)}`);
  }
  return result;
}

async function pauseAd(adId) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status: 'PAUSED' }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao pausar anúncio ${adId}: ${JSON.stringify(result.error)}`);
  }
  return result;
}

async function updateAdSetOptimizationGoal(adSetId, optimizationGoal, pixelId, customEventType) {
  const body = { optimization_goal: optimizationGoal };
  if (pixelId) {
    body.promoted_object = { pixel_id: pixelId, custom_event_type: customEventType || 'PURCHASE' };
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adSetId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao atualizar ad set ${adSetId}: ${JSON.stringify(result.error)}`);
  }

  const after = await getAdSetTargeting(adSetId);
  return { update_result: result, ad_set_after: after };
}

// SEGURANÇA: cria sempre em status PAUSED — não é possível ligar gasto por
// esta função. Ativar exige uma chamada separada e explícita a pauseAd
// (ou uma futura activateAd), sempre com confirm:true e OK do Patrick.
async function createAdSet(adAccountId, params) {
  const body = {
    campaign_id: params.campaignId,
    name: params.name,
    optimization_goal: params.optimizationGoal,
    billing_event: params.billingEvent || 'IMPRESSIONS',
    targeting: params.targeting,
    status: 'PAUSED',
  };
  if (params.pixelId) {
    body.promoted_object = { pixel_id: params.pixelId, custom_event_type: params.customEventType || 'PURCHASE' };
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${adAccountId}/adsets`;
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao criar ad set: ${JSON.stringify(result.error)}`);
  }
  return result;
}

// Mesma regra de segurança: sempre PAUSED na criação.
async function createAd(adAccountId, params) {
  const body = {
    adset_id: params.adSetId,
    name: params.name,
    creative: { creative_id: params.creativeId },
    status: 'PAUSED',
  };

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${adAccountId}/ads`;
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao criar anúncio: ${JSON.stringify(result.error)}`);
  }
  return result;
}

async function getAdsInAdSet(adSetId) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adSetId}/ads?fields=id,name,status,creative{id,name}`;
  const response = await fetch(url, { headers: authHeaders() });
  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao listar anúncios do ad set ${adSetId}: ${JSON.stringify(result.error)}`);
  }
  return result;
}

async function getAdInsights(adId, datePreset) {
  const fields = [
    'spend',
    'cpc',
    'ctr',
    'impressions',
    'reach',
    'frequency',
    'clicks',
    'actions',
    'cost_per_action_type',
  ].join(',');
  const range = datePreset || 'maximum';
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adId}/insights?fields=${fields}&date_preset=${range}`;
  const response = await fetch(url, { headers: authHeaders() });
  const result = await response.json();
  if (result.error) {
    throw new Error(`Erro ao buscar insights do anúncio ${adId}: ${JSON.stringify(result.error)}`);
  }
  return result.data && result.data[0] ? result.data[0] : { spend: '0', note: 'sem dados nesse período' };
}

module.exports = {
  getAdSetTargeting,
  restrictPlacementsToManual,
  getAdStatus,
  pauseAd,
  getAdInsights,
  updateAdSetOptimizationGoal,
  createAdSet,
  createAd,
  getAdsInAdSet,
};
