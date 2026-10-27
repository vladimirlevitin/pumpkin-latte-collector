import {createHandler} from './handler.mjs';
// No deployment was performed. Set secrets only on a separate staging project.
Deno.serve(createHandler({env:{
 SUPABASE_URL:Deno.env.get('SUPABASE_URL'),
 SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
 GEMINI_API_KEY:Deno.env.get('GEMINI_API_KEY'),
 ALLOWED_ORIGIN:Deno.env.get('ALLOWED_ORIGIN'),
}}));
