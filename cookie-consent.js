/**
 * Gate de consentimento para o Meta Pixel — compartilhado entre as landing
 * pages deste projeto. Antes desta correção, o Pixel disparava incondicional-
 * mente (init + PageView) assim que a página carregava, sem perguntar nada
 * ao visitante. Agora só carrega depois de "Aceitar".
 *
 * Uso: definir `window.__PIXEL_ID__ = '<id>'` antes de incluir este arquivo.
 */
(function () {
  var KEY = 'pv_cookie_consent';

  function getConsent() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(KEY, value); } catch (e) {}
  }

  function loadMetaPixel() {
    var pixelId = window.__PIXEL_ID__;
    if (!pixelId || window.fbq) return;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', pixelId);
    fbq('track', 'PageView');
  }

  // Usado pelos onclick dos CTAs (InitiateCheckout etc.) — só dispara com consentimento.
  window.pvTrackEvent = function (name, params) {
    if (getConsent() === 'accepted' && typeof fbq === 'function') {
      fbq('track', name, params);
    }
  };

  function showBanner() {
    var el = document.createElement('div');
    el.id = 'pv-cookie-banner';
    el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#0a0a0f;border-top:1px solid rgba(255,255,255,0.12);padding:16px 20px;z-index:9999;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:center;font-family:Inter,-apple-system,sans-serif;box-shadow:0 -8px 30px rgba(0,0,0,0.4);';
    el.innerHTML =
      '<span style="color:#ccc;font-size:13px;max-width:480px;line-height:1.5;">' +
      'Usamos cookies para melhorar sua experiência e medir o desempenho dos nossos anúncios. ' +
      '<a href="privacidade.html" style="color:#4db8ff;text-decoration:underline;">Saiba mais</a>.' +
      '</span>' +
      '<span style="display:flex;gap:8px;flex-shrink:0;">' +
      '<button id="pv-cookie-accept" style="background:#00cc44;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">Aceitar</button>' +
      '<button id="pv-cookie-decline" style="background:transparent;color:#999;border:1px solid #444;padding:9px 18px;border-radius:8px;font-size:13px;cursor:pointer;">Recusar</button>' +
      '</span>';
    document.body.appendChild(el);

    document.getElementById('pv-cookie-accept').onclick = function () {
      setConsent('accepted');
      el.remove();
      loadMetaPixel();
    };
    document.getElementById('pv-cookie-decline').onclick = function () {
      setConsent('declined');
      el.remove();
    };
  }

  document.addEventListener('DOMContentLoaded', function () {
    var consent = getConsent();
    if (consent === 'accepted') {
      loadMetaPixel();
    } else if (consent !== 'declined') {
      showBanner();
    }
  });
})();
