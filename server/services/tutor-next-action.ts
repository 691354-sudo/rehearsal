/** Guided replies must leave a usable next step even when the model closes a round. */
export const withGuidedNextAction = (content: string, mode: string) => {
  if (mode !== "guided" || /^\s*#{1,3}\s+(?:Next task|Your turn)\s*\n\s*\S/im.test(content)) return content;
  return `${content}\n\n### Next Task\nЧтобы продолжить практику, напишите «Дальше». Чтобы закончить и подготовить карточки из этой беседы, нажмите Create cards — вы сможете проверить их перед сохранением.`;
};
