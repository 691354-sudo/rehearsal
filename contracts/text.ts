export const normalizeNfc = (value: string) => value.normalize("NFC");

export const focusTermsInTarget = (target: string, focusTerms: string[]) => {
  const normalizedTarget = normalizeNfc(target).toLocaleLowerCase();
  return focusTerms.every((term) => normalizedTarget.includes(normalizeNfc(term.trim()).toLocaleLowerCase()));
};
