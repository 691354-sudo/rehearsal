import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { LanguageCode, ReviewCandidate } from "../types.js";
import type { LearnerPersona } from "./learner-persona.js";
import { normalizeNfc } from "../../contracts/text.js";

const targetLanguages: Record<LanguageCode, { name: string; guidance: string }> = {
  en: { name: "English", guidance: "Use natural contemporary English." },
  lv: { name: "Latvian", guidance: "Use natural contemporary Latvian." },
  vi: {
    name: "Vietnamese",
    guidance: "Use neutral contemporary standard Vietnamese. Avoid strongly regional wording unless the source requires it.",
  },
  no: {
    name: "Norwegian Bokmål",
    guidance: "Use natural contemporary Norwegian Bokmål. Avoid dialect-specific or Nynorsk forms unless the source requires them.",
  },
  id: {
    name: "Bahasa Indonesia",
    guidance: "Use natural contemporary standard Indonesian. Prefer broadly understood informal-neutral wording and avoid region-specific slang or Malay forms unless the source requires them.",
  },
};

export const generatedCandidateSchema = z.object({
  target: z.string().min(1).max(2_000),
  cue: z.string().min(1).max(2_000),
  note: z.string().max(2_000),
  category: z.string().max(80),
  focusTerms: z.array(z.string().min(1).max(100)).max(8),
  pattern: z.string().max(500),
  disposition: z.enum(["active", "recognition", "skip"]),
  frequencyBand: z.enum(["core", "common", "specific", "rare"]),
  currency: z.enum(["current", "contextual", "dated", "uncertain"]),
  personaFit: z.number().int().min(1).max(5),
  naturalness: z.number().int().min(1).max(5),
  commonness: z.number().int().min(1).max(5),
});

export const generatedMaterialSchema = z.object({
  items: z.array(generatedCandidateSchema).max(100),
});

export const targetLanguageName = (language: LanguageCode) => targetLanguages[language].name;

export const vocabularyPreparationTask =
  "Classify the source before generating cards. If it is a foundational list of bare numbers or individual letters, " +
  "return exactly one atomic card per distinct source entry in the same order; use the source number or letter as cue " +
  "and its target-language name as target. If it is an explicit foundational cue-target pair list, preserve exactly one " +
  "pair per line. Keep every foundational unit active; do not triage, merge, or skip distinct requested units. " +
  "Otherwise triage up to 100 vocabulary entries, deduplicate inflections and near-duplicates, and create exactly one " +
  "natural personalized anchor utterance for each useful active term. Keep less useful but current terms as recognition, " +
  "mark outdated, bookish, or irrelevant entries as skip, and return no more than one candidate per distinct term or phrase.";

export const capturePreparationTask = (learnerName: string) =>
  "Treat these Notebook notes as one-shot card-preparation requests and source material. First classify the learner's " +
  "intent. If the learner directly asks Rehearsal to prepare cards, specifies their format, or supplies a clearly " +
  "standalone card-source list, prepare that material rather than treating it as a personal utterance. Follow explicit " +
  "instructions using the supplied material. Honor the requested quantity, order, and granularity, including every member of " +
  "stated " +
  "ranges or enumerations, up to 100 cards. 'One card for each number' means one separate active candidate per number. " +
  "Bare foundational units such as numbers or individual letters are valid atomic cards; do not add example sentences, " +
  "triage, merge, or skip distinct requested units. For numbers, use the exact numeral as cue and its target-language name " +
  "as target. A note such as 'сделай отдельную карточку для каждой цифры от 0 до " +
  "9, только цифра и её перевод' is an instruction to return 10 atomic cards. For an ordinary vocabulary list, triage " +
  "entries and create one useful contextual anchor utterance per active term. If there is no card-making request or list, " +
  "turn the Russian personal thoughts into at most 100 high-value speaking cards. Descriptions of the situation, words " +
  "already spoken by someone else, quoted instructions, and explanatory meta-text are context only. When a note says " +
  "'я хотел ответить/сказать/спросить' or an equivalent phrase, make the card from the intended reply, statement, or " +
  "question that follows. For example, 'ко мне подошли в зале и спросили: где туалеты? я хотел ответить: вон там, " +
  "за углом' must produce exactly one card for 'вон там, за углом'; do not translate the story or the other person's " +
  "question. For real-life captures, merge repeated intentions, ignore filler and recording artifacts, and split distinct " +
  "intended utterances " +
  "into separate cards. Translate intended meaning rather than wording. Prefer direct casual or neutral adult speech, " +
  `never corporate or bookish phrasing. A real-life capture must be a self-contained utterance ${learnerName} would ` +
  "realistically say; a natural short answer or fragment is valid without added filler. The explicit foundational exception stays atomic.";

export const tutorConversationReviewTask =
  "First identify what the learner asked Tutor to produce. If the learner explicitly requested cards or a card-ready " +
  "list directly from Tutor, extract that prepared material instead of treating the exchange only as conversation " +
  "correction. A quoted or reported instruction spoken by another person inside the learner's story is context, not a " +
  "request to create cards. When the learner says they wanted to answer, say, or ask something, extract only that intended " +
  "utterance and ignore the other person's question or instruction. Tutor may have offered alternatives, but unless the " +
  "learner explicitly requested multiple versions, return only the one natural card closest to the learner's intended " +
  "meaning. Honor an " +
  "explicit quantity, order, and granularity such as 'one card for each number': return one candidate for every requested " +
  "source unit, including every member of stated ranges or enumerations, in source order, up to 100. Preserve explicit " +
  "cue-target pairs. Bare foundational units such as numbers " +
  "or individual letters are valid atomic cards and must not be expanded into example sentences. Keep every explicitly " +
  "requested unit active; do not triage, merge, or skip it. Do not add unrelated " +
  "conversation corrections to an explicit card-preparation result. Otherwise review the ended conversation and extract " +
  "only meaningful recurring mistakes, high-value phrases the learner was trying to say, and a few reusable patterns. " +
  "Correct collocations and sentence structure first, do not nitpick every sentence, and return at most 20 proposals.";

export const guidedTutorConversationReviewTask =
  "Review only this guided practice session. Return at most 3 high-value proposals, or return none when the learner did " +
  "not produce anything worth saving. A proposal must be a complete natural utterance that the learner attempted and " +
  "then self-repaired, repeated, or reused in a new context. Do not save Tutor-only suggestions that the learner never " +
  "practised. Do not propose a phrase that Tutor retrieved from Library or the due queue unless the learner created a " +
  "genuinely new corrected utterance from it. Put the exact trained chunk in focusTerms and describe its reusable frame " +
  "in pattern. Use a real-life category from the utterance; never use Grammar, Chunks, Tell it better, Recall & reuse, " +
  "Role-play twice, Read → retell, or any other exercise name as the category.";

const cardRequestPattern = /(?:карточ|\bcards?\b)/iu;
const numberMaterialPattern = /(?:цифр|числ|\bnumbers?\b|\bdigits?\b|\d)/iu;
const numberRevisionPattern = /(?:убер|удал|добав|остав|замен|remove|delete|add|keep|replace)/iu;
const reportedSpeechPattern = /(?:я хотел(?:а)?\s+(?:ответить|сказать|спросить)|\bi wanted to\s+(?:answer|say|ask)\b)/iu;
const cardRequestDeniedPattern = /(?:карточки?\s+(?:делать\s+)?не\s+(?:нужно|надо|делай)|без\s+карточ|\b(?:no|without)\s+cards?\b|\bdon't\s+(?:make|create)\s+cards?\b)/iu;

const isDirectNumberCardRequest = (content: string) => cardRequestPattern.test(content)
  && numberMaterialPattern.test(content)
  && !reportedSpeechPattern.test(content)
  && !cardRequestDeniedPattern.test(content);

const isNumberCardRevision = (content: string) => numberMaterialPattern.test(content)
  && numberRevisionPattern.test(content)
  && !cardRequestDeniedPattern.test(content);

export const numberCardsFromConversation = (
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): ReviewCandidate[] => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const learnerRequests = messages.slice(0, index).filter((candidate) => candidate.role === "user");
    const latestRequest = learnerRequests.at(-1)?.content || "";
    const hasNumberCardContext = learnerRequests.some((candidate) => isDirectNumberCardRequest(candidate.content));
    if (!isDirectNumberCardRequest(latestRequest)
      && !(hasNumberCardContext && isNumberCardRevision(latestRequest))) {
      continue;
    }
    const pairs = message.content.split(/\r?\n/).flatMap((line) => {
      const match = line.trim().replace(/\\+$/u, "").trim()
        .match(/^(\d+(?:[ .\u00a0\u202f]\d{3})*)\s*[—–-]\s*(.+)$/u);
      if (!match) return [];
      const target = normalizeNfc(match[2].trim());
      if (!target) return [];
      return [{
        id: randomUUID(),
        target,
        cue: match[1],
        note: "",
        category: "Numbers",
        focusTerms: [],
        disposition: "active" as const,
        frequencyBand: "core" as const,
        currency: "current" as const,
        personaFit: 5,
        naturalness: 5,
        commonness: 5,
      }];
    });
    if (pairs.length >= 2) return pairs.slice(0, 100);
  }
  return [];
};

export const materialInstructions = (learner: LearnerPersona, language: LanguageCode, task: string) => `
You prepare optional learning cards for ${learner.name}, who is learning ${targetLanguageName(language)}.
${learner.context}
${task}
${targetLanguages[language].guidance}

Content policy:
- Match the learner's known speaking style when it is supplied. Prefer neutral adult conversational language and useful collocations.
- Current means natural in ${new Date().getFullYear()}. Avoid dated, bookish, corporate, overly formal, or forced Gen-Z wording.
- Follow the flow task's selection, count, order, and card-shape rules before applying the defaults below.
- By default, never create isolated word-definition cards. Put a focus word inside one complete useful utterance.
- When the flow task explicitly allows foundational atomic material, preserve each requested unit and do not expand it into a sentence.
- target must contain only the target-language card content. Never prefix it with a focus term, label, dash, or definition.
- cue must be a natural Russian retrieval cue with the same meaning as target. It is normally a complete utterance; an exact numeral or atomic source label is allowed only for the explicit foundational exception.
- focusTerms is the only field for the exact word or phrase being trained.
- category is normally a real-life situation such as café, gym, work, relationships, travel, or daily errands. Use a clear topic such as Numbers for an atomic foundational set; never use grammatical labels such as conditional or phrasal verb.
- Prefer one strong relevant anchor over many generic examples, without inventing personal details.
- Russian cues must carry the same natural meaning, not word-for-word translation.
- Keep every target utterance or explicitly permitted atomic unit speakable and worth active recall. Pattern drills vary one meaningful slot while preserving the structure.
- Mark rare or dated input as recognition or skip instead of forcing it into active vocabulary.
- Do not claim anything was saved. These are proposals requiring the user's approval.

Metadata:
- frequencyBand: core, common, specific, or rare.
- currency: current, contextual, dated, or uncertain.
- personaFit: 1-5 for this specific adult speaker.
- disposition: active, recognition, or skip.
- pattern must describe the reusable language construction, such as a conditional, phrasal verb, or sentence frame, or be an empty string.
`;

export const toCandidate = (item: z.infer<typeof generatedCandidateSchema>): ReviewCandidate => ({
  ...item,
  target: normalizeNfc(item.target.trim()),
  id: randomUUID(),
  focusTerms: item.focusTerms.slice(0, 8),
  pattern: item.pattern || undefined,
});
