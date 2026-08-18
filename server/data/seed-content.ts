import type { LearningItemInput } from "../types.js";

const english = (
  publicId: string,
  cue: string,
  target: string,
  options: Partial<LearningItemInput> = {},
): LearningItemInput => ({
  publicId,
  language: "en",
  cue,
  target,
  source: "Curated from Roman's materials",
  naturalness: 5,
  commonness: 5,
  register: "casual",
  tags: [],
  ...options,
});

const latvian = (
  publicId: string,
  cue: string,
  target: string,
  options: Partial<LearningItemInput> = {},
): LearningItemInput => ({
  publicId,
  language: "lv",
  cue,
  target,
  source: "Latvian starter set",
  naturalness: 5,
  commonness: 5,
  register: "neutral",
  tags: ["latvian basics"],
  ...options,
});

export const seedItems: LearningItemInput[] = [
  english(
    "en-drawn-to",
    "Меня всегда тянуло к местам рядом с океаном.",
    "I've always been drawn to places near the ocean.",
    { kind: "island_line", status: "learning", tags: ["island", "preferences", "nature"] },
  ),
  english(
    "en-what-i-like-about",
    "Что мне нравится в Риге, так это её компактность.",
    "What I like about Riga is how compact it is.",
    { kind: "island_line", tags: ["island", "preferences", "riga"] },
  ),
  english(
    "en-dont-need-car",
    "Мне в Риге машина особо не нужна.",
    "I don't really need a car in Riga.",
    {
      kind: "correction",
      acceptedAnswers: ["I have no need for a car in Riga."],
      note: "Need for, not need in. In conversation, “I don't really need…” is simpler.",
      tags: ["island", "correction", "riga"],
    },
  ),
  english(
    "en-easy-reach",
    "Всё находится рядом.",
    "Everything is within easy reach.",
    { kind: "correction", tags: ["correction", "city"] },
  ),
  english(
    "en-bucket-list",
    "Это уже давно в моём списке желаний.",
    "It's been on my bucket list for a while.",
    { kind: "island_line", tags: ["island", "travel"] },
  ),
  english(
    "en-reason-to",
    "Это даёт мне повод говорить по-английски весь день.",
    "It gives me a reason to speak English all day.",
    { kind: "island_line", tags: ["island", "cause and effect"] },
  ),
  english(
    "en-find-it-hard",
    "Мне трудно заводить новых друзей-мужчин в этом возрасте.",
    "I find it hard to make new male friends at this age.",
    { kind: "island_line", tags: ["island", "relationships"] },
  ),
  english(
    "en-doesnt-click",
    "С некоторыми людьми просто не складывается.",
    "With some people, it just doesn't click.",
    { kind: "island_line", tags: ["island", "relationships"] },
  ),
  english(
    "en-way-of-coping",
    "Это был мой способ справляться с разочарованием и одиночеством.",
    "It was my way of coping with frustration and isolation.",
    {
      kind: "correction",
      note: "Use “a way of doing something,” not “a way to cope” in this sentence.",
      tags: ["island", "correction", "well-being"],
    },
  ),
  english(
    "en-prove-follow-through",
    "Я хотел доказать себе, что могу довести дело до конца.",
    "I wanted to prove to myself that I could follow through.",
    { kind: "island_line", status: "strong", tags: ["island", "goals"] },
  ),
  english(
    "en-way-i-see-it",
    "Как я это вижу, ежедневная практика важнее изучения правил.",
    "The way I see it, daily practice matters more than studying rules.",
    { kind: "island_line", tags: ["island", "opinion"] },
  ),
  english(
    "en-getting-at",
    "Вот к чему я веду.",
    "Here's what I'm getting at.",
    { kind: "island_line", tags: ["island", "conversation"] },
  ),
  english("en-not-too-crowded", "Там было не слишком многолюдно.", "It wasn't too crowded.", {
    kind: "correction",
    note: "Natural replacement for “empty of crowds.”",
    tags: ["correction", "places"],
  }),
  english("en-shared-activity", "Если у нас есть какое-то общее занятие.", "If we have some shared activity.", {
    kind: "correction",
    tags: ["correction", "relationships"],
  }),
  english(
    "en-drawn-to-nature",
    "Меня очень тянет к природе.",
    "I'm really drawn to nature.",
    { kind: "correction", tags: ["correction", "nature"] },
  ),
  english("en-bounce-back", "Я быстро восстановлюсь.", "I'll bounce back quickly.", {
    tags: ["phrasal verb", "well-being"],
  }),
  english("en-open-up", "В последнее время я стал больше открываться.", "I've been opening up more lately.", {
    tags: ["phrasal verb", "relationships"],
  }),
  english("en-cut-down-on", "Я сократил сахар и вредную еду.", "I've cut down on sugar and junk food.", {
    tags: ["phrasal verb", "health"],
  }),
  english("en-figure-out", "Мне нужно понять, почему это не работает.", "I need to figure out why it isn't working.", {
    tags: ["phrasal verb", "problem solving"],
  }),
  english("en-follow-through-simple", "Самое сложное — действительно довести дело до конца.", "The hard part is actually following through.", {
    tags: ["phrasal verb", "goals"],
  }),
  english("en-settle-into", "Мне потребовалось время, чтобы освоиться в Риге.", "It took me a while to settle into life in Riga.", {
    tags: ["phrasal verb", "riga"],
  }),
  english("en-zero-in-on", "Давай сосредоточимся на главном.", "Let's zero in on what really matters.", {
    tags: ["phrasal verb", "work"],
  }),
  english("en-get-on-with-it", "Хватит об этом думать — просто продолжай.", "Stop overthinking it and get on with it.", {
    tags: ["phrasal verb", "motivation"],
  }),
  english("en-dwell-on", "Не зацикливайся на этом.", "Don't dwell on it.", {
    tags: ["phrasal verb", "well-being"],
  }),
  english("en-brush-up-on", "Мне нужно освежить английский.", "I need to brush up on my English.", {
    tags: ["phrasal verb", "learning"],
  }),
  english("en-pop-up", "Старые воспоминания иногда всплывают.", "Old memories still pop up sometimes.", {
    tags: ["phrasal verb", "well-being"],
  }),
  english("en-get-point-across", "Мне было трудно донести свою мысль.", "I struggled to get my point across.", {
    tags: ["phrasal verb", "conversation"],
  }),
  english("en-hit-up", "Я напишу тебе позже.", "I'll hit you up later.", {
    tags: ["phrasal verb", "friends"],
  }),
  english("en-hit-it-off", "Мы сразу нашли общий язык.", "We hit it off right away.", {
    tags: ["phrasal verb", "relationships"],
  }),
  english("en-turn-down", "В итоге я отказался от предложения.", "I ended up turning down the offer.", {
    tags: ["phrasal verb", "decisions"],
  }),
  english("en-put-off", "Мне пришлось перенести встречу.", "I had to put off the meeting.", {
    tags: ["phrasal verb", "work"],
  }),
  english("en-put-up-with", "Я больше не могу мириться с таким поведением.", "I can't put up with that behavior anymore.", {
    tags: ["phrasal verb", "relationships"],
  }),
  english("en-get-around-to", "Я наконец добрался до этого.", "I finally got around to it.", {
    tags: ["phrasal verb", "daily life"],
  }),
  english("en-run-out", "У меня закончилось время.", "I ran out of time.", {
    tags: ["phrasal verb", "daily life"],
  }),
  english("en-whats-new", "Что у тебя нового?", "What's new on your end?", {
    tags: ["small talk"],
  }),
  english("en-weekend-shaping", "Как складываются планы на выходные?", "How's your weekend shaping up?", {
    tags: ["small talk"],
  }),
  english("en-wind-down", "Как ты обычно расслабляешься?", "How do you usually wind down?", {
    tags: ["small talk", "well-being"],
  }),
  english("en-what-into", "Чем ты сейчас увлекаешься?", "What are you into these days?", {
    tags: ["small talk", "first meeting"],
  }),
  english("en-catch-up", "Давай скоро увидимся и поболтаем.", "Let's catch up soon.", {
    tags: ["small talk", "friends"],
  }),
  english("en-long-time", "Привет! Давно не виделись.", "Hey! Long time no see.", {
    tags: ["small talk", "friends"],
  }),
  english("en-live-around", "Ты живёшь где-то рядом?", "Do you live around here?", {
    acceptedAnswers: ["You live around here?"],
    tags: ["small talk", "first meeting"],
  }),
  english("en-week-going", "Как у тебя проходит неделя?", "How's your week going?", {
    tags: ["small talk"],
  }),
  english("en-what-motivated", "Что помогает тебе не терять мотивацию?", "What's keeping you motivated?", {
    tags: ["small talk", "goals"],
  }),
  english("en-going-well", "Пока всё идёт довольно хорошо.", "It's going pretty well so far.", {
    tags: ["small talk"],
  }),
  english("en-morning-walk", "Обычно я начинаю день с получасовой прогулки.", "I usually start my day with a 30-minute walk.", {
    tags: ["daily routine"],
  }),
  english("en-good-sleep", "Я отлично себя чувствую после хорошего сна.", "I feel great after a good night's sleep.", {
    tags: ["health", "well-being"],
  }),
  english("en-nature-clears", "Природа помогает мне прочистить голову.", "Being in nature helps me clear my head.", {
    tags: ["nature", "well-being"],
  }),
  english("en-stay-productive", "Как тебе удаётся оставаться продуктивным?", "How do you stay productive?", {
    tags: ["work", "small talk"],
  }),
  english("en-locked-in", "Во время работы я полностью сосредоточен.", "I'm fully locked in when I'm working.", {
    tags: ["work", "casual"],
  }),
  english("en-discipline-difference", "Дисциплина решает всё.", "Discipline makes all the difference.", {
    tags: ["work", "goals"],
  }),
  english("en-table-one", "У вас есть столик на одного?", "Do you have a table for one?", {
    acceptedAnswers: ["Got a table for one?"],
    tags: ["restaurant", "travel"],
  }),
  english("en-go-with-salmon", "Я возьму лосось на гриле.", "I'll go with the grilled salmon.", {
    tags: ["restaurant", "food"],
  }),
  english("en-healthiest-option", "Что здесь самое полезное?", "What's the healthiest option here?", {
    tags: ["restaurant", "food"],
  }),
  english("en-just-browsing", "Я просто смотрю, спасибо.", "I'm just browsing, thanks.", {
    tags: ["store", "daily life"],
  }),
  english("en-different-color", "У вас есть это в другом цвете?", "Do you have this in a different color?", {
    tags: ["store", "daily life"],
  }),
  english("en-let-you-know", "Если мне что-нибудь понадобится, я скажу.", "I'll let you know if I need anything.", {
    tags: ["store", "daily life"],
  }),
  english("en-count-on-you", "Я могу на тебя рассчитывать?", "Can I count on you?", {
    tags: ["relationships", "work"],
  }),
  english("en-holding-back", "Что тебе мешает?", "What's holding you back?", {
    tags: ["conversation", "goals"],
  }),
  english("en-falling-into-place", "Всё наконец встаёт на свои места.", "Everything's finally falling into place.", {
    tags: ["life", "goals"],
  }),
  english("en-simply-put", "Проще говоря, мне это больше не подходит.", "Simply put, it doesn't work for me anymore.", {
    tags: ["conversation", "opinion"],
  }),
  english("en-ultimately-choice", "В конечном счёте решать тебе.", "Ultimately, it's your choice.", {
    register: "neutral",
    tags: ["conversation", "decisions"],
  }),

  latvian("lv-learning", "Я учу латышский язык.", "Es mācos latviešu valodu.", { status: "learning" }),
  latvian("lv-slower", "Вы можете говорить медленнее?", "Vai jūs varat runāt lēnāk?", {
    acceptedAnswers: ["Vai varat runāt lēnāk?"],
  }),
  latvian("lv-dont-understand", "Я не понимаю.", "Es nesaprotu."),
  latvian("lv-repeat", "Повторите, пожалуйста.", "Lūdzu, atkārtojiet."),
  latvian("lv-riga", "Мне нравится Рига.", "Man patīk Rīga.", { status: "strong" }),
  latvian("lv-car", "Мне не нужна машина.", "Man nevajag mašīnu."),
  latvian("lv-stop", "Где находится ближайшая остановка?", "Kur atrodas tuvākā pietura?"),
  latvian("lv-how-much", "Сколько это стоит?", "Cik tas maksā?"),
  latvian("lv-card", "Можно платить картой?", "Vai var maksāt ar karti?"),
  latvian("lv-coffee", "Один кофе, пожалуйста.", "Vienu kafiju, lūdzu."),
  latvian("lv-live-riga", "Я живу в Риге.", "Es dzīvoju Rīgā."),
  latvian("lv-speak-little", "Я немного говорю по-латышски.", "Es mazliet runāju latviski."),
  latvian("lv-name", "Меня зовут Роман.", "Mani sauc Romans."),
  latvian("lv-how-going", "Как дела?", "Kā tev iet?", { register: "casual" }),
  latvian("lv-thank-you", "Большое спасибо.", "Liels paldies."),
];
