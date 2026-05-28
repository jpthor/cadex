export function isTauriRuntime() {
  return Boolean((window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export function friendlyError(error: unknown) {
  const text = String(error);
  if (text.includes("status 520") || text.includes("responded but did not change")) {
    return "I could not turn that request into a CAD change. Try naming the part, size, and starting plane.";
  }
  if (text.includes("insufficient_quota")) {
    return "Your OpenAI quota is currently exhausted. Check billing or choose another API key in Settings.";
  }
  if (text === "null" || text.trim() === "") {
    return "The desktop AI bridge did not return a usable response.";
  }
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}
