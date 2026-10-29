// Seven Wellness Club store orders (Shopify Admin GraphQL API).
// Either SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Dev Dashboard app, client-credentials grant).
import { env, HttpError } from './core.js';

let tok = null; // {value, exp}
async function token() {
  if (env('SHOPIFY_ADMIN_TOKEN')) return env('SHOPIFY_ADMIN_TOKEN');
  if (tok && tok.exp > Date.now() + 60000) return tok.value;
  const shop = env('SHOPIFY_SHOP');
  const r = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env('SHOPIFY_CLIENT_ID'), client_secret: env('SHOPIFY_CLIENT_SECRET') })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new HttpError(502, 'needs_reauth', 'Shopify token request failed: ' + (j.error_description || j.error || r.status));
  tok = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 86000) * 1000 };
  return tok.value;
}

const Q = `query Orders($first:Int!,$query:String){
  orders(first:$first, query:$query, sortKey:CREATED_AT, reverse:true){
    nodes{ name createdAt displayFinancialStatus totalPriceSet{ shopMoney{ amount currencyCode } } }
  }
  ordersCount(query:$query){ count }
}`;

export async function listOrders(args) {
  const shop = env('SHOPIFY_SHOP');
  if (!shop) throw new HttpError(400, 'server_not_connected', 'Shopify is not set up');
  const r = await fetch(`https://${shop}.myshopify.com/admin/api/${env('SHOPIFY_API_VERSION', '2026-07')}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await token() },
    body: JSON.stringify({ query: Q, variables: { first: Math.min(100, Number(args.first) || 50), query: args.query || null } })
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw new HttpError(502, 'needs_reauth', 'Shopify rejected the token');
  if (!r.ok || j.errors) throw new HttpError(502, 'shopify_error', JSON.stringify(j.errors || r.status).slice(0, 300));
  const nodes = (j.data && j.data.orders && j.data.orders.nodes) || [];
  return {
    totalCount: (j.data && j.data.ordersCount && j.data.ordersCount.count) ?? nodes.length,
    orders: nodes.map(o => ({ name: o.name, createdAt: o.createdAt, financialStatus: o.displayFinancialStatus, totalPrice: o.totalPriceSet && o.totalPriceSet.shopMoney.amount, currencyCode: o.totalPriceSet && o.totalPriceSet.shopMoney.currencyCode }))
  };
}
