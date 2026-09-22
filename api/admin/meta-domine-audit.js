const GRAPH_API_VERSION = 'v21.0';
const VERIFY_KEY = 'domine-audit-20260921-v1';

async function graph(path, params = {}) {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  url.searchParams.set('access_token', token);
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(JSON.stringify(j.error || j));
  return j;
}

module.exports = async (req, res) => {
  if (req.query?.key !== VERIFY_KEY) return res.status(404).json({ok:false});
  const account = process.env.META_AD_ACCOUNT_ID;
  if (!account || !process.env.META_SYSTEM_USER_TOKEN) {
    return res.status(200).json({ok:false, reason:'missing_env', account_present:!!account, token_present:!!process.env.META_SYSTEM_USER_TOKEN});
  }
  const act = account.startsWith('act_') ? account : `act_${account}`;
  try {
    const [campaigns, adsets, ads] = await Promise.all([
      graph(`${act}/campaigns`, {fields:'id,name,status,effective_status,objective,created_time',limit:'200'}),
      graph(`${act}/adsets`, {fields:'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,billing_event,promoted_object,targeting,created_time',limit:'200'}),
      graph(`${act}/ads`, {fields:'id,name,status,effective_status,campaign_id,adset_id,creative{id,name}',limit:'300'})
    ]);
    const terms = ['claude','dcl','domine'];
    const hit = n => terms.some(t => String(n||'').toLowerCase().includes(t));
    const c = (campaigns.data||[]).filter(x=>hit(x.name));
    const cids = new Set(c.map(x=>x.id));
    const s = (adsets.data||[]).filter(x=>hit(x.name) || cids.has(x.campaign_id));
    const sids = new Set(s.map(x=>x.id));
    const a = (ads.data||[]).filter(x=>hit(x.name) || sids.has(x.adset_id) || cids.has(x.campaign_id));
    res.status(200).json({ok:true, campaigns:c, adsets:s, ads:a});
  } catch (e) {
    res.status(200).json({ok:false, error:String(e.message||e)});
  }
};
