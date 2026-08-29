// Content script v2.0 - runs on Gemini pages
// Extract tokens + intercept TTS/audio batchexecute requests

(function () {
  const HOST = 'gemini.google.com';

  // ===== TOKEN EXTRACTION =====
  function extractTokens() {
    const tokens = {
      at: null, bl: null, fSid: null, shareId: null, hl: null,
      url: window.location.href, timestamp: Date.now(),
    };

    // Strategy 1: All script tags + page HTML
    let allText = '';
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) allText += (s.textContent || '') + '\n';
    allText += '\n' + (document.documentElement?.outerHTML || '');

    const patterns = {
      at: [/"SNlM0e"\s*:\s*"([^"]+)"/, /'SNlM0e'\s*:\s*'([^']+)'/, /SNlM0e\s*=\s*"([^"]+)"/],
      bl: [/"cfb2h"\s*:\s*"([^"]+)"/, /'cfb2h'\s*:\s*'([^']+)'/, /cfb2h\s*=\s*"([^"]+)"/],
      fSid: [/"FdrFJe"\s*:\s*"([^"]+)"/, /'FdrFje'\s*:\s*'([^']+)'/, /FdrFJe\s*=\s*"([^"]+)"/],
      hl: [/"hl"\s*:\s*"([a-z]{2}(?:-[A-Z]{2})?)"/, /'hl'\s*:\s*'([a-z]{2}(?:-[A-Z]{2})?)'/],
    };

    for (const [key, regexList] of Object.entries(patterns)) {
      for (const regex of regexList) {
        const m = allText.match(regex);
        if (m && m[1]) { tokens[key] = m[1]; break; }
      }
    }

    // Strategy 2: WIZ_global_data (Google internal config)
    try {
      if (window.WIZ_global_data) {
        if (!tokens.at && window.WIZ_global_data.SNlM0e) tokens.at = window.WIZ_global_data.SNlM0e;
        if (!tokens.bl && window.WIZ_global_data.cfb2h) tokens.bl = window.WIZ_global_data.cfb2h;
        if (!tokens.fSid && window.WIZ_global_data.FdrFJe) tokens.fSid = window.WIZ_global_data.FdrFJe;
      }
    } catch {}

    // Strategy 3: Window globals
    try {
      if (!tokens.at && typeof window.SNlM0e !== 'undefined') tokens.at = window.SNlM0e;
      if (!tokens.bl && typeof window.cfb2h !== 'undefined') tokens.bl = window.cfb2h;
      if (!tokens.fSid && typeof window.FdrFje !== 'undefined') tokens.fSid = window.FdrFje;
    } catch {}

    // Extract share ID
    const m = window.location.pathname.match(/\/share\/([a-f0-9]+)/i);
    if (m) tokens.shareId = m[1];
    else {
      const parts = window.location.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && /^[a-zA-Z0-9_-]{8,}$/.test(last)) tokens.shareId = last;
    }

    return tokens;
  }

  function reportTokens(reason) {
    const tokens = extractTokens();
    if (tokens.at || tokens.bl || tokens.fSid) {
      chrome.runtime.sendMessage({ type: 'TOKENS_FOUND', tokens, reason }).catch(() => {});
      return true;
    }
    return false;
  }

  // ===== LISTEN FOR POPUP REQUESTS =====
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'EXTRACT_TOKENS_FROM_CONTENT') {
      const tokens = extractTokens();
      sendResponse({ success: true, tokens });
      return true;
    }
    return false;
  });

  // ===== AUTO-CAPTURE ON PAGE LOAD =====
  if (window.location.hostname === HOST) {
    // Multiple retry timings
    [500, 1500, 3000, 5000, 8000].forEach(t => {
      setTimeout(() => reportTokens(`auto-${t}ms`), t);
    });

    // Watch SPA navigation
    let lastUrl = window.location.href;
    const checkUrl = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(() => reportTokens('nav-2s'), 2000);
        setTimeout(() => reportTokens('nav-4s'), 4000);
      }
    };

    const origPush = history.pushState;
    history.pushState = function () { origPush.apply(this, arguments); checkUrl(); };
    const origReplace = history.replaceState;
    history.replaceState = function () { origReplace.apply(this, arguments); checkUrl(); };
    window.addEventListener('popstate', checkUrl);

    // ===== INTERCEPT batchexecute REQUESTS (for TTS detection) =====
    // Hook fetch to detect TTS requests
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const [resource, config] = args;
      const url = typeof resource === 'string' ? resource : resource?.url || '';

      if (url.includes('batchexecute') && config?.method === 'POST') {
        const body = typeof config.body === 'string' ? config.body : '';

        // Check if this is a TTS request
        if (body.includes('AUDIO') || body.includes('speechConfig') || body.includes('prebuiltVoice') || body.includes('voiceConfig')) {
          // Extract f.sid from URL
          const fsidMatch = url.match(/f\.sid=([^&]+)/);
          const blMatch = url.match(/bl=([^&]+)/);
          const atMatch = body.match(/at=([^&]+)/);

          const ttsInfo = {
            type: 'TTS_REQUEST_DETECTED',
            fSid: fsidMatch ? decodeURIComponent(fsidMatch[1]) : null,
            bl: blMatch ? decodeURIComponent(blMatch[1]) : null,
            at: atMatch ? decodeURIComponent(atMatch[1]) : null,
            url: url,
          };

          // Send to background to update tokens if they changed
          chrome.runtime.sendMessage({
            type: 'TOKENS_FOUND',
            tokens: {
              at: ttsInfo.at,
              bl: ttsInfo.bl,
              fSid: ttsInfo.fSid,
              shareId: null,
              hl: null,
              url: window.location.href,
            },
            reason: 'tts-intercept',
          }).catch(() => {});
        }
      }

      return origFetch.apply(this, args);
    };

    // Also hook XMLHttpRequest (some requests might use XHR)
    const origXHROpen = XMLHttpRequest.prototype.open;
    const origXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._url = url;
      this._method = method;
      return origXHROpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body) {
      if (this._url && this._url.includes('batchexecute') && body) {
        const bodyStr = typeof body === 'string' ? body : '';
        if (bodyStr.includes('AUDIO') || bodyStr.includes('speechConfig') || bodyStr.includes('prebuiltVoice')) {
          const fsidMatch = this._url.match(/f\.sid=([^&]+)/);
          const blMatch = this._url.match(/bl=([^&]+)/);
          const atMatch = bodyStr.match(/at=([^&]+)/);

          chrome.runtime.sendMessage({
            type: 'TOKENS_FOUND',
            tokens: {
              at: atMatch ? decodeURIComponent(atMatch[1]) : null,
              bl: blMatch ? decodeURIComponent(blMatch[1]) : null,
              fSid: fsidMatch ? decodeURIComponent(fsidMatch[1]) : null,
              shareId: null,
              hl: null,
              url: window.location.href,
            },
            reason: 'tts-xhr-intercept',
          }).catch(() => {});
        }
      }
      return origXHRSend.call(this, body);
    };
  }
})();
