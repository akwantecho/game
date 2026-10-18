// Writes the question bank as JSON for the iPhone app, so both apps share one source.
// Run: npm run export:questions
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BANK } from "../server/questions";

const out = fileURLToPath(new URL("../ios/HuroofCore/Sources/HuroofCore/Resources/questions.json", import.meta.url));
const rows = BANK.filter((q) => q.isActive).map(({ id, letter, category, difficulty, question, answer, acceptedAnswers }) => ({
  id,
  letter,
  category,
  difficulty,
  question,
  answer,
  accepted: acceptedAnswers,
}));
writeFileSync(out, JSON.stringify(rows, null, 1) + "\n");
console.log(`${rows.length} questions → ${out}`);
