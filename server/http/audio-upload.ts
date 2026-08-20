const audioUploadExtensions = new Map([
  ["audio/mp4", "m4a"],
  ["audio/m4a", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["video/mp4", "mp4"],
  ["audio/webm", "webm"],
  ["video/webm", "webm"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
]);

export const audioUploadExtension = (mimeType: string) =>
  audioUploadExtensions.get(mimeType.toLocaleLowerCase().split(";")[0]);
