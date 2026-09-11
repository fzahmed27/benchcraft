import { catalogue,recipes } from '@/lib/bench';
export function GET(){return Response.json({parts:catalogue,recipes,pricing:'Illustrative USD estimates, not supplier quotes',hardwareConnected:false});}
