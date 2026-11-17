import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ChatMessage = { role: "user" | "assistant"; content: string };

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN");
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN ?? "",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const systemPrompt = `You are the LinkBarangay Help Assistant for a Philippine barangay service-request portal. Answer only general questions about using LinkBarangay: account approval, valid-address ID verification, submitting and tracking service requests, evidence uploads, priorities, appointments, notifications, and the Resident, Barangay Staff, Dispatcher, and Admin workflows. Be concise, friendly, and use plain English or Filipino/Taglish matching the user. Do not invent account status, request details, policies, contact numbers, or actions. You cannot access, change, submit, delete, approve, schedule, or track a user's account or request. Never ask for passwords, OTPs, valid IDs, full home addresses, personal contact details, or other sensitive information. For urgent public-safety emergencies, say to contact local emergency services immediately. If the issue needs account-specific investigation, recommend creating a support ticket.`;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function validMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return null;
  const messages: ChatMessage[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || (row.role !== "user" && row.role !== "assistant") || typeof row.content !== "string") return null;
    const content = row.content.trim();
    if (!content || content.length > 1200) return null;
    messages.push({ role: row.role, content });
  }
  return messages[messages.length - 1]?.role === "user" ? messages : null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  // A browser preflight must succeed before the authenticated POST can be
  // sent. Do not make it depend on third-party AI configuration.
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // Read and normalize the key inside the request handler so a newly updated
  // Edge Function secret is always used by new isolates.
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!ALLOWED_ORIGIN || !openRouterApiKey) {
    const missing = [!ALLOWED_ORIGIN && "ALLOWED_ORIGIN", !openRouterApiKey && "OPENROUTER_API_KEY"].filter(Boolean).join(", ");
    return response({ error: `Help assistant configuration is missing: ${missing}.` }, 503);
  }
  if (!openRouterApiKey.startsWith("sk-or-v1-")) return response({ error: "The OpenRouter API key is invalid. Replace OPENROUTER_API_KEY in Edge Function Secrets." }, 503);
  if (origin && origin !== ALLOWED_ORIGIN) return response({ error: "Origin is not allowed." }, 403);
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !serviceRoleKey || !token) return response({ error: "Authentication is required." }, 401);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return response({ error: "Your session has expired. Please sign in again." }, 401);

  const body = await req.json().catch(() => null);
  const messages = validMessages(body?.messages);
  if (!messages) return response({ error: "Send 1 to 10 short chat messages ending with a user question." }, 400);

  try {
    const upstreamHeaders = new Headers();
    upstreamHeaders.set("Authorization", `Bearer ${openRouterApiKey}`);
    upstreamHeaders.set("Content-Type", "application/json");
    upstreamHeaders.set("HTTP-Referer", ALLOWED_ORIGIN);
    upstreamHeaders.set("X-Title", "LinkBarangay Help Assistant");
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify({ model: OPENROUTER_MODEL, messages: [{ role: "system", content: systemPrompt }, ...messages], max_tokens: 350, temperature: 0.2 }),
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) return response({ error: data?.error?.message || "The help assistant is temporarily unavailable." }, upstream.status === 429 ? 429 : 502);
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) return response({ error: "The help assistant returned no answer." }, 502);
    return response({ answer: answer.trim() });
  } catch (error) {
    console.error("linkbarangay-help-chat failed", error);
    return response({ error: "The help assistant is temporarily unavailable." }, 502);
  }
});
