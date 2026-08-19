import type { RehearsalDatabase } from "./database.js";
import { AudioRepository } from "./repositories/audio.js";
import { CaptureRepository } from "./repositories/capture.js";
import { ItemsRepository } from "./repositories/items.js";
import { LibraryRepository } from "./repositories/library.js";
import { PracticeRepository } from "./repositories/practice.js";
import { ReviewsRepository } from "./repositories/reviews.js";
import { SystemRepository } from "./repositories/system.js";
import { TutorRepository } from "./repositories/tutor.js";

/** Database composition root. Runtime modules should depend on a narrow domain property. */
export class RehearsalRepository {
  readonly audio: AudioRepository;
  readonly capture: CaptureRepository;
  readonly items: ItemsRepository;
  readonly library: LibraryRepository;
  readonly practice: PracticeRepository;
  readonly reviews: ReviewsRepository;
  readonly system: SystemRepository;
  readonly tutor: TutorRepository;

  constructor(db: RehearsalDatabase) {
    this.audio = new AudioRepository(db);
    this.capture = new CaptureRepository(db);
    this.items = new ItemsRepository(db);
    this.library = new LibraryRepository(db);
    this.practice = new PracticeRepository(db);
    this.reviews = new ReviewsRepository(db, this.items, this.library);
    this.system = new SystemRepository(db);
    this.tutor = new TutorRepository(db);
  }

  getSchedulerSettings(...args: Parameters<PracticeRepository["getSettings"]>) {
    return this.practice.getSettings(...args);
  }
  updateSchedulerSettings(...args: Parameters<PracticeRepository["updateSettings"]>) {
    return this.practice.updateSettings(...args);
  }
  listItems(...args: Parameters<ItemsRepository["list"]>) { return this.items.list(...args); }
  getItem(...args: Parameters<ItemsRepository["get"]>) { return this.items.get(...args); }
  saveItem(...args: Parameters<ItemsRepository["save"]>) { return this.items.save(...args); }
  updateItemPreference(...args: Parameters<ItemsRepository["updatePreference"]>) {
    return this.items.updatePreference(...args);
  }
  updateItem(...args: Parameters<ItemsRepository["update"]>) { return this.items.update(...args); }
  deleteItem(...args: Parameters<ItemsRepository["delete"]>) { return this.items.delete(...args); }
  search(...args: Parameters<ItemsRepository["search"]>) { return this.items.search(...args); }
  itemsMissingEmbeddings(...args: Parameters<ItemsRepository["missingEmbeddings"]>) {
    return this.items.missingEmbeddings(...args);
  }
  updateEmbedding(...args: Parameters<ItemsRepository["updateEmbedding"]>) {
    return this.items.updateEmbedding(...args);
  }
  createCaptureNote(...args: Parameters<CaptureRepository["create"]>) {
    return this.capture.create(...args);
  }
  createTextCaptureNote(...args: Parameters<CaptureRepository["createText"]>) {
    return this.capture.createText(...args);
  }
  getCaptureNote(...args: Parameters<CaptureRepository["get"]>) { return this.capture.get(...args); }
  getCaptureAudio(...args: Parameters<CaptureRepository["getAudio"]>) {
    return this.capture.getAudio(...args);
  }
  listCaptureNotes(...args: Parameters<CaptureRepository["list"]>) { return this.capture.list(...args); }
  completeCaptureTranscription(...args: Parameters<CaptureRepository["completeTranscription"]>) {
    return this.capture.completeTranscription(...args);
  }
  failCaptureTranscription(...args: Parameters<CaptureRepository["failTranscription"]>) {
    return this.capture.failTranscription(...args);
  }
  markCaptureTranscribing(...args: Parameters<CaptureRepository["markTranscribing"]>) {
    return this.capture.markTranscribing(...args);
  }
  updateCaptureTranscript(...args: Parameters<CaptureRepository["updateTranscript"]>) {
    return this.capture.updateTranscript(...args);
  }
  deleteCaptureNote(...args: Parameters<CaptureRepository["delete"]>) {
    return this.capture.delete(...args);
  }
  selectReadyCaptureNotes(...args: Parameters<CaptureRepository["selectReady"]>) {
    return this.capture.selectReady(...args);
  }
  getActiveCaptureBatch(...args: Parameters<CaptureRepository["getActiveBatch"]>) {
    return this.capture.getActiveBatch(...args);
  }
  attachCaptureNotesToBatch(...args: Parameters<CaptureRepository["attachToBatch"]>) {
    return this.capture.attachToBatch(...args);
  }
  createReviewBatch(...args: Parameters<ReviewsRepository["create"]>) { return this.reviews.create(...args); }
  getReviewBatch(...args: Parameters<ReviewsRepository["get"]>) { return this.reviews.get(...args); }
  replaceReviewCandidate(...args: Parameters<ReviewsRepository["replaceCandidate"]>) {
    return this.reviews.replaceCandidate(...args);
  }
  replaceReviewCandidates(...args: Parameters<ReviewsRepository["replaceCandidates"]>) {
    return this.reviews.replaceCandidates(...args);
  }
  commitReviewBatch(...args: Parameters<ReviewsRepository["commit"]>) { return this.reviews.commit(...args); }
  saveSource(...args: Parameters<LibraryRepository["saveSource"]>) { return this.library.saveSource(...args); }
  createIsland(...args: Parameters<LibraryRepository["createIsland"]>) { return this.library.createIsland(...args); }
  listIslands(...args: Parameters<LibraryRepository["listIslands"]>) { return this.library.listIslands(...args); }
  getIsland(...args: Parameters<LibraryRepository["getIsland"]>) { return this.library.getIsland(...args); }
  findIslandByTitle(...args: Parameters<LibraryRepository["findIslandByTitle"]>) {
    return this.library.findIslandByTitle(...args);
  }
  ensureIsland(...args: Parameters<LibraryRepository["ensureIsland"]>) { return this.library.ensureIsland(...args); }
  addIslandItem(...args: Parameters<LibraryRepository["addIslandItem"]>) {
    return this.library.addIslandItem(...args);
  }
  updateIsland(...args: Parameters<LibraryRepository["updateIsland"]>) { return this.library.updateIsland(...args); }
  deleteIsland(...args: Parameters<LibraryRepository["deleteIsland"]>) { return this.library.deleteIsland(...args); }
  backfillTopicsFromTags(...args: Parameters<LibraryRepository["backfillTopicsFromTags"]>) {
    return this.library.backfillTopicsFromTags(...args);
  }
  runTopicBackfillMigration(...args: Parameters<LibraryRepository["runTopicBackfillMigration"]>) {
    return this.library.runTopicBackfillMigration(...args);
  }
  recordAttempt(...args: Parameters<PracticeRepository["recordAttempt"]>) {
    return this.practice.recordAttempt(...args);
  }
  countAttemptsSince(...args: Parameters<PracticeRepository["countAttemptsSince"]>) {
    return this.practice.countAttemptsSince(...args);
  }
  countActivitySince(...args: Parameters<PracticeRepository["countActivitySince"]>) {
    return this.practice.countActivitySince(...args);
  }
  listDueItems(...args: Parameters<PracticeRepository["listDue"]>) { return this.practice.listDue(...args); }
  listInventory(...args: Parameters<PracticeRepository["listInventory"]>) {
    return this.practice.listInventory(...args);
  }
  getOrCreateThread(...args: Parameters<TutorRepository["getOrCreateThread"]>) {
    return this.tutor.getOrCreateThread(...args);
  }
  getThread(...args: Parameters<TutorRepository["getThread"]>) { return this.tutor.getThread(...args); }
  ensureThreadTitle(...args: Parameters<TutorRepository["ensureThreadTitle"]>) {
    return this.tutor.ensureThreadTitle(...args);
  }
  listThreads(...args: Parameters<TutorRepository["listThreads"]>) { return this.tutor.listThreads(...args); }
  addMessage(...args: Parameters<TutorRepository["addMessage"]>) { return this.tutor.addMessage(...args); }
  getMessages(...args: Parameters<TutorRepository["getMessages"]>) { return this.tutor.getMessages(...args); }
  stats(...args: Parameters<SystemRepository["stats"]>) { return this.system.stats(...args); }
  getCachedAudio(...args: Parameters<AudioRepository["get"]>) { return this.audio.get(...args); }
  saveCachedAudio(...args: Parameters<AudioRepository["save"]>) { return this.audio.save(...args); }
}
