export function shouldSendTutorOnEnter(event: { key: string; shiftKey: boolean; isComposing: boolean }, mobile: boolean) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing && !mobile;
}

export const shouldPrepareVocabList = (content: string, hasThread: boolean) => {
  if (hasThread) return false;
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 5 && lines.reduce((sum, line) => sum + line.split(/\s+/).length, 0) / lines.length <= 8;
};


export const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export const voiceErrorMessage = (error: unknown) => {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return "Microphone access is blocked. Allow it in your browser or Home Screen app settings and try again.";
  }
  if (error instanceof Error) return error.message;
  return "Voice recording failed.";
};
