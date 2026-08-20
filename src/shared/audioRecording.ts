export const maxRecordingBytes = 25 * 1024 * 1024;
export const maxRecordingSeconds = 5 * 60;

const preferredMimeTypes = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

export const supportedRecordingMimeType = () => {
  if (typeof MediaRecorder === "undefined") return null;
  return preferredMimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) || null;
};

export const recordingFilename = (prefix: string, mimeType: string) =>
  `${prefix}.${mimeType.includes("mp4") ? "m4a" : "webm"}`;
