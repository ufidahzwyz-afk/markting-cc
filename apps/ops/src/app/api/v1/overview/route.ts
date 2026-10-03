import {authenticate} from '@/lib/server-context';
import {getWorkspaceOverview} from '@boran/domain/workspace';
import {jsonData,errorResponse} from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const ctx=await authenticate(request.headers);return jsonData(await getWorkspaceOverview(ctx),200,{mode:ctx.mode});}catch(error){return errorResponse(error);}}
