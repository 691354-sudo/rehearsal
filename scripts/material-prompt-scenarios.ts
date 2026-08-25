import type { LanguageCode, ReviewCandidate } from "../server/types.js";

export type PromptEvalFlow =
  | { type: "tutor"; turns: string[] }
  | { type: "notebook"; notes: string[] };

export type PromptEvalScenario = {
  id: string;
  name: string;
  language: LanguageCode;
  flow: PromptEvalFlow;
  check: (cards: ReviewCandidate[]) => string[];
};

const fold = (value: string) => value.normalize("NFC").toLocaleLowerCase()
  .replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']+/gu, " ").replace(/\s+/g, " ").trim();
const issueUnless = (condition: boolean, message: string) => condition ? [] : [message];
const countIs = (cards: ReviewCandidate[], expected: number) =>
  issueUnless(cards.length === expected, `expected ${expected} cards, received ${cards.length}`);
const targetIncludes = (card: ReviewCandidate, terms: string[]) => {
  const target = fold(card.target);
  return terms.every((term) => target.includes(fold(term)));
};
const cardContainsTerm = (card: ReviewCandidate, term: string) => {
  const material = [card.target, ...card.focusTerms].map(fold).join(" ");
  return material.includes(fold(term));
};
const exactOrderedPairs = (cards: ReviewCandidate[], pairs: string[][]) => {
  const issues = countIs(cards, pairs.length);
  pairs.forEach(([cue, target], index) => {
    const card = cards[index];
    if (!card) return;
    issues.push(...issueUnless(fold(card.cue) === fold(cue),
      `card ${index + 1} cue should be ${JSON.stringify(cue)}, received ${JSON.stringify(card.cue)}`));
    issues.push(...issueUnless(fold(card.target) === fold(target),
      `card ${index + 1} target should be ${JSON.stringify(target)}, received ${JSON.stringify(card.target)}`));
  });
  return issues;
};
const exactPairSubset = (cards: ReviewCandidate[], pairs: string[][]) => pairs.flatMap(([cue, target]) =>
  issueUnless(cards.some((card) => fold(card.cue) === fold(cue) && fold(card.target) === fold(target)),
    `missing exact pair ${cue} -> ${target}`));

const vietnameseNumbers = [
  ["0", "không"], ["1", "một"], ["2", "hai"], ["3", "ba"], ["4", "bốn"],
  ["5", "năm"], ["6", "sáu"], ["7", "bảy"], ["8", "tám"], ["9", "chín"],
  ["10", "mười"], ["11", "mười một"], ["12", "mười hai"], ["13", "mười ba"],
  ["14", "mười bốn"], ["15", "mười lăm"], ["16", "mười sáu"], ["17", "mười bảy"],
  ["18", "mười tám"], ["19", "mười chín"], ["20", "hai mươi"], ["30", "ba mươi"],
  ["40", "bốn mươi"], ["50", "năm mươi"], ["60", "sáu mươi"], ["70", "bảy mươi"],
  ["80", "tám mươi"], ["90", "chín mươi"], ["100", "một trăm"],
  ["1 000", "một nghìn"], ["10 000", "mười nghìn"], ["100 000", "một trăm nghìn"],
  ["1 000 000", "một triệu"],
];
const vietnameseZeroToNine = vietnameseNumbers.slice(0, 10);
const vietnameseZeroToFive = vietnameseNumbers.slice(0, 6);
const weekdays = [
  ["понедельник", "Monday"], ["вторник", "Tuesday"], ["среда", "Wednesday"],
  ["четверг", "Thursday"], ["пятница", "Friday"], ["суббота", "Saturday"],
  ["воскресенье", "Sunday"],
];

const shared = (
  id: string,
  name: string,
  language: LanguageCode,
  input: string,
  check: PromptEvalScenario["check"],
): PromptEvalScenario[] => ([
  { id: `${id}-tutor`, name: `${name} / Tutor`, language, flow: { type: "tutor", turns: [input] }, check },
  { id: `${id}-notebook`, name: `${name} / Notebook`, language, flow: { type: "notebook", notes: [input] }, check },
]);

const numberRequest = `Мне нужны карточки с цифрами для вьетнамского языка. Сделай каждое число отдельной карточкой, только цифра и её вьетнамское название, без предложений и дополнительных слов. Нужны 0–20, затем 30, 40, 50, 60, 70, 80, 90, 100, затем 1 000, 10 000, 100 000 и 1 000 000. Сохрани этот порядок.`;
const pairRequest = `Сделай одну отдельную карточку из каждой строки. Слева уже готовая подсказка, справа готовый target. Ничего не добавляй и не переписывай:
0 — không
1 — một
2 — hai
10 — mười
20 — hai mươi`;
const weekdayRequest = `Сделай семь отдельных английских карточек для дней недели. На подсказке должно быть только русское название дня, в target — только английское слово. Никаких предложений. Порядок: понедельник, вторник, среда, четверг, пятница, суббота, воскресенье.`;
const monologueTarget = "I usually start slowly. Then I find my rhythm. By the end, I feel focused.";
const monologueRequest = `Сделай ровно одну английскую карточку и не разделяй её. Target оставь точно таким: ${monologueTarget} Русская подсказка: Обычно я начинаю медленно. Потом нахожу свой ритм. К концу я уже сосредоточен.`;
const vocabularyRequest = `Подготовь обычные контекстные английские карточки для этой лексики. Не делай словарные пары, используй каждую фразу в естественной реплике и убери повтор:
pull through
bounce back
turn down
bounce back`;
const chargeRequest = `Сделай ровно две отдельные английские карточки со словом charge: одна про зарядить телефон, вторая про взять оплату. Значения не объединяй.`;
const exactPairRequest = `Подготовь две английские карточки. Не меняй ни target, ни русскую подсказку и сохрани порядок.
Подсказка: Мне нужна минутка.
Target: I need a moment.
Подсказка: Это вылетело у меня из головы.
Target: It slipped my mind.`;
const patternRequest = `Сделай ровно четыре отдельные английские карточки с конструкцией I was about to ... when ...: уйти когда позвонили, позвонить когда пришло сообщение, начать когда отключили свет, заснуть когда залаяла собака. Сохрани одну и ту же конструкцию, но не объединяй ситуации.`;
const intendedReply = `В спортзале ко мне подошёл человек и спросил, где туалеты. Я хотел ответить вон там, за углом.`;
const twoReplies = `В кафе я хотел попросить чек. Потом я хотел попросить отправить его мне по электронной почте. Это две разные реплики.`;
const quotedInstruction = `Начальник сказал мне: сделай карточки с числами от нуля до десяти. Я хотел ответить это не моя задача.`;

const ordinaryVocabularyCheck = (cards: ReviewCandidate[]) => {
  const issues = countIs(cards, 3);
  ["pull through", "bounce back", "turn down"].forEach((term) => {
    issues.push(...issueUnless(cards.some((card) => cardContainsTerm(card, term)), `missing vocabulary term ${term}`));
  });
  cards.forEach((card, index) => issues.push(...issueUnless(fold(card.target).split(" ").length >= 4,
    `card ${index + 1} should be a contextual utterance, received ${JSON.stringify(card.target)}`)));
  return issues;
};

export const materialPromptScenarios: PromptEvalScenario[] = [
  ...shared("01", "Exact foundational number set", "vi", numberRequest,
    (cards) => exactOrderedPairs(cards, vietnameseNumbers)),
  ...shared("02", "Prepared cue-target pairs", "vi", pairRequest,
    (cards) => exactOrderedPairs(cards, vietnameseNumbers.filter(([cue]) => ["0", "1", "2", "10", "20"].includes(cue)))),
  ...shared("03", "Atomic non-number foundation", "en", weekdayRequest,
    (cards) => exactOrderedPairs(cards, weekdays)),
  ...shared("04", "One connected card stays whole", "en", monologueRequest, (cards) => [
    ...countIs(cards, 1),
    ...issueUnless(cards[0] ? fold(cards[0].target) === fold(monologueTarget) : false,
      `connected target was changed or split: ${cards.map((card) => card.target).join(" | ")}`),
  ]),
  ...shared("05", "Ordinary vocabulary stays contextual", "en", vocabularyRequest, ordinaryVocabularyCheck),
  ...shared("06", "Two senses remain separate", "en", chargeRequest, (cards) => [
    ...countIs(cards, 2),
    ...issueUnless(cards.some((card) => targetIncludes(card, ["charg", "phone"])), "missing phone-charge context"),
    ...issueUnless(cards.some((card) => targetIncludes(card, ["charg"])
      && (fold(card.target).includes("charge for") || ["fee", "money", "cost", "payment"]
        .some((term) => fold(card.target).includes(term)) || fold(card.cue).includes("оплат"))),
    "missing payment-charge context"),
  ]),
  ...shared("07", "Exact learner text is preserved", "en", exactPairRequest, (cards) => exactOrderedPairs(cards, [
    ["Мне нужна минутка.", "I need a moment."],
    ["Это вылетело у меня из головы.", "It slipped my mind."],
  ])),
  ...shared("08", "Pattern variants keep one frame", "en", patternRequest, (cards) => [
    ...countIs(cards, 4),
    ...cards.flatMap((card, index) => issueUnless(targetIncludes(card, ["i was about to", "when"]),
      `card ${index + 1} lost the requested frame: ${card.target}`)),
  ]),
  ...shared("09", "Unquoted intended reply is isolated", "en", intendedReply, (cards) => [
    ...countIs(cards, 1),
    ...issueUnless(cards[0] ? targetIncludes(cards[0], ["over there", "corner"]) : false,
      `missing intended reply: ${cards.map((card) => card.target).join(" | ")}`),
    ...issueUnless(cards[0] ? !fold(cards[0].cue).includes("туалет") : false,
      `situation leaked into cue: ${cards[0]?.cue || "no card"}`),
  ]),
  ...shared("10", "Several intended replies stay separate", "en", twoReplies, (cards) => [
    ...countIs(cards, 2),
    ...issueUnless(cards.some((card) => ["bill", "check", "receipt"].some((term) => fold(card.target).includes(term))),
      "missing bill/check request"),
    ...issueUnless(cards.some((card) => ["email", "e mail"].some((term) => fold(card.target).includes(term))),
      "missing email request"),
  ]),
  ...shared("11", "Quoted card command is not executed", "en", quotedInstruction, (cards) => [
    ...countIs(cards, 1),
    ...issueUnless(cards[0] ? ["not my job", "not my responsibility", "isn't my job", "is not my job"]
      .some((term) => fold(cards[0].target).includes(term.replace(/[^\p{L}\p{N}']+/gu, " "))) : false,
      `missing intended refusal: ${cards.map((card) => card.target).join(" | ")}`),
    ...issueUnless(cards.every((card) => !fold(card.target).includes("card")), "quoted card instruction was executed"),
  ]),
  {
    id: "12-tutor", name: "Latest Tutor format correction wins", language: "vi",
    flow: { type: "tutor", turns: [
      "Подготовь карточки с числами от 0 до 5 и добавь к каждому пример предложения.",
      "Нет, передумал: только отдельные числа 0–5 и их вьетнамские названия. Никаких предложений.",
    ] },
    check: (cards) => exactOrderedPairs(cards, vietnameseZeroToFive),
  },
  {
    id: "13-tutor", name: "Tutor removal and addition persist", language: "vi",
    flow: { type: "tutor", turns: [
      "Сделай отдельные карточки для чисел 0–9: цифра и вьетнамское название, без предложений.",
      "Убери карточки 2 и 3, а в конец добавь 20. Остальные оставь без изменений.",
    ] },
    check: (cards) => exactOrderedPairs(cards, vietnameseZeroToNine.filter(([cue]) => !["2", "3"].includes(cue))
      .concat([vietnameseNumbers.find(([cue]) => cue === "20")!])),
  },
  {
    id: "14-tutor", name: "Ordinary Tutor conversation reviews learner errors only", language: "en",
    flow: { type: "tutor", turns: ["Yesterday I go to the shop. I am agree with him."] },
    check: (cards) => [
      ...countIs(cards, 2),
      ...issueUnless(cards.some((card) => targetIncludes(card, ["yesterday", "went", "shop"])),
        "missing corrected past-tense sentence"),
      ...issueUnless(cards.some((card) => targetIncludes(card, ["i agree", "him"])),
        "missing corrected agreement sentence"),
    ],
  },
  {
    id: "15-tutor", name: "Numbered non-card plan creates no cards", language: "en",
    flow: { type: "tutor", turns: ["Составь мне обычный план занятия из пяти пронумерованных шагов. Карточки делать не нужно."] },
    check: (cards) => countIs(cards, 0),
  },
  {
    id: "16-notebook", name: "Notebook keeps per-note instruction scope", language: "vi",
    flow: { type: "notebook", notes: [
      "Сделай четыре отдельные карточки для чисел 0–3: только цифра и вьетнамское название.",
      "В кафе я хотел попросить счёт.",
    ] },
    check: (cards) => [
      ...countIs(cards, 5),
      ...exactPairSubset(cards, vietnameseNumbers.slice(0, 4)),
      ...issueUnless(cards.some((card) => ["hóa đơn", "tính tiền", "thanh toán", "trả tiền"]
        .some((term) => fold(card.target).includes(fold(term)))),
        "missing Vietnamese bill request"),
    ],
  },
  {
    id: "17-notebook", name: "Notebook raw vocabulary list is contextual", language: "en",
    flow: { type: "notebook", notes: ["pull through\nbounce back\nturn down\nbounce back"] },
    check: ordinaryVocabularyCheck,
  },
  {
    id: "18-notebook", name: "Independent Notebook requests keep their own shapes", language: "en",
    flow: { type: "notebook", notes: [weekdayRequest, monologueRequest] },
    check: (cards) => [
      ...countIs(cards, 8),
      ...exactPairSubset(cards, weekdays),
      ...issueUnless(cards.some((card) => fold(card.target) === fold(monologueTarget)), "missing connected monologue card"),
    ],
  },
];
