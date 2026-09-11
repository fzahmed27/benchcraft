import { env } from 'cloudflare:workers';
export function database(){if(!env.DB)throw new Error('Project storage unavailable');return env.DB;}
export function guard(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Request origin not allowed'},{status:403});return null;}
export async function jsonBody(request:Request){const text=await request.text();if(text.length>15000)throw new Error('Request too large');return JSON.parse(text);}
