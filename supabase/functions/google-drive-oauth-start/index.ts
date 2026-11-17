import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":Deno.env.get("ALLOWED_ORIGIN")??"","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL")!, key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, clientId=Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!;
  const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const token=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,""); const {data:{user}}=await admin.auth.getUser(token);
  const {data:profile}=user?await admin.from("lb_profiles").select("role,status").eq("id",user.id).maybeSingle():{data:null};
  if(!user||!profile||profile.role!=="admin"||profile.status!=="active") return json({error:"Administrator access is required"},403);
  const {data:state,error}=await admin.from("lb_google_drive_oauth_states").insert({user_id:user.id}).select("state").single();
  if(error||!state)return json({error:"Could not start Google authorization"},500);
  const redirect=`${url}/functions/v1/google-drive-oauth-callback`;
  const authorizationUrl="https://accounts.google.com/o/oauth2/v2/auth?"+new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:"code",scope:"https://www.googleapis.com/auth/drive.file",access_type:"offline",prompt:"consent",state:state.state}).toString();
  return json({authorizationUrl});
});
