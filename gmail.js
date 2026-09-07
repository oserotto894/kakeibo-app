// Gmail integration: Google Identity Services (OAuth) + Gmail REST API,
// called directly from the browser. Nothing is sent to any server we control.
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

function gisReady() {
  return typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
}

function initTokenClient(clientId) {
  if (!gisReady()) throw new Error("Google Identity Services がまだ読み込まれていません");
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GMAIL_SCOPE,
    callback: () => {}, // overridden per-call via requestAccessToken
  });
}

function ensureToken(clientId) {
  return new Promise((resolve, reject) => {
    if (!clientId) {
      reject(new Error("設定画面で Google OAuth クライアントID を入力してください"));
      return;
    }
    if (accessToken && Date.now() < tokenExpiresAt - 60000) {
      resolve(accessToken);
      return;
    }
    try {
      if (!tokenClient) initTokenClient(clientId);
      tokenClient.callback = (resp) => {
        if (resp.error) {
          reject(new Error("Google サインインに失敗しました: " + resp.error));
          return;
        }
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (resp.expires_in || 3600) * 1000;
        resolve(accessToken);
      };
      tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
    } catch (e) {
      reject(e);
    }
  });
}

function signOut() {
  if (accessToken && gisReady()) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
}

function isSignedIn() {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

async function gmailApi(path, params) {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me" + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail API エラー (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function listAllMessageIds(query) {
  const ids = [];
  let pageToken = undefined;
  do {
    const data = await gmailApi("/messages", { q: query, maxResults: 100, pageToken });
    for (const m of data.messages || []) ids.push(m.id);
    pageToken = data.nextPageToken;
  } while (pageToken && ids.length < 500);
  return ids;
}

function decodeBase64Url(data) {
  if (!data) return "";
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch (e) {
    return "";
  }
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

// Some transactional emails embed invisible unicode characters (zero-width
// space/joiner, BOM) throughout the body, which silently break literal
// regex matches even though the text looks identical to a human reader.
function stripInvisible(text) {
  // Zero-width space, zero-width non-joiner, zero-width joiner, BOM/zero-width
  // no-break space, soft hyphen — built from char codes to avoid embedding
  // literal invisible bytes in this source file.
  var codes = [0x200b, 0x200c, 0x200d, 0xfeff, 0x00ad];
  var pattern = codes.map(function (c) {
    return String.fromCharCode(c);
  }).join("");
  var re = new RegExp("[" + pattern + "]", "g");
  return text.replace(re, "");
}

function extractBody(payload) {
  if (!payload) return "";
  let plain = "";
  let html = "";

  function walk(part) {
    if (!part) return;
    const mime = part.mimeType || "";
    if (mime === "text/plain" && part.body && part.body.data) {
      plain += decodeBase64Url(part.body.data);
    } else if (mime === "text/html" && part.body && part.body.data) {
      html += decodeBase64Url(part.body.data);
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);

  if (plain.trim()) return stripInvisible(plain);
  if (html.trim()) return stripInvisible(stripHtml(html));
  return "";
}

function getHeader(payload, name) {
  const h = (payload.headers || []).find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );
  return h ? h.value : "";
}

function parseAmountFromText(text, regexStr) {
  if (!regexStr) return null;
  let re;
  try {
    re = new RegExp(regexStr);
  } catch (e) {
    return null;
  }
  const m = text.match(re);
  if (!m || !m[1]) return null;
  const num = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

function daysAgoDateString(days) {
  const d = new Date(Date.now() - days * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

// Fetch new messages for one card rule and return newly created transactions.
async function syncCard(card, searchDays) {
  const query = `${card.query} after:${daysAgoDateString(searchDays)}`;
  const ids = await listAllMessageIds(query);
  const newIds = ids.filter((id) => !Storage.hasTransaction(id));
  const added = [];
  const debugSamples = [];
  let unmatched = 0;
  for (const id of newIds) {
    const msg = await gmailApi(`/messages/${id}`, { format: "full" });
    const body = extractBody(msg.payload);
    const amount = parseAmountFromText(body, card.amountRegex);
    if (amount === null) {
      unmatched++;
      if (debugSamples.length < 2) {
        debugSamples.push({
          cardName: card.name,
          subject: getHeader(msg.payload, "Subject"),
          bodySample: body.slice(0, 1500),
        });
      }
      continue; // regex didn't match this email
    }
    const subject = getHeader(msg.payload, "Subject");
    const dateISO = new Date(Number(msg.internalDate)).toISOString();
    const tx = {
      id,
      cardId: card.id,
      cardName: card.name,
      amount,
      dateISO,
      subject,
    };
    if (Storage.addTransaction(tx)) added.push(tx);
  }
  return { scanned: ids.length, added, unmatched, debugSamples };
}

async function syncAllCards(clientId, cards, searchDays, onProgress) {
  await ensureToken(clientId);
  let totalAdded = 0;
  let totalScanned = 0;
  const errors = [];
  const perCard = [];
  const debugSamples = [];
  for (const card of cards) {
    try {
      onProgress && onProgress(`${card.name} を確認中...`);
      const { scanned, added, unmatched, debugSamples: samples } = await syncCard(card, searchDays);
      totalScanned += scanned;
      totalAdded += added.length;
      perCard.push({ name: card.name, scanned, added: added.length, unmatched });
      debugSamples.push(...samples);
    } catch (e) {
      errors.push(`${card.name}: ${e.message}`);
    }
  }
  Storage.setLastSyncAt(new Date().toISOString());
  return { totalAdded, totalScanned, errors, perCard, debugSamples };
}
