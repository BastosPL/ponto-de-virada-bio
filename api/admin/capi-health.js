const DATASET_ID = '1723267265408156';
const GRAPH_API_VERSION = 'v21.0';
const VERIFY_KEY = 'pxb-1723267265408156-20260921-verify';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  if (req.query?.key !== VERIFY_KEY) {
    res.status(404).json({ ok: false });
    return;
  }

  const token = process.env.META_CAKTO_CAPI_ACCESS_TOKEN;
  if (!token) {
    res.status(200).json({ ok: false, reason: 'missing_token_env' });
    return;
  }

  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${DATASET_ID}`);
    url.searchParams.set('fields', 'id,name');
    url.searchParams.set('access_token', token);

    const response = await fetch(url);
    const result = await response.json();

    if (!response.ok || result.error) {
      res.status(200).json({
        ok: false,
        reason: 'meta_rejected_token_or_dataset_access',
        meta_error: result.error ? {
          message: result.error.message,
          type: result.error.type,
          code: result.error.code,
          error_subcode: result.error.error_subcode,
        } : null,
      });
      return;
    }

    res.status(200).json({
      ok: true,
      dataset_id: result.id || DATASET_ID,
      dataset_name: result.name || null,
      token_env_present: true,
    });
  } catch (err) {
    res.status(200).json({ ok: false, reason: 'request_failed', message: String(err?.message || err) });
  }
};
