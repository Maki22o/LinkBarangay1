// LinkBarangay off-site backup: database records + private uploaded files.
// Required secrets:
// GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_DRIVE_BACKUP_FOLDER_ID,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.  Optional: BACKUP_CRON_TOKEN.
// The Drive root folder must be shared with the service-account email as Editor.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-schedule-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const tables = [
  "lb_profiles", "lb_barangays", "lb_departments", "lb_service_categories", "lb_settings",
  "lb_service_requests", "lb_request_updates", "lb_assignments", "lb_appointments",
  "lb_attachments", "lb_audit_logs", "lb_notifications", "lb_resident_verifications",
  "lb_dispatcher_availability", "lb_field_working_hours", "lb_field_unavailability", "lb_support_requests",
];
const buckets = ["request-attachments", "resident-verification-ids"];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const base64url = (input: Uint8Array | string) => {
  const value = typeof input === "string" ? btoa(input) : btoa(String.fromCharCode(...input));
  return value.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};
const pemToBytes = (pem: string) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), c => c.charCodeAt(0));

async function googleToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")! }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description ?? "Google authorization failed");
  return data.access_token as string;
}

async function createFolder(token: string, name: string, parent?: string) {
  const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parent ? { parents: [parent] } : {}) }),
  });
  const data = await response.json();
  if (!response.ok || !data.id) throw new Error(data.error?.message ?? `Could not create Drive folder ${name}`);
  return data.id as string;
}

async function upload(token: string, parent: string, name: string, content: Blob | string, mimeType: string) {
  const metadata = JSON.stringify({ name, parents: [parent], mimeType });
  const boundary = `backup_${crypto.randomUUID()}`;
  const payload = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, content, `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": payload.type }, body: payload,
  });
  const data = await response.json();
  if (!response.ok || !data.id) throw new Error(data.error?.message ?? `Could not upload ${name}`);
  return data.id as string;
}

async function allRows(admin: ReturnType<typeof createClient>, table: string) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function listFiles(admin: ReturnType<typeof createClient>, bucket: string, prefix = ""): Promise<{ name: string; id?: string }[]> {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error(`${bucket}: ${error.message}`);
  const files: { name: string; id?: string }[] = [];
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) files.push({ name: path, id: item.id }); else files.push(...await listFiles(admin, bucket, path));
  }
  return files;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey || !Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || !Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")) return json({ error: "Backup function secrets are incomplete" }, 503);
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const scheduleToken = req.headers.get("x-backup-schedule-token");
    const expectedToken = Deno.env.get("BACKUP_CRON_TOKEN");
    let actorId: string | null = null;
    const scheduled = Boolean(expectedToken && scheduleToken === expectedToken);
    if (!scheduled) {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: user } = await admin.auth.getUser(token);
      if (!user.user) return json({ error: "Missing or invalid authorization" }, 401);
      const { data: profile } = await admin.from("lb_profiles").select("role,status").eq("id", user.user.id).maybeSingle();
      if (!profile || profile.role !== "admin" || profile.status !== "active") return json({ error: "Administrator access is required" }, 403);
      actorId = user.user.id;
    }
    const { data: run, error: runError } = await admin.from("lb_backup_runs").insert({ trigger_source: scheduled ? "scheduled" : "manual", created_by: actorId }).select("id").single();
    if (runError || !run) throw new Error(runError?.message ?? "Could not create backup audit record");
    try {
      const { data: oauth } = await admin.from("lb_google_drive_backup_oauth").select("refresh_token,drive_folder_id").eq("id", true).maybeSingle();
      if (!oauth) throw new Error("Google Drive is not connected by an administrator");
      const token = await googleToken(oauth.refresh_token);
      const root = oauth.drive_folder_id || await createFolder(token, "LinkBarangay Automated Backups");
      if (!oauth.drive_folder_id) await admin.from("lb_google_drive_backup_oauth").update({ drive_folder_id: root }).eq("id", true);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const runFolder = await createFolder(token, `backup-${stamp}`, root);
      const databaseFolder = await createFolder(token, "database", runFolder);
      const storageFolder = await createFolder(token, "storage", runFolder);
      let rowCount = 0, fileCount = 0;
      for (const table of tables) {
        const rows = await allRows(admin, table); rowCount += rows.length;
        await upload(token, databaseFolder, `${table}.json`, JSON.stringify({ exported_at: new Date().toISOString(), table, rows }), "application/json");
      }
      for (const bucket of buckets) for (const file of await listFiles(admin, bucket)) {
        const { data, error } = await admin.storage.from(bucket).download(file.name);
        if (error || !data) throw new Error(`${bucket}/${file.name}: ${error?.message ?? "download failed"}`);
        await upload(token, storageFolder, `${bucket}__${file.name.replaceAll("/", "__")}`, data, data.type || "application/octet-stream");
        fileCount++;
      }
      const manifest = { version: 1, created_at: new Date().toISOString(), database_rows: rowCount, storage_files: fileCount, tables, buckets };
      await upload(token, runFolder, "manifest.json", JSON.stringify(manifest, null, 2), "application/json");
      await admin.from("lb_backup_runs").update({ status: "completed", completed_at: new Date().toISOString(), drive_folder_id: runFolder, database_rows: rowCount, storage_files: fileCount }).eq("id", run.id);
      return json({ ok: true, runId: run.id, driveFolderId: runFolder, databaseRows: rowCount, storageFiles: fileCount });
    } catch (error) {
      await admin.from("lb_backup_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_message: error instanceof Error ? error.message.slice(0, 1000) : "Unknown error" }).eq("id", run.id);
      throw error;
    }
  } catch (error) {
    console.error("backup-to-google-drive failed", error);
    return json({ error: error instanceof Error ? error.message : "Backup failed" }, 500);
  }
});
