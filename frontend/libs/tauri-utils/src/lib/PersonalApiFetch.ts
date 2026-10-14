import { invoke } from "@tauri-apps/api/core";

// Preserve the original API call sites while serving their local equivalents.
// Provider generation and keys stay in Rust. This bridge has no API credentials.
export async function PersonalApiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response | null> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith("/v1/") || ![
    "personal.artcraft.local", "studio.storyteller.ai", "api.storyteller.ai",
    "api.fakeyou.com", "studio.fakeyou.com",
  ].includes(parsed.hostname)) return null;

  const method = init?.method || (input instanceof Request ? input.method : "GET");
  const source = init?.body;
  let body: unknown = null;
  const files: { field: string; name: string; mime: string; base64: string }[] = [];
  if (source instanceof FormData) {
    const values: Record<string, string> = {};
    for (const [field, value] of source.entries()) {
      if (typeof value === "string") values[field] = value;
      else {
        if (value.size > 512 * 1024 * 1024) throw new Error("文件超过 512 MB");
        const bytes = new Uint8Array(await value.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        files.push({ field, name: value.name || "upload.bin", mime: value.type, base64: btoa(binary) });
      }
    }
    body = values;
  } else if (typeof source === "string" && source) {
    body = JSON.parse(source);
  }
  try {
    const payload = await invoke("personal_api_request_command", { request: { url, method, body, files } });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error_message: String(error), error_reason: String(error), errorMessage: String(error) }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
}
