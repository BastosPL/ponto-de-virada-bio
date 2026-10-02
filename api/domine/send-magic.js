const crypto = require('crypto');

function timingSafeEqual(provided, expected) {
  const a = Buffer.from(provided || '', 'utf8');
  const b = Buffer.from(expected || '', 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char]);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const authorization = req.headers.authorization || '';
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!timingSafeEqual(provided, process.env.DOMINE_MAILER_SECRET)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { to, link } = req.body || {};
  if (
    typeof to !== 'string' ||
    typeof link !== 'string' ||
    to.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)
  ) {
    return res.status(400).json({ error: 'invalid request' });
  }

  let magicUrl;
  try {
    magicUrl = new URL(link);
  } catch {
    return res.status(400).json({ error: 'invalid link' });
  }
  if (
    magicUrl.origin !== 'https://pontodeviradaoficial.com.br' ||
    magicUrl.pathname !== '/domine/api/auth/magic' ||
    !magicUrl.searchParams.get('token')
  ) {
    return res.status(400).json({ error: 'invalid link' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('[domine-mailer] RESEND_API_KEY is missing');
    return res.status(503).json({ error: 'delivery unavailable' });
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Domine 2.0 <acesso@pontodeviradaoficial.com.br>',
      to: [to],
      subject: 'Seu acesso ao Domine 2.0',
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#27231f"><p style="font-size:12px;letter-spacing:.12em;color:#a34e2d">DOMINE 2.0</p><h1 style="font-size:28px">Seu link de acesso</h1><p>Use o botão abaixo para entrar na sua área do Domine 2.0.</p><p style="margin:28px 0"><a href="${escapeHtml(magicUrl.toString())}" style="background:#bd5a32;color:#fff;text-decoration:none;padding:14px 20px;border-radius:8px;display:inline-block">Acessar o Domine 2.0</a></p><p style="font-size:13px;color:#6d655e">Este link é individual, pode ser usado uma única vez e expira em 15 minutos. Se você não solicitou este acesso, ignore esta mensagem.</p></div>`,
      text: `Acesse o Domine 2.0 pelo link abaixo. Ele é individual, de uso único e expira em 15 minutos.\n\n${magicUrl.toString()}`,
    }),
  });

  if (!response.ok) {
    console.error('[domine-mailer] Resend HTTP', response.status);
    return res.status(502).json({ error: 'delivery failed' });
  }

  const result = await response.json();
  return res.status(200).json({ ok: true, id: result.id });
};
