import type { LanguageCode } from "../../../contracts/api.js";
import type { PilotStore } from "./store.js";
import type { PilotQueue } from "./queue.js";
export const coreKey = (core: string) => core.normalize("NFC").trim().replace(/\s+/g," ");
export class TutorCores {
  constructor(private readonly store: PilotStore,private readonly queue: PilotQueue) {}
  list(language: LanguageCode = "en",categoryId?: string, contextual = false) {
    const rows=this.queue.rows({language,categoryId}).filter((row)=>row.stage==="tutor");
    const grouped=new Map<string,{cardId:string;core:string;cardIds:string[];readyAt:string;lastUsed:string}>();
    for(const row of rows) {
      const item=this.store.item(row.public_id);
      const derived=this.store.db.prepare("SELECT core FROM tutor_core_links WHERE card_id=? AND target=?").get(item.publicId,item.target) as {core:string}|undefined;
      const core=coreKey(item.focusTerms[0] || (!contextual && derived?.core) || "");
      const key=core || `card:${item.publicId}`;
      const used=this.store.db.prepare(`SELECT MAX(user_response_at) AS at FROM pilot_tutor_activities WHERE card_id=?`).get(item.publicId) as {at:string|null};
      const explicitCore=coreKey(item.focusTerms[0] || "");
      const practiced = this.store.db.prepare(`SELECT MAX(created_at) AS at FROM tutor_context_attempts
        WHERE language_code = ? AND target_key = ?`).get(language, explicitCore ? `core:${explicitCore}` : `card:${item.publicId}`) as {at:string|null};
      used.at = [used.at || "", practiced.at || ""].sort().at(-1)!;
      const previous=grouped.get(key);
      if(previous) { previous.cardIds.push(item.publicId);previous.readyAt=[previous.readyAt,row.entered_at || ""].sort()[0];previous.lastUsed=[previous.lastUsed,used.at || ""].sort().at(-1)!; }
      else grouped.set(key,{cardId:item.publicId,core,cardIds:[item.publicId],readyAt:row.entered_at || "",lastUsed:used.at || ""});
    }
    return [...grouped.values()].sort((a,b)=>a.lastUsed.localeCompare(b.lastUsed)||a.readyAt.localeCompare(b.readyAt)||a.cardId.localeCompare(b.cardId));
  }
  resolve(cardId:string,core:string) {
    const item=this.store.item(cardId);
    if(!core.trim() || core.length>500 || item.focusTerms[0]) return;
    this.store.db.prepare(`INSERT INTO tutor_core_links(card_id,language,core,target) VALUES(?,?,?,?)
      ON CONFLICT(card_id) DO UPDATE SET core=excluded.core,target=excluded.target`)
      .run(cardId,item.language,coreKey(core),item.target);
  }
}
