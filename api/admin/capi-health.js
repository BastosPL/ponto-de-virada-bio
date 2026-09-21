const GRAPH_API_VERSION = 'v21.0';
const VERIFY_KEY = 'pxb-capi-verify-20260921-v2';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

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

  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${datasetId}`);
    url.searchParams.set('fields', 'id,name');
    url.searchParams.set('access_token', token);

    const response = await fetch(url);
    const result = await response.json();

    if (!response.ok || result.error) {
      res.status(200).json({
        ok: false,
        reason: 'meta_rejected_token_or_dataset_access',
        dataset_id: datasetId,
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
      dataset_id: result.id || datasetId,
      dataset_name: result.name || null,
      token_present: true,
    });
  } catch (err) {
    res.status(200).json({
      ok: false,
      reason: 'request_failed',
      message: String(err?.message || err),
    });
  }
};
