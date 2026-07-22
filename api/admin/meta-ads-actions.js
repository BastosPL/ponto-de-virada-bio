// trigger redeploy — GitHub API degradada, forçando novo evento via webhook
const crypto = require('crypto');
const {
  getAdSetTargeting,
  restrictPlacementsToManual,
  getAdStatus,
  pauseAd,
  getAdInsights,
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
