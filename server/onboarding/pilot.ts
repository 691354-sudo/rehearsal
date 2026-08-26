import type { LanguageCode, OnboardingState } from "../../contracts/api.js";
import type { RehearsalDatabase } from "../db/database.js";

const onboardingKey = "onboarding_v1";

const ids = {
  tutorThread: "10000000-0000-4000-8000-000000000001",
  tutorBatch: "10000000-0000-4000-8000-000000000002",
  captureBatch: "10000000-0000-4000-8000-000000000003",
  captureNotes: [
    "10000000-0000-4000-8000-000000000004",
    "10000000-0000-4000-8000-000000000005",
  ],
  topics: [
    "10000000-0000-4000-8000-000000000006",
    "10000000-0000-4000-8000-000000000007",
  ],
  cards: [
    "10000000-0000-4000-8000-000000000010",
    "10000000-0000-4000-8000-000000000011",
    "10000000-0000-4000-8000-000000000012",
    "10000000-0000-4000-8000-000000000013",
    "10000000-0000-4000-8000-000000000014",
    "10000000-0000-4000-8000-000000000015",
  ],
} as const;

type StoredOnboarding = {
  version: 1;
  status: "pending" | "completed";
  language: LanguageCode;
  starterReady: true;
  completedAt: string | null;
  starterIds: {
    tutorThreadId: string;
    captureNoteIds: string[];
    topicIds: string[];
    cardIds: string[];
  };
};

const targets: Record<LanguageCode, string[]> = {
  en: [
    "Could I have a latte, please?",
    "Could I have it with oat milk?",
    "I’ll have it to go.",
    "I need to reschedule the parcel delivery.",
    "Could you deliver it on Friday?",
    "I’ll be home after six.",
  ],
  lv: [
    "Vienu latte, lūdzu.",
    "Vai var ar auzu pienu?",
    "Es ņemšu līdzi.",
    "Man jāpārceļ sūtījuma piegāde.",
    "Vai varat piegādāt piektdien?",
    "Pēc sešiem būšu mājās.",
  ],
  vi: [
    "Cho tôi một ly latte, làm ơn.",
    "Tôi có thể đổi sang sữa yến mạch không?",
    "Tôi muốn mang đi.",
    "Tôi cần đổi lịch giao bưu kiện.",
    "Có thể giao vào thứ Sáu được không?",
    "Sau sáu giờ tôi sẽ ở nhà.",
  ],
  no: [
    "Kan jeg få en latte, takk?",
    "Kan jeg få den med havremelk?",
    "Jeg tar den med.",
    "Jeg må endre leveringsdatoen for pakken.",
    "Kan dere levere på fredag?",
    "Jeg er hjemme etter klokken seks.",
  ],
  id: [
    "Saya pesan satu latte, ya.",
    "Bisa pakai susu oat?",
    "Dibawa pulang, ya.",
    "Saya perlu mengubah jadwal pengiriman paket.",
    "Bisa dikirim hari Jumat?",
    "Saya ada di rumah setelah jam enam.",
  ],
};

const cues = [
  "Мне, пожалуйста, латте.",
  "Можно на овсяном молоке?",
  "Я возьму с собой.",
  "Мне нужно перенести доставку посылки.",
  "Можно доставить в пятницу?",
  "После шести я буду дома.",
] as const;

const tutorPrompts: Record<LanguageCode, string[]> = {
  en: ["Of course. What would you like to order?", "Regular milk or plant-based?", "For here or to go?"],
  lv: ["Protams. Ko jūs vēlētos pasūtīt?", "Parasto vai augu pienu?", "Uz vietas vai līdzi?"],
  vi: ["Được thôi. Bạn muốn gọi món gì?", "Sữa thường hay sữa thực vật?", "Dùng tại chỗ hay mang đi?"],
  no: ["Selvfølgelig. Hva vil du bestille?", "Vanlig melk eller plantebasert?", "Her eller ta med?"],
  id: ["Tentu. Mau pesan apa?", "Susu biasa atau susu nabati?", "Mau minum di sini atau dibawa pulang?"],
};

const parseStored = (value: string): StoredOnboarding => {
  const parsed = JSON.parse(value) as Partial<StoredOnboarding>;
  if (parsed.version !== 1 || !["pending", "completed"].includes(parsed.status || "")
    || !parsed.language || parsed.starterReady !== true || !parsed.starterIds) {
    throw new Error("INVALID_ONBOARDING_STATE");
  }
  return parsed as StoredOnboarding;
};

const storedState = (db: RehearsalDatabase) => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(onboardingKey) as
    { value: string } | undefined;
  return row ? parseStored(row.value) : null;
};

const publicState = (state: StoredOnboarding): OnboardingState => ({
  version: 1,
  eligibility: "pilot",
  status: state.status,
  language: state.language,
  starterReady: state.starterReady,
  starterTutorThreadId: state.starterIds.tutorThreadId,
  ...(state.completedAt ? { completedAt: state.completedAt } : {}),
});

export const unavailableOnboardingState = (): OnboardingState => ({
  version: 1,
  eligibility: "none",
  status: "not_available",
  starterReady: false,
});

export const getPilotOnboardingState = (db: RehearsalDatabase): OnboardingState => {
  const state = storedState(db);
  if (!state) throw new Error("PILOT_ONBOARDING_NOT_INITIALIZED");
  return publicState(state);
};

export const seedPilotOnboarding = (db: RehearsalDatabase, language: LanguageCode) => {
  const existing = storedState(db);
  if (existing) {
    if (existing.language !== language) throw new Error("PILOT_ONBOARDING_LANGUAGE_MISMATCH");
    return publicState(existing);
  }

  const itemCount = (db.prepare("SELECT COUNT(*) AS count FROM items").get() as { count: number }).count;
  if (itemCount !== 0) throw new Error("PILOT_ONBOARDING_DATABASE_NOT_EMPTY");

  const create = db.transaction(() => {
    db.prepare(
      "INSERT INTO chat_threads(public_id, language_code, title) VALUES (?, ?, ?)",
    ).run(ids.tutorThread, language, "Пример: заказываем кофе");
    const threadId = Number((db.prepare("SELECT id FROM chat_threads WHERE public_id = ?")
      .get(ids.tutorThread) as { id: number }).id);
    const insertMessage = db.prepare(
      "INSERT INTO chat_messages(thread_id, role, content, metadata) VALUES (?, ?, ?, '{}')",
    );
    const conversation = [
      ["user", "Давайте разыграем заказ кофе. Вы бариста."],
      ["assistant", tutorPrompts[language][0]],
      ["user", targets[language][0]],
      ["assistant", tutorPrompts[language][1]],
      ["user", targets[language][1]],
      ["assistant", tutorPrompts[language][2]],
      ["user", targets[language][2]],
    ] as const;
    conversation.forEach(([role, content]) => insertMessage.run(threadId, role, content));

    db.prepare(
      `INSERT INTO review_batches(
        public_id, language_code, kind, title, source_text, candidates, status,
        source_thread_public_id, destination_topic_title, committed_at
      ) VALUES (?, ?, 'chat_review', ?, ?, '[]', 'committed', ?, ?, CURRENT_TIMESTAMP)`,
    ).run(
      ids.tutorBatch,
      language,
      "Tutor: заказываем кофе",
      conversation.map(([, content]) => content).join("\n"),
      ids.tutorThread,
      "Заказываем кофе",
    );
    db.prepare(
      `INSERT INTO review_batches(
        public_id, language_code, kind, title, source_text, candidates, status,
        destination_topic_title, committed_at
      ) VALUES (?, ?, 'capture', ?, ?, '[]', 'committed', ?, CURRENT_TIMESTAMP)`,
    ).run(
      ids.captureBatch,
      language,
      "Notebook: доставка посылки",
      "Мне нужно перенести доставку посылки. Можно доставить в пятницу?\n\nПосле шести я буду дома.",
      "Доставка посылки",
    );
    const captureBatchId = Number((db.prepare("SELECT id FROM review_batches WHERE public_id = ?")
      .get(ids.captureBatch) as { id: number }).id);
    const insertCapture = db.prepare(
      `INSERT INTO capture_notes(
        public_id, language_code, transcript, status, review_batch_id, processed_at
      ) VALUES (?, ?, ?, 'processed', ?, CURRENT_TIMESTAMP)`,
    );
    insertCapture.run(
      ids.captureNotes[0], language,
      "Мне нужно перенести доставку посылки. Можно доставить в пятницу?", captureBatchId,
    );
    insertCapture.run(ids.captureNotes[1], language, "После шести я буду дома.", captureBatchId);

    const insertTopic = db.prepare(
      "INSERT INTO islands(public_id, language_code, title) VALUES (?, ?, ?)",
    );
    insertTopic.run(ids.topics[0], language, "Заказываем кофе");
    insertTopic.run(ids.topics[1], language, "Доставка посылки");
    const topicRows = ids.topics.map((publicId) => db.prepare("SELECT id FROM islands WHERE public_id = ?")
      .get(publicId) as { id: number });

    const insertItem = db.prepare(
      `INSERT INTO items(
        public_id, language_code, kind, cue, target, source, naturalness, commonness,
        register, frequency_band, currency, persona_fit, relevance_checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, 5, 5, 'neutral', 'core', 'current', 5, CURRENT_TIMESTAMP)`,
    );
    const insertMembership = db.prepare(
      "INSERT INTO island_items(island_id, item_id, position) VALUES (?, ?, ?)",
    );
    ids.cards.forEach((publicId, index) => {
      const topicIndex = index < 3 ? 0 : 1;
      insertItem.run(
        publicId,
        language,
        topicIndex === 0 ? "correction" : "phrase",
        cues[index],
        targets[language][index],
        topicIndex === 0 ? "Tutor: заказываем кофе" : "Notebook: доставка посылки",
      );
      const itemId = Number((db.prepare("SELECT id FROM items WHERE public_id = ?")
        .get(publicId) as { id: number }).id);
      insertMembership.run(topicRows[topicIndex].id, itemId, index % 3);
    });

    const state: StoredOnboarding = {
      version: 1,
      status: "pending",
      language,
      starterReady: true,
      completedAt: null,
      starterIds: {
        tutorThreadId: ids.tutorThread,
        captureNoteIds: [...ids.captureNotes],
        topicIds: [...ids.topics],
        cardIds: [...ids.cards],
      },
    };
    db.prepare("INSERT INTO app_settings(key, value) VALUES (?, ?)")
      .run(onboardingKey, JSON.stringify(state));

    const counts = db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM items) AS cards,
        (SELECT COUNT(*) FROM islands) AS topics,
        (SELECT COUNT(*) FROM chat_threads) AS threads,
        (SELECT COUNT(*) FROM capture_notes WHERE status = 'processed') AS notes`,
    ).get() as { cards: number; topics: number; threads: number; notes: number };
    if (counts.cards !== 6 || counts.topics !== 2 || counts.threads !== 1 || counts.notes !== 2) {
      throw new Error("PILOT_ONBOARDING_SEED_INCOMPLETE");
    }
    return state;
  });

  return publicState(create());
};

export const completePilotOnboarding = (db: RehearsalDatabase) => {
  const complete = db.transaction(() => {
    const state = storedState(db);
    if (!state || !state.starterReady) throw new Error("PILOT_ONBOARDING_NOT_READY");
    if (state.status === "completed") return state;
    const completed: StoredOnboarding = {
      ...state,
      status: "completed",
      completedAt: new Date().toISOString(),
    };
    db.prepare(
      `UPDATE app_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?`,
    ).run(JSON.stringify(completed), onboardingKey);
    return completed;
  });
  return publicState(complete());
};

export const pilotStarterIds = ids;
