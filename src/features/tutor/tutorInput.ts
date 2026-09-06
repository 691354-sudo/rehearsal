export function shouldSendTutorOnEnter(event: { key: string; shiftKey: boolean; isComposing: boolean }, mobile: boolean) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing && !mobile;
}
