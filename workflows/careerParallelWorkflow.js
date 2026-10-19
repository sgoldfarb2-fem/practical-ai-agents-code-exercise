// =============================================================================
// Career Path — PARALLELIZATION WORKFLOW
// -----------------------------------------------------------------------------
// This is a WORKFLOW, not an agent:
//   - The structure is hard-coded by US (the developer).
//   - The LLM never decides what to do next, never picks tools, never loops.
//   - Several LLM calls run AT THE SAME TIME, and plain code combines the results.
//
// How this differs from the other files:
//   - careerPromptChainWorkflow.js: calls run ONE AFTER ANOTHER (each needs the previous output).
//   - careerRoutingWorkflow.js: ONE path is chosen and run.
//   - THIS FILE: independent calls run TOGETHER (Promise.all), then code aggregates.
//   - careerReActAgent.js / careerSequentialMultiAgent.js: agents that loop on their own.
//
// Parallelization has two variations, and this file uses both:
//   1. VOTING:     run the SAME task several times and combine the answers, for
//                  more confidence. (Here: 3 counselors each pick a career, majority wins.)
//   2. SECTIONING: split a task into DIFFERENT independent subtasks that don't
//                  need each other's output. (Here: roadmap, outlook, and day-to-day
//                  life for the winning career are written at the same time.)
//
//                       +--> LLM pick #1 --+
//   [User input] ------>+--> LLM pick #2 --+--> VOTE (code) --> winning career
//                       +--> LLM pick #3 --+                          |
//                                                  +--> LLM: roadmap -+
//                                                  +--> LLM: outlook -+--> AGGREGATE (code)
//                                                  +--> LLM: day-to-day +    --> [Final output]
//
// Run with:  node workflows/careerParallelWorkflow.js "I love animals and science, hate sitting at a desk"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: in a real app, load your key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"
const NUM_VOTERS = 3; // How many times the SAME pick-a-career task runs in parallel.

// --- PROMPTS -----------------------------------------------------------------
// VOTING prompt: the same prompt is sent NUM_VOTERS times. Asks for JSON so our code can count votes.
const PICK_CAREER_PROMPT = `You are a career counselor. Based on the user's likes and dislikes,
choose the ONE best-fit career. Respond ONLY with JSON: {"career": "..."}`;

// SECTIONING prompts: each one covers a DIFFERENT aspect of the same career.
// None of them needs another's output, which is why they can run in parallel.
const ROADMAP_PROMPT = `You are a career advisor. Given a career, explain how to get there:
required schooling, certifications/licenses, experience, and a rough timeline.`;

const OUTLOOK_PROMPT = `You are a labor-market analyst. Given a career, summarize typical salary range
and job growth outlook in 2-3 sentences.`;

const DAY_TO_DAY_PROMPT = `You are a working professional in the given career. Describe what a typical
day looks like, including the best and hardest parts, in 2-3 sentences.`;

// --- FAKE LLM CALL -----------------------------------------------------------
// A single helper that every parallel call uses to talk to the LLM.
// Right now it returns canned text so the file runs without a key or network.
let pickCount = 0; // FAKE only: lets the 3 voters give slightly different answers.

async function callLLM(systemPrompt, userMessage) {
  // REPLACE this whole block with a real API call. Example (OpenAI-style):
  //   const res = await fetch("https://api.openai.com/v1/chat/completions", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
  //     body: JSON.stringify({
  //       model: MODEL,
  //       temperature: 1, // For voting, keep some randomness so voters can differ.
  //       messages: [
  //         { role: "system", content: systemPrompt },
  //         { role: "user", content: userMessage },
  //       ],
  //     }),
  //   });
  //   const data = await res.json();
  //   return data.choices[0].message.content;

  // FAKE: the voters disagree once, so the majority vote has something to decide.
  if (systemPrompt === PICK_CAREER_PROMPT) {
    const careers = ["Wildlife Biologist", "Veterinarian", "Wildlife Biologist"];
    return JSON.stringify({ career: careers[pickCount++ % careers.length] });
  }

  // FAKE: choose a canned response based on which prompt was used.
  const fakeResponses = {
    [ROADMAP_PROMPT]: [
      "1. School: Bachelor's in Biology, Zoology, or Wildlife Science (4 yrs). A Master's helps for research roles (+2 yrs).",
      "2. Certifications: Associate Wildlife Biologist (The Wildlife Society); First Aid/CPR for fieldwork.",
      "3. Experience: Seasonal field technician jobs, internships, volunteering at refuges.",
      "4. Timeline: About 4–6 years to become an entry-level wildlife biologist.",
    ].join("\n"),
    [OUTLOOK_PROMPT]: "Typical pay is roughly $50k–$85k per year. Jobs are expected to grow about as fast as average, with competition for research roles.",
    [DAY_TO_DAY_PROMPT]: "Days mix outdoor field surveys with data entry and report writing. The best part is working with wildlife; the hardest is long hours in bad weather.",
  };
  return fakeResponses[systemPrompt];
}

// --- VARIATION 1: VOTING -----------------------------------------------------
// Run the SAME task NUM_VOTERS times at once. Promise.all starts every call
// immediately and waits for all of them, so this takes about as long as ONE call.
async function pickCareerByVote(likesAndDislikes) {
  const calls = Array.from({ length: NUM_VOTERS }, () => callLLM(PICK_CAREER_PROMPT, likesAndDislikes));
  const votes = (await Promise.all(calls)).map((raw) => JSON.parse(raw).career?.trim());
  return majority(votes);
}

// --- AGGREGATOR + GATE: plain code (NOT an LLM) counts the votes -------------
// Combining results is done by code, so it's fast, free, and predictable.
function majority(votes) {
  const valid = votes.filter(Boolean);
  if (valid.length === 0) throw new Error("No voter returned a career. Stopping workflow.");

  const tally = {};
  for (const career of valid) tally[career] = (tally[career] || 0) + 1;
  console.log("Votes:", tally);

  // Highest count wins; on a tie, the career that got its first vote earliest wins.
  return Object.keys(tally).reduce((best, career) => (tally[career] > tally[best] ? career : best));
}

// --- VARIATION 2: SECTIONING -------------------------------------------------
// Run DIFFERENT, independent tasks at once. Each gets the same input (the career)
// but has its own prompt, so each prompt can stay short and focused.
async function describeCareer(career) {
  const [roadmap, outlook, dayToDay] = await Promise.all([
    callLLM(ROADMAP_PROMPT, `Career: ${career}`),
    callLLM(OUTLOOK_PROMPT, `Career: ${career}`),
    callLLM(DAY_TO_DAY_PROMPT, `Career: ${career}`),
  ]);
  return { roadmap, outlook, dayToDay };
}

// --- THE WORKFLOW: parallel stages, in an order decided by code --------------
// Sectioning needs the career first, so voting must finish before sectioning
// starts. Parallelism happens INSIDE each stage, never between dependent steps.
async function runCareerWorkflow(likesAndDislikes) {
  const career = await pickCareerByVote(likesAndDislikes); // Stage 1: voting
  const sections = await describeCareer(career);           // Stage 2: sectioning
  return { career, ...sections };
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

runCareerWorkflow(userInput)
  .then(({ career, roadmap, outlook, dayToDay }) => {
    console.log(`User input: ${userInput}\n`);
    console.log(`Suggested career (by majority vote): ${career}\n`);
    console.log(`How to get there:\n${roadmap}\n`);
    console.log(`Job outlook:\n${outlook}\n`);
    console.log(`A typical day:\n${dayToDay}`);
  })
  .catch((err) => console.error("Workflow failed:", err.message));
