import { supabase } from "@/lib/supabase"

export const MAX_RESIDENT_ID_BYTES = 10 * 1024 * 1024
const ID_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"])

export function validateResidentId(file: File): void {
  if (!ID_MIME_TYPES.has(file.type)) throw new Error("Upload a JPG, PNG, WebP, or PDF identification document.")
  if (!file.size || file.size > MAX_RESIDENT_ID_BYTES) throw new Error("The ID file must be under 10 MB.")
}

export async function submitResidentId(userId: string, file: File): Promise<void> {
  validateResidentId(file)
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 100)
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`
  const { error: uploadError } = await supabase.storage
    .from("resident-verification-ids")
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) throw new Error(uploadError.message)

  const { error } = await supabase.rpc("app_submit_resident_verification", {
    p_storage_path: path,
    p_file_name: file.name.slice(0, 180),
    p_mime_type: file.type,
    p_size_bytes: file.size,
  })
  if (error) {
    await supabase.storage.from("resident-verification-ids").remove([path])
    throw new Error(error.message)
  }
}

export async function signedResidentIdUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("resident-verification-ids")
    .createSignedUrl(path, 300)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

export async function reviewResidentId(
  userId: string,
  decision: "approved" | "rejected",
  reason = "",
): Promise<void> {
  const { error } = await supabase.rpc("app_review_resident_verification", {
    p_user_id: userId,
    p_decision: decision,
    p_reason: reason.trim() || null,
  })
  if (error) throw new Error(error.message)
}
