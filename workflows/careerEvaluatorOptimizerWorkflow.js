// =============================================================================
// Career Path — EVALUATOR-OPTIMIZER WORKFLOW
// -----------------------------------------------------------------------------
// This is a WORKFLOW, not an agent:
//   - The loop structure is hard-coded by US (the developer): generate -> evaluate -> maybe revise.
//   - The LLM never picks tools and never decides whether the loop keeps going.
//     The evaluator only returns a verdict; plain CODE reads it and decides to
//     stop or retry, and CODE enforces the round limit.
//
// How this differs from the other files:
//   - careerPromptChainWorkflow.js: each step runs ONCE, moving forward only.
//   - careerRoutingWorkflow.js / careerParallelWorkflow.js: pick one path / run calls together.
//   - THIS FILE: one LLM call (the generator) writes an answer, a SECOND LLM call
//                (the evaluator) critiques it against clear criteria, and the
//                feedback is fed back to the generator to improve it.
//   - careerReActAgent.js / careerSequentialMultiAgent.js: agents that loop on their own.
//
// Use this pattern when (1) you have clear evaluation criteria and (2) an LLM
// can give feedback that actually makes the next draft better.
//
//   [User input] -> LLM Generator (draft) -> LLM Evaluator (PASS / NEEDS_IMPROVEMENT + feedback)
//                        ^                              |
//                        |------ feedback (code loop) --+   PASS or MAX_ROUNDS -> [Final output]
//
// Run with:  node workflows/careerEvaluatorOptimizerWorkflow.js "I love animals and science, hate sitting at a desk"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: in a real app, load your key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"
const MAX_ROUNDS = 3; // Safety limit so the generate/evaluate loop can't run forever or burn money.

// --- PROMPTS -----------------------------------------------------------------
// Generator prompt: ONLY writes (or rewrites) a career recommendation.
const GENERATOR_PROMPT = `You are a career counselor. Based on the user's likes and dislikes,
recommend the ONE best-fit career. Include: the career, why it fits, and a short roadmap
(schooling, certifications, experience, timeline). If you are given feedback on a previous draft,
fix every problem it lists and keep what already worked.`;

// Evaluator prompt: ONLY judges the draft. The explicit criteria are what make
// this pattern work. Vague criteria give vague feedback. Asks for JSON so our code can read the verdict.
const EVALUATOR_PROMPT = `You are a strict reviewer of career recommendations. Check the draft against the user's input:
1. It fits at least one of the user's LIKES.
2. It does NOT conflict with any of the user's DISLIKES.
3. It includes a realistic roadmap: schooling, certifications, experience, and timeline.
Respond ONLY with JSON: {"verdict": "PASS" | "NEEDS_IMPROVEMENT", "feedback": "..."}
If NEEDS_IMPROVEMENT, the feedback must say exactly what to fix.`;

// --- FAKE LLM CALL -----------------------------------------------------------
// A single helper that the generator and evaluator both use to talk to the LLM.
// Right now it returns canned text so the file runs without a key or network.
async function callLLM(systemPrompt, userMessage) {
  // REPLACE this whole block with a real API call. Example (OpenAI-style):
  //   const res = await fetch("https://api.openai.com/v1/chat/completions", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
  //     body: JSON.stringify({
  //       model: MODEL,
  //       messages: [
  //         { role: "system", content: systemPrompt },
  //         { role: "user", content: userMessage },
  //       ],
  //     }),
  //   });
  //   const data = await res.json();
  //   return data.choices[0].message.content;

  // FAKE generator: the first draft has a flaw; the revision (which includes feedback) fixes it.
  if (systemPrompt === GENERATOR_PROMPT) {
    if (!userMessage.includes("Feedback on previous draft")) {
      return "Career: Lab Researcher. Why: it involves science and sometimes working with animals. Roadmap: Bachelor's in Biology.";
    }
    return [
      "Career: Wildlife Biologist. Why: it combines animals and science with outdoor fieldwork instead of desk work.",
      "1. School: Bachelor's in Biology, Zoology, or Wildlife Science (4 yrs). A Master's helps for research roles (+2 yrs).",
      "2. Certifications: Associate Wildlife Biologist (The Wildlife Society); First Aid/CPR for fieldwork.",
      "3. Experience: Seasonal field technician jobs, internships, volunteering at refuges.",
      "4. Timeline: About 4–6 years to become an entry-level wildlife biologist.",
    ].join("\n");
  }

  // FAKE evaluator: flags the flawed first draft, passes the fixed one.
  if (userMessage.includes("Lab Researcher")) {
    return JSON.stringify({
      verdict: "NEEDS_IMPROVEMENT",
      feedback:
        "Lab research is mostly indoor desk and bench work, which conflicts with the user's dislike of sitting at a desk. " +
        "The roadmap is also missing certifications, experience, and a timeline.",
    });
  }
  return JSON.stringify({ verdict: "PASS", feedback: "Fits the likes, avoids the dislikes, and has a complete roadmap." });
}

// --- GENERATOR: LLM writes (or rewrites) the recommendation ------------------
// On round 1 it only sees the user's input. On later rounds it also sees its
// previous draft and the evaluator's feedback. That feedback is what makes the next draft better.
async function generate(likesAndDislikes, previousDraft, feedback) {
  const message = previousDraft
    ? `User input: ${likesAndDislikes}\n\nPrevious draft:\n${previousDraft}\n\nFeedback on previous draft: ${feedback}`
    : `User input: ${likesAndDislikes}`;
  return callLLM(GENERATOR_PROMPT, message);
}

// --- EVALUATOR: a SEPARATE LLM call judges the draft -------------------------
// Using a different prompt (and ideally fresh context) keeps the judge from
// just agreeing with the writer.
async function evaluate(likesAndDislikes, draft) {
  const raw = await callLLM(EVALUATOR_PROMPT, `User input: ${likesAndDislikes}\n\nDraft:\n${draft}`);
  return JSON.parse(raw); // -> { verdict, feedback }
}

// --- GATE: plain code (NOT an LLM) checks the evaluator's answer -------------
// Only an exact "PASS" ends the loop early. Anything else, including a malformed
// verdict, is treated as "not good enough" instead of silently accepting a bad draft.
function passed(evaluation) {
  return evaluation?.verdict === "PASS";
}

// --- THE WORKFLOW: a bounded loop, controlled by code, not by the LLM --------
async function runCareerWorkflow(likesAndDislikes) {
  let draft = null;
  let evaluation = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // OPTIMIZE: write a draft (using the last feedback, if any).
    draft = await generate(likesAndDislikes, draft, evaluation?.feedback);
    console.log(`[Round ${round}] Draft:\n${draft}\n`);

    // EVALUATE: judge the draft against the criteria.
    evaluation = await evaluate(likesAndDislikes, draft);
    console.log(`[Round ${round}] Verdict: ${evaluation.verdict}\nFeedback: ${evaluation.feedback}\n`);

    // DONE? Code decides, based on the verdict.
    if (passed(evaluation)) return { draft, rounds: round, approved: true };
  }

  // Ran out of rounds: return the best we have, but be honest that it never passed.
  return { draft, rounds: MAX_ROUNDS, approved: false };
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

runCareerWorkflow(userInput)
  .then(({ draft, rounds, approved }) => {
    console.log("========== FINAL RESULT ==========");
    console.log(`User input: ${userInput}\n`);
    console.log(`${approved ? "Approved" : "NOT approved (hit round limit)"} after ${rounds} round(s)\n`);
    console.log(draft);
  })
  .catch((err) => console.error("Workflow failed:", err.message));
