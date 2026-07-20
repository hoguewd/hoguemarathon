// Cloudflare Pages Function — handles comment + reply submissions

export async function onRequestPost(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const { name, message, replyTo } = await context.request.json();
    if (!name?.trim() || !message?.trim())
      return Response.json({ error: 'Name and message required' }, { status: 400, headers: cors });

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

    const res = await fetch(API, { headers: gh });
    if (!res.ok) throw new Error('Could not load data.json');
    const file = await res.json();
    const sha  = file.sha;
    const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
    const data  = JSON.parse(new TextDecoder().decode(bytes));

    if (replyTo !== undefined && replyTo !== null) {
      // Add reply to existing comment
      const idx = parseInt(replyTo);
      if (!Array.isArray(data.comments) || !data.comments[idx])
        throw new Error('Comment not found');
      if (!Array.isArray(data.comments[idx].replies)) data.comments[idx].replies = [];
      data.comments[idx].replies.push({
        name: name.trim().slice(0, 50),
        message: message.trim().slice(0, 500),
        ts: Date.now(),
      });
    } else {
      // New top-level comment
      if (!Array.isArray(data.comments)) data.comments = [];
      data.comments.unshift({
        name: name.trim().slice(0, 50),
        message: message.trim().slice(0, 500),
        ts: Date.now(),
      });
      if (data.comments.length > 200) data.comments.length = 200;
    }
    data.updatedAt = Date.now();

    const json2   = JSON.stringify(data, null, 2);
    const content = btoa(String.fromCharCode(...new TextEncoder().encode(json2)));
    const put = await fetch(API, {
      method: 'PUT', headers: gh,
      body: JSON.stringify({ message: replyTo !== undefined ? `Reply from ${name.trim()}` : `Comment from ${name.trim()}`, content, sha }),
    });
    if (!put.ok) { const e = await put.json(); throw new Error(e.message || 'Write failed'); }

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
