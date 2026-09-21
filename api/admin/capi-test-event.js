const crypto = require('crypto');

const GRAPH_API_VERSION = 'v21.0';
const VERIFY_KEY = 'pxb-test-event-20260921';
const TEST_EVENT_CODE = 'TEST94313';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

module.exports = async (req, res) => {
  if (req.query?.key !== VERIFY_KEY) {
    res.status(404).json({ ok: false });
    return;
  }

  const datasetId = process.env.META_CAKTO_DATASET_ID;
  const token = process.env.META_CAKTO_CAPI_ACCESS_TOKEN;

  if (!datasetId || !token) {
    res.status(200).json({
      ok: false,
      reason: 'missing_env',
      dataset_id_present: Boolean(datasetId),
      token_present: Boolean(token),
    });
    return;
  }

  const eventId = 'pxb-capi-test-' + Date.now();
  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: 'https://domine-o-claude-inteiro.vercel.app/',
      user_data: {
        external_id: [sha256('pxb-capi-test-user')]
      },
      custom_data: {
        currency: 'BRL',
        value: 1.00,
        content_name: 'PxB CAPI Test Event',
        content_type: 'product'
      }
    }],
    test_event_code: TEST_EVENT_CODE,
    access_token: token
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${datasetId}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();

    res.status(200).json({
      ok: response.ok && !result.error,
      dataset_id: datasetId,
      test_event_code: TEST_EVENT_CODE,
      event_id: eventId,
      meta_response: result,
    });
  } catch (err) {
    res.status(200).json({
      ok: false,
      reason: 'request_failed',
      message: String(err?.message || err),
    });
  }
};
