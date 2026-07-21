// Cloudflare Pages Function — syncs app data from devices without a GitHub token

export async function onRequestPost(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const body = await context.request.json();
    const { patch } = body; // patch = subset of appData fields to merge in

    if (!patch || typeof patch !== 'object')
      return Response.json({ error: 'No patch provided' }, { status: 400, headers: cors });

    const token = context.env.GITHUB_TOKEN;
    if (!token) return Response.json({ error: 'Server not configured' }, { status: 500, headers: cors });

    const API = 'https://api.github.com/repos/hoguewd/hoguemarathon/contents/data.json';
    const gh = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'hoguemarathon',
    };

    // Fetch current data.json
    const res = await fetch(API, { headers: gh });
    if (!res.ok) throw new Error('Could not load data.json');
    const file = await res.json();
    const sha = file.sha;
    const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));

    // Merge allowed fields only — prevent overwriting market/comments with stale data
    const ALLOWED = ['done','notes','dayEdits','dayOrders','vdot','stravaActuals','stravaActivities','stravaLastSync'];
    for (const key of ALLOWED) {
      if (patch[key] === undefined) continue;
      if (key === 'done' || key === 'dayEdits' || key === 'dayOrders' || key === 'notes') {
        // Deep merge objects
        if (!data[key]) data[key] = {};
        Object.assign(data[key], patch[key]);
        // Remove null/undefined entries (deletions)
        for (const k of Object.keys(patch[key])) {
          if (patch[key][k] === null || patch[key][k] === undefined) delete data[key][k];
        }
      } else {
        data[key] = patch[key];
      }
    }
    data.updatedAt = Date.now();

    const json2 = JSON.stringify(data, null, 2);
    const content = btoa(String.fromCharCode(...new TextEncoder().encode(json2)));
    const put = await fetch(API, {
      method: 'PUT', headers: gh,
      body: JSON.stringify({ message: 'Sync from device', content, sha }),
    });
    if (!put.ok) {
      const e = await put.json();
      if (put.status === 409) return Response.json({ error: 'conflict', retry: true }, { status: 409, headers: cors });
      throw new Error(e.message || 'Write failed');
    }
    return Response.json({ ok: true }, { headers: cors });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: cors });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
}
