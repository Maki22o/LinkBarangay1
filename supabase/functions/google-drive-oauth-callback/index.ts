import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
Deno.serve(async(req)=>{
 const u=new URL(req.url), code=u.searchParams.get("code"), state=u.searchParams.get("state");
 const url=Deno.env.get("SUPABASE_URL")!, key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, id=Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!, secret=Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!;
 const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:row}=state?await admin.from("lb_google_drive_oauth_states").select("user_id,expires_at").eq("state",state).maybeSingle():{data:null};
 if(!code||!row||new Date(row.expires_at)<new Date()) return new Response("Google Drive authorization expired. Return to LinkBarangay and try again.",{status:400});
 const token=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:id,client_secret:secret,redirect_uri:`${url}/functions/v1/google-drive-oauth-callback`,grant_type:"authorization_code"})});
 const data=await token.json(); if(!token.ok||!data.refresh_token)return new Response("Google did not return a refresh token. Please try again.",{status:400});
 await admin.from("lb_google_drive_backup_oauth").upsert({id:true,refresh_token:data.refresh_token,drive_folder_id:null,connected_at:new Date().toISOString(),connected_by:row.user_id}); await admin.from("lb_google_drive_oauth_states").delete().eq("state",state);
 return new Response("Google Drive is connected. You may close this tab and return to LinkBarangay.",{headers:{"Content-Type":"text/plain"}});
});
