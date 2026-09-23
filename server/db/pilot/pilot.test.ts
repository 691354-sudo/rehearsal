import {randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {createApiTestContext,type ApiTestContext} from "../../testing/api-test-context.js";
import type {LanguageCode,ReviewRating} from "../../../contracts/api.js";
const base=Date.parse("2026-10-01T10:00:00Z");
const at=(minutes=0)=>new Date(base+minutes*60_000).toISOString();
describe("unified learning",()=>{
 let c:ApiTestContext;
 beforeEach(()=>{c=createApiTestContext();c.db.prepare("DELETE FROM items").run();});
 afterEach(()=>c.close());
 const p=()=>c.repository.pilot;
 const card=(language:LanguageCode="en",core="")=>{
   const topic=c.repository.library.createIsland({language,title:randomUUID()});
   return c.repository.items.create({language,cue:"Вспомни",target:`A phrase ${randomUUID()}`,focusTerms:core?[core]:[]},topic.publicId);
 };
 const listen=(id:string,minute:number,language:LanguageCode="en")=>{
   const event={eventId:randomUUID(),appearanceId:randomUUID(),listenSessionId:randomUUID(),cardId:id,language,completedAt:at(minute),audioRepeatsInAppearance:1};
   p().listening.complete(event,at(minute));return event;
 };
 const enter=(id:string,minute=0,language:LanguageCode="en")=>p().listening.toRecall({eventId:randomUUID(),cardId:id,language},at(minute));
 const review=(id:string,rating:ReviewRating,minute:number,sessionId?:string)=>{
   const attemptId=randomUUID();const language=p().store.item(id).language;
   p().recall.begin({attemptId,cardId:id,language,sessionId,shownAt:at(minute),timezone:"UTC"},at(minute));
   const body={attemptId,rating,revealedAt:at(minute),ratedAt:at(minute),responseTimeMs:0,inputMode:"oral_self_check" as const,answer:""};
   return {body,result:p().recall.grade(body,at(minute))};
 };
 it("credits complete listens at 30 minutes without shifting the window or touching FSRS",()=>{
   const a=card();const event=listen(a.publicId,0);
   p().listening.complete(event,at(1));listen(a.publicId,29);listen(a.publicId,30);
   expect(p().store.progress(a.publicId).listenCount).toBe(2);
   expect(c.db.prepare("SELECT COUNT(*) AS n FROM pilot_listens").get()).toEqual({n:3});
   expect(p().store.review(a.publicId)).toBeNull();
   for(const minute of [60,90,120])listen(a.publicId,minute);
   expect(p().store.progress(a.publicId)).toMatchObject({learningStage:"recall",listenCount:5});
   expect(p().queue.listen({limit:20},at(120))).toEqual([]);
   expect(p().queue.list({},at(120))).toHaveLength(1);
 });
 it("To Recall is idempotent, keeps counters, and never moves Tutor backwards",()=>{
   const a=card();listen(a.publicId,0);
   const event={eventId:randomUUID(),cardId:a.publicId,language:"en" as const};
   p().listening.toRecall(event,at(1));p().listening.toRecall(event,at(2));
   expect(p().store.progress(a.publicId)).toMatchObject({listenCount:1,learningStage:"recall"});
   review(a.publicId,"easy",2);const fsrs=p().store.review(a.publicId);
   enter(a.publicId,3);expect(p().store.progress(a.publicId).learningStage).toBe("tutor");
   expect(p().store.review(a.publicId)).toEqual(fsrs);
 });
 it("returns after two Again for exactly two more listens, including a late old event",()=>{
   const a=card();listen(a.publicId,0);enter(a.publicId,1);
   review(a.publicId,"again",2);review(a.publicId,"again",4);
   expect(p().store.progress(a.publicId)).toMatchObject({learningStage:"listen",listenCount:1,listenTarget:3});
   const fsrs=p().store.review(a.publicId);
   listen(a.publicId,3);expect(p().store.progress(a.publicId).listenCount).toBe(1);
   listen(a.publicId,30);listen(a.publicId,60);
   expect(p().store.progress(a.publicId)).toMatchObject({learningStage:"recall",listenCount:3});
   expect(p().store.review(a.publicId)).toEqual(fsrs);
 });
 it("requires consecutive Good separated by 30 minutes; Hard resets the streak",()=>{
   const a=card();enter(a.publicId);
   review(a.publicId,"good",0);review(a.publicId,"good",10);
   expect(p().store.progress(a.publicId).learningStage).toBe("recall");
   let due=p().store.review(a.publicId)!.dueAt;
   const minute=(Date.parse(due)-base)/60_000;
   review(a.publicId,"hard",minute);due=p().store.review(a.publicId)!.dueAt;
   review(a.publicId,"good",(Date.parse(due)-base)/60_000);
   expect(p().store.progress(a.publicId).learningStage).toBe("recall");
   due=p().store.review(a.publicId)!.dueAt;review(a.publicId,"good",(Date.parse(due)-base)/60_000);
   expect(p().store.progress(a.publicId).learningStage).toBe("tutor");
 });
 it("deduplicates grades and rejects concurrent attempts based on superseded progress",()=>{
   const a=card();enter(a.publicId);const second=randomUUID();
   p().recall.begin({attemptId:second,cardId:a.publicId,shownAt:at(0),timezone:"UTC"},at(0));
   const {body,result}=review(a.publicId,"good",0);
   expect(p().recall.grade(body,at(1))).toEqual(result);
   expect(()=>p().recall.grade({...body,attemptId:second},at(1))).toThrow("STALE_RECALL_ATTEMPT");
   expect(p().store.review(a.publicId)?.repetitions).toBe(1);
 });
 it("fills LR from available cards: 8 started and 12 new, and never leaves the chosen Topic",()=>{
   const started=Array.from({length:8},()=>card());started.forEach((a,n)=>listen(a.publicId,n));
   Array.from({length:22},()=>card());
   const queue=p().queue.listen({limit:20},at(40));
   expect(queue).toHaveLength(20);expect(queue.filter((a)=>a.listenCount>0)).toHaveLength(8);
    expect(p().queue.listen({limit:50,topicId:started[0].topicId!},at(10))).toHaveLength(0);
    expect(p().queue.listen({limit:50,topicId:started[0].topicId!},at(40))).toHaveLength(1);
   expect(new Set(queue.map((a)=>a.publicId)).size).toBe(20);
 });
 it("fills spare places with initial 4/5 cards while keeping session membership fixed",()=>{
   const ids=Array.from({length:12},()=>card().publicId);
   ids.forEach((id)=>[0,30,60,90].forEach((minute)=>listen(id,minute)));
   const sessionId=randomUUID();
   const items=p().queue.start(sessionId,{limit:10,language:"en"},at(91));
   expect(items).toHaveLength(10);
   expect(()=>review(ids.find((id)=>!items.some((a)=>a.publicId===id))!,"good",92,sessionId)).toThrow("CARD_NOT_AVAILABLE_FOR_RECALL");
   review(items[0].publicId,"again",92,sessionId);
   review(items[0].publicId,"again",94,sessionId);
   expect(p().queue.list({},at(95)).some((a)=>a.publicId===items[0].publicId)).toBe(false);
 });
 it("keeps written-only languages in Recall and isolates all language queues",()=>{
   const lv=card("lv");card();
   expect(p().queue.list({language:"lv"},at(0))).toHaveLength(1);
   review(lv.publicId,"again",0);review(lv.publicId,"again",2);
   expect(p().store.progress(lv.publicId).learningStage).toBe("recall");
   expect(p().queue.list({},at(2))).toEqual([]);
   expect(()=>enter(lv.publicId,3,"en")).toThrow("PILOT_CARD_NOT_FOUND");
 });
 it("Like only changes the collection, not stage, counters, FSRS, or Tutor requests",()=>{
   const a=card();const before=p().store.progress(a.publicId);
   p().listening.like({eventId:randomUUID(),cardId:a.publicId,language:"en",liked:true,occurredAt:at(0)},at(0));
   expect(p().store.progress(a.publicId)).toEqual(before);expect(p().listening.pending()).toEqual([]);
   expect(p().queue.liked(at(0)).items.map((item)=>item.publicId)).toEqual([a.publicId]);
   expect(p().cores.list()).toEqual([]);
 });
 it("starts Tutor directly, deduplicates COREs and retains Homework feedback/history",()=>{
   for(let n=0;n<2;n++){const a=card("en","take a break");enter(a.publicId);review(a.publicId,"easy",1);}
   expect(p().cores.list()).toHaveLength(1);
   const hw=p().homework.create({homeworkId:randomUUID(),requestedMinutes:2,timezone:"UTC"},at(2));
   expect(hw).toMatchObject({status:"tutor_in_progress",plannedRecallCards:0});
   expect(hw.plannedTutorCardIds).toHaveLength(1);
   expect(p().tutor.receive(hw.homeworkId,hw.tutorChatId,at(2)).cards[0]).toMatchObject({core:"take a break",eligibleForContextPractice:true});
   p().homework.finish(hw.homeworkId,at(3));
   p().homework.feedback(hw.homeworkId,{difficulty:"about_right",timeFit:"as_expected",nextStepClarity:"yes"},at(3));
   c.reopen();expect(p().homework.list()).toHaveLength(1);
 });
 it("allows inferred COREs without mutating Library or FSRS",()=>{
   const a=card();enter(a.publicId);review(a.publicId,"easy",1);const state=p().store.review(a.publicId);
   p().cores.resolve(a.publicId,"a phrase");
   expect(p().cores.list()[0].core).toBe("a phrase");expect(p().store.item(a.publicId).focusTerms).toEqual([]);
   expect(p().store.review(a.publicId)).toEqual(state);
 });
 it("preserves neutral retention settings at attempt start without a daily new-card cap",()=>{
   c.repository.practice.updateSettings({...c.repository.practice.getSettings(),newItemsPerDay:0});
   const a=card();enter(a.publicId);expect(p().queue.list({},at(0))).toHaveLength(1);
   review(a.publicId,"good",0);expect(p().store.review(a.publicId)!.dueAt).toBe(at(10));
 });
});
