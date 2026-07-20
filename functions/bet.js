// Cloudflare Pages Function — handles bet and cash-out for users without a GitHub token

const MKT_B = 20;
const MKT_INIT_BAL = 10;

function lmsrCost(q, b) {
  return b * Math.log(q.reduce((s, qi) => s + Math.exp(qi / b), 0));
}
function lmsrBuyCost(q, i, shares, b) {
  const nq = [...q]; nq[i] += shares;
  return lmsrCost(nq, b) - lmsrCost(q, b);
}
function lmsrSellReturn(q, i, shares, b) {
  const nq = [...q]; nq[i] = Math.max(0, nq[i] - shares);
  return lmsrCost(q, b) - lmsrCost(nq, b);
}
function lmsrProbs(q, b) {
  const exps = q.map(qi => Math.exp(qi / b));
  const sum = exps.reduce((a, v) => a + v, 0);
  return exps.map(e => e / sum);
}
function lmsrSharesForDollars(q, i, dollars, b) {
  let lo = 0, hi = dollars * 50;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    lmsrBuyCost(q, i, mid, b) < dollars ? lo = mid : hi = mid;
  }
  return (lo + hi) / 2;
}

export async function onRequestPost(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const { name, outcome, dollars, action } = await context.request.json();
    if (!name?.trim()) return Response.json({ error: 'Name required' }, { status: 400, headers: cors });

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
    if (!res.ok) throw new Error('Could not load data');
    const file = await res.json();
    const sha = file.sha;
    const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));

    // Init market if missing
    if (!data.market) data.market = { b: MKT_B, q: [0, 12.5, 18.6, 4.7], resolved: null, trades: [] };
    if (!data.portfolios) data.portfolios = {};

    if (data.market.resolved !== null) throw new Error('Market already resolved');

    const mkt = data.market;
    const b = mkt.b || MKT_B;

    // Init portfolio for new user
    if (!data.portfolios[name]) {
      data.portfolios[name] = { balance: MKT_INIT_BAL, positions: [0,0,0,0], buyCosts: [0,0,0,0] };
    }
    const portfolio = data.portfolios[name];

    if (action === 'buy') {
      const amt = parseFloat(dollars);
      if (!amt || amt < 0.5) throw new Error('Minimum bet is $0.50');
      if (amt > portfolio.balance) throw new Error(`Not enough balance ($${portfolio.balance.toFixed(2)})`);
      if (outcome < 0 || outcome > 3) throw new Error('Invalid outcome');

      const probs = lmsrProbs(mkt.q, b);
      const shares = lmsrSharesForDollars(mkt.q, outcome, amt, b);
      const actualCost = lmsrBuyCost(mkt.q, outcome, shares, b);

      mkt.q[outcome] += shares;
      portfolio.balance -= actualCost;
      portfolio.positions[outcome] = (portfolio.positions[outcome] || 0) + shares;
      portfolio.buyCosts[outcome] = (portfolio.buyCosts[outcome] || 0) + actualCost;
      mkt.trades.unshift({ name, outcome, shares, amt: actualCost, price: probs[outcome], type: 'buy', ts: Date.now() });
      if (mkt.trades.length > 50) mkt.trades.length = 50;

    } else if (action === 'sell') {
      const shares = portfolio.positions[outcome] || 0;
      if (shares <= 0) throw new Error('No shares to sell');

      const probs = lmsrProbs(mkt.q, b);
      const sellReturn = lmsrSellReturn(mkt.q, outcome, shares, b);

      mkt.q[outcome] = Math.max(0, mkt.q[outcome] - shares);
      portfolio.balance += sellReturn;
      portfolio.positions[outcome] = 0;
      portfolio.buyCosts[outcome] = 0;
      mkt.trades.unshift({ name, outcome, shares, amt: sellReturn, price: probs[outcome], type: 'sell', ts: Date.now() });
      if (mkt.trades.length > 50) mkt.trades.length = 50;

    } else {
      throw new Error('Unknown action');
    }

    data.updatedAt = Date.now();
    const json2 = JSON.stringify(data, null, 2);
    const content = btoa(String.fromCharCode(...new TextEncoder().encode(json2)));
    const put = await fetch(API, {
      method: 'PUT', headers: gh,
      body: JSON.stringify({ message: `${action} by ${name}`, content, sha }),
    });
    if (!put.ok) {
      const e = await put.json();
      // 409 = conflict (someone else bet at same time) — tell client to retry
      if (put.status === 409) return Response.json({ error: 'conflict', retry: true }, { status: 409, headers: cors });
      throw new Error(e.message || 'Write failed');
    }

    return Response.json({ ok: true, newQ: data.market.q, portfolio: data.portfolios[name] }, { headers: cors });
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
