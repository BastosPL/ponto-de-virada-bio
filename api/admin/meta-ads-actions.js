// trigger redeploy — GitHub API degradada, forçando novo evento via webhook
const crypto = require('crypto');
const {
  getAdSetTargeting,
  restrictPlacementsToManual,
  getAdStatus,
  pauseAd,
  getAdInsights,
  updateAdSetOptimizationGoal,
  createAdSet,
  createAd,
} = require('../../lib/meta-marketing-api');

function isValidSecret(provided, expected) {
  const a = Buffer.from(provided || '', 'utf8');
  const b = Buffer.from(expected || '', 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const providedSecret = req.headers['x-admin-secret'];
  const expectedSecret = process.env.META_ADMIN_API_SECRET;

  if (!isValidSecret(providedSecret, expectedSecret)) {
    res.status(401).json({ error: 'invalid or missing X-Admin-Secret' });
    return;
  }

  const { action, confirm, params } = req.body || {};

  try {
    switch (action) {
      case 'get_ad_set_targeting': {
        const result = await getAdSetTargeting(params.adSetId);
        res.status(200).json(result);
        return;
      }

      case 'get_insights': {
        const result = await getAdInsights(params.adId, params.datePreset);
        res.status(200).json(result);
        return;
      }

      case 'restrict_placements': {
        if (!confirm) {
          const current = await getAdSetTargeting(params.adSetId);
          res.status(200).json({
            dry_run: true,
            would_execute: `POST /${params.adSetId} { targeting: { publisher_platforms: [facebook, instagram], facebook_positions: [feed], instagram_positions: [stream, story] } }`,
            current_targeting: current.targeting,
            message: 'Envie novamente com "confirm": true para executar de fato.',
          });
          return;
        }
        const result = await restrictPlacementsToManual(params.adSetId);
        res.status(200).json({ executed: true, ...result });
        return;
      }

      case 'update_optimization_goal': {
        if (!confirm) {
          const current = await getAdSetTargeting(params.adSetId);
          res.status(200).json({
            dry_run: true,
            would_execute: `POST /${params.adSetId} { optimization_goal: ${params.optimizationGoal}, promoted_object: { pixel_id: ${params.pixelId}, custom_event_type: ${params.customEventType || 'PURCHASE'} } }`,
            current_optimization_goal: current.optimization_goal,
            current_promoted_object: current.promoted_object,
            message: 'Envie novamente com "confirm": true para executar de fato.',
          });
          return;
        }
        const result = await updateAdSetOptimizationGoal(
          params.adSetId,
          params.optimizationGoal,
          params.pixelId,
          params.customEventType
        );
        res.status(200).json({ executed: true, ...result });
        return;
      }

      case 'create_ad_set': {
        if (!confirm) {
          res.status(200).json({
            dry_run: true,
            would_execute: `POST /act_${params.adAccountId}/adsets { campaign_id: ${params.campaignId}, name: "${params.name}", optimization_goal: ${params.optimizationGoal}, billing_event: ${params.billingEvent || 'IMPRESSIONS'}, promoted_object: { pixel_id: ${params.pixelId}, custom_event_type: ${params.customEventType || 'PURCHASE'} }, targeting: ${JSON.stringify(params.targeting)}, status: PAUSED (forçado, não configurável) }`,
            message: 'Envie novamente com "confirm": true para executar de fato. Sempre criado como PAUSED.',
          });
          return;
        }
        const result = await createAdSet(params.adAccountId, params);
        res.status(200).json({ executed: true, status_forced: 'PAUSED', ...result });
        return;
      }

      case 'create_ad': {
        if (!confirm) {
          res.status(200).json({
            dry_run: true,
            would_execute: `POST /act_${params.adAccountId}/ads { adset_id: ${params.adSetId}, name: "${params.name}", creative: { creative_id: ${params.creativeId} }, status: PAUSED (forçado, não configurável) }`,
            message: 'Envie novamente com "confirm": true para executar de fato. Sempre criado como PAUSED.',
          });
          return;
        }
        const result = await createAd(params.adAccountId, params);
        res.status(200).json({ executed: true, status_forced: 'PAUSED', ...result });
        return;
      }

      case 'pause_ad': {
        if (!confirm) {
          const current = await getAdStatus(params.adId);
          res.status(200).json({
            dry_run: true,
            would_execute: `POST /${params.adId} { status: PAUSED }`,
            current_status: current.status,
            message: 'Envie novamente com "confirm": true para executar de fato.',
          });
          return;
        }
        const result = await pauseAd(params.adId);
        res.status(200).json({ executed: true, ...result });
        return;
      }

      default:
        res.status(400).json({ error: `unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[meta-ads-actions] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
};
