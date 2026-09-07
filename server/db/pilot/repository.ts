import type { RehearsalDatabase } from "../database.js";
import type { PracticeRepository } from "../repositories/practice.js";
import type { TutorRepository } from "../repositories/tutor.js";
import { PilotHomework } from "./homework.js";
import { PilotListening } from "./listening.js";
import { PilotQueue } from "./queue.js";
import { PilotRecall } from "./recall.js";
import { PilotStore } from "./store.js";
import { PilotTiming } from "./timing.js";
import { PilotTutor } from "./tutor.js";
import { PilotParticipants } from "./participants.js";
import { PilotExport } from "./export.js";

export class PilotRepository {
  readonly store: PilotStore;
  readonly listening: PilotListening;
  readonly queue: PilotQueue;
  readonly recall: PilotRecall;
  readonly homework: PilotHomework;
  readonly timing: PilotTiming;
  readonly tutor: PilotTutor;
  readonly participants: PilotParticipants;
  readonly export: PilotExport;

  constructor(db: RehearsalDatabase, practice: PracticeRepository, tutor: TutorRepository) {
    this.store = new PilotStore(db, practice);
    this.listening = new PilotListening(this.store);
    this.queue = new PilotQueue(this.store);
    this.recall = new PilotRecall(this.store, this.queue);
    this.homework = new PilotHomework(this.store, this.queue, this.listening, tutor);
    this.timing = new PilotTiming(this.store);
    this.tutor = new PilotTutor(this.store, tutor);
    this.participants = new PilotParticipants(this.store);
    this.export = new PilotExport(this.store, this.participants);
  }
}
