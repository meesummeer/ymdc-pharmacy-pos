const MAX_BYTES = 90 * 1024 * 1024;
const FILENAME_RE = /^PharmacyPilot-backup-(\d{4})-(\d{2})-\d{2}_\d{4}\.zip$/;
const SHA256_RE = /^[0-9a-fA-F]{64}$/;

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Sha256, X-Filename',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

// Returns null when the caller is a signed-in admin, otherwise the error Response.
async function requireAdmin(request, env, cors) {
  const match = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  if (!match) return json({ error: 'Sign in required' }, 401, cors);
  let res;
  try {
    res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_my_role`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${match[1]}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch {
    return json({ error: 'Could not verify sign-in' }, 401, cors);
  }
  if (res.status !== 200) return json({ error: 'Sign in required' }, 401, cors);
  let role;
  try { role = await res.json(); } catch { role = null; }
  if (role !== 'admin') return json({ error: 'Admins only' }, 403, cors);
  return null;
}

async function handleUpload(request, env, cors) {
  const length = Number(request.headers.get('Content-Length'));
  if (!request.headers.has('Content-Length') || !Number.isFinite(length) || length <= 0 || length > MAX_BYTES) {
    return json({ error: 'Content-Length is required and must be under 90 MB' }, 413, cors);
  }
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'application/zip') {
    return json({ error: 'Content-Type must be application/zip' }, 415, cors);
  }
  const sha256 = request.headers.get('X-Sha256') || '';
  if (!SHA256_RE.test(sha256)) return json({ error: 'X-Sha256 must be 64 hex characters' }, 400, cors);
  const filename = request.headers.get('X-Filename') || '';
  const name = FILENAME_RE.exec(filename);
  if (!name) return json({ error: 'X-Filename is not a valid backup file name' }, 400, cors);

  const key = `backups/${name[1]}/${name[2]}/${filename}`;
  if (await env.BACKUPS.head(key)) return json({ error: 'A backup with this name already exists' }, 409, cors);

  let object;
  try {
    object = await env.BACKUPS.put(key, request.body, {
      sha256: sha256.toLowerCase(),
      httpMetadata: { contentType: 'application/zip' },
      customMetadata: { uploadedAt: new Date().toISOString() },
      onlyIf: { etagDoesNotMatch: '*' }, // never overwrite, even if two uploads race
    });
  } catch (err) {
    if (/checksum|digest|sha-?256/i.test(String(err && err.message))) {
      return json({ error: 'Checksum mismatch: the upload was corrupted in transit' }, 422, cors);
    }
    throw err;
  }
  if (!object) return json({ error: 'A backup with this name already exists' }, 409, cors);
  return json({ key, size: object.size }, 201, cors);
}

async function handleList(env, cors) {
  const items = [];
  let cursor;
  do {
    const page = await env.BACKUPS.list({ prefix: 'backups/', cursor });
    page.objects.forEach(o => items.push({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() }));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  items.sort((a, b) => (a.uploaded < b.uploaded ? 1 : a.uploaded > b.uploaded ? -1 : 0));
  return json(items, 200, cors);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    let cors = {};
    if (origin) {
      const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!allowed.includes(origin)) return json({ error: 'Origin not allowed' }, 403, {});
      cors = corsHeaders(origin);
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      const denied = await requireAdmin(request, env, cors);
      if (denied) return denied;

      const { pathname } = new URL(request.url);
      if (request.method === 'POST' && pathname === '/upload') return await handleUpload(request, env, cors);
      if (request.method === 'GET' && pathname === '/list') return await handleList(env, cors);
      return json({ error: 'Not found' }, 404, cors);
    } catch {
      return json({ error: 'Internal error' }, 500, cors);
    }
  },
};
