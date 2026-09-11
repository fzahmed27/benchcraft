import {env} from 'cloudflare:workers';
export function GET(){return Response.json({aiConnected:!!(env as unknown as Record<string,string>).OPENAI_API_KEY,hardwareConnected:false},{headers:{'Cache-Control':'no-store'}});}
