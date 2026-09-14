import Database from "better-sqlite3";
import { config } from "../server/config.js";
import { TutorFeedbackRepository } from "../server/db/repositories/tutor-feedback.js";
import { registeredProfilesFromDisk } from "../server/profiles/manager.js";

const args = process.argv.slice(2);
const selected = args[args.indexOf("--profile") + 1];
if (!args.includes("--profile") || !selected || selected.startsWith("--")) {
  throw new Error("Usage: npm run tutor:feedback -- --profile <id|all> [--json]");
}
const profiles = registeredProfilesFromDisk(config.dataDir).filter((profile) => selected === "all" || profile.id === selected);
if (!profiles.length) throw new Error(`No registered profile matched: ${selected}`);
const report = {
  exportedAt: new Date().toISOString(),
  profiles: profiles.map((profile) => {
    const db = new Database(profile.databasePath, { readonly: true, fileMustExist: true });
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tutor_message_feedback'").get()) {
        return { profileId: profile.id, profileName: profile.name, available: false, conversations: [] };
      }
      return { profileId: profile.id, profileName: profile.name, available: true, ...new TutorFeedbackRepository(db).export() };
    } finally { db.close(); }
  }),
};

if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`# Tutor feedback\n\nExported: ${report.exportedAt}`);
  for (const profile of report.profiles) {
    console.log(`\n## ${profile.profileName} (${profile.profileId})`);
    if (!profile.available) { console.log("Feedback migration is not installed."); continue; }
    if (!profile.conversations.length) console.log("No feedback saved.");
    for (const conversation of profile.conversations) {
      console.log(`\n### ${conversation.thread.title}\n\nChat: ${conversation.thread.publicId} · ${conversation.thread.language}`);
      if (conversation.archivedAt) console.log(`Archived: ${conversation.archivedAt}`);
      for (const feedback of conversation.feedback) {
        console.log(`\nFeedback on message ${feedback.messageId} · ${feedback.createdAt} (updated ${feedback.updatedAt})\n\n${feedback.text}`);
        if (!feedback.diagnosticsAvailable) console.log("Original prompt/turn diagnostics unavailable for this older or non-model reply.");
      }
      console.log("\n#### Complete conversation");
      for (const message of conversation.messages) {
        console.log(`\n${message.role} · message ${message.messageId} · ${message.createdAt}\n\n${message.content}`);
        if (Object.keys(message.metadata).length) console.log(`\nMetadata:\n\`\`\`json\n${JSON.stringify(message.metadata, null, 2)}\n\`\`\``);
      }
      if (conversation.homework.length) console.log(`\nHomework context:\n\`\`\`json\n${JSON.stringify(conversation.homework, null, 2)}\n\`\`\``);
    }
  }
}
