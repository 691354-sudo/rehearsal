import type { LanguageCode } from "../types.js";

const nextActions: Record<LanguageCode, string> = {
  en: 'To keep practising, write "Continue". To finish, write "Finish". You can also use Create cards to review suggested cards before saving.',
  lv: 'Lai turpinātu vingrināties, raksti “Turpināt”. Lai beigtu, raksti “Beigt”. Ar Create cards vari pārskatīt ieteiktās kartītes pirms saglabāšanas.',
  de: 'Schreibe „Weiter“, um weiterzuüben, oder „Beenden“, um aufzuhören. Mit Create cards kannst du vorgeschlagene Karten vor dem Speichern prüfen.',
  vi: 'Để luyện tập tiếp, hãy viết “Tiếp tục”. Để kết thúc, hãy viết “Kết thúc”. Bạn cũng có thể dùng Create cards để xem lại các thẻ được gợi ý trước khi lưu.',
  no: 'Skriv «Fortsett» for å øve videre, eller «Avslutt» for å avslutte. Med Create cards kan du se gjennom foreslåtte kort før du lagrer dem.',
  id: 'Tulis “Lanjut” untuk terus berlatih, atau “Selesai” untuk mengakhiri. Kamu juga bisa memakai Create cards untuk meninjau kartu yang disarankan sebelum menyimpannya.',
};

/** Guided replies must leave a usable next step even when the model closes a round. */
export const withGuidedNextAction = (content: string, mode: string, language: LanguageCode = "en") => {
  if (mode !== "guided" || /^\s*#{1,3}\s+(?:Next task|Your turn)\s*\n\s*\S/im.test(content)) return content;
  return `${content}\n\n### Next Task\n\n${nextActions[language]}`;
};
