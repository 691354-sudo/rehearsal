import type { RehearsalDatabase } from "./database.js";
import { AudioRepository } from "./repositories/audio.js";
import { AiUsageRepository } from "./repositories/ai-usage.js";
import { CaptureRepository } from "./repositories/capture.js";
import { ItemsRepository } from "./repositories/items.js";
import { LibraryRepository } from "./repositories/library.js";
import { PracticeRepository } from "./repositories/practice.js";
import { ReviewsRepository } from "./repositories/reviews.js";
import { SystemRepository } from "./repositories/system.js";
import { TutorRepository } from "./repositories/tutor.js";

/** Database composition root. Runtime modules should depend on a narrow domain property. */
export class RehearsalRepository {
  readonly aiUsage: AiUsageRepository;
  readonly audio: AudioRepository;
  readonly capture: CaptureRepository;
  readonly items: ItemsRepository;
  readonly library: LibraryRepository;
  readonly practice: PracticeRepository;
  readonly reviews: ReviewsRepository;
  readonly system: SystemRepository;
  readonly tutor: TutorRepository;

  constructor(db: RehearsalDatabase) {
    this.aiUsage = new AiUsageRepository(db);
    this.audio = new AudioRepository(db);
    this.capture = new CaptureRepository(db);
    this.items = new ItemsRepository(db);
    this.library = new LibraryRepository(db);
    this.practice = new PracticeRepository(db);
    this.reviews = new ReviewsRepository(db, this.items, this.library);
    this.system = new SystemRepository(db);
    this.tutor = new TutorRepository(db);
  }
}
