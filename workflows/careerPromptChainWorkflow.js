// =============================================================================
// Career Path PROMPT CHAIN WORKFLOW
// -----------------------------------------------------------------------------
// This is a WORKFLOW, not an agent:
//   - The steps and their order are hard-coded by US (the developer).
//   - The LLM never decides what to do next, never picks tools, never loops.
//   - Each LLM call does ONE small job, and its output is passed as the input
//     to the next LLM call. That's what "prompt chaining" means.
//
//   [User likes/dislikes] -> LLM #1 (pick career) -> GATE (plain code check)
//                         -> LLM #2 (roadmap for that career) -> [Final output]
//
// Run with:  node workflows/careerPromptChainWorkflow.js "I love animals and science, hate sitting at a desk"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: in a real app, load your key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"

// --- PROMPTS (one per step in the chain) -------------------------------------
// Step 1 prompt: ONLY decides a career. Asks for JSON so our code can check it.
const CAREER_PROMPT = `You are a career counselor. Based on the user's likes and dislikes,
choose the ONE best-fit career. Respond ONLY with JSON: {"career": "...", "reason": "..."}`;

// Step 2 prompt: ONLY explains how to reach the career chosen in step 1.
const ROADMAP_PROMPT = `You are a career advisor. Given a career, explain how to get there:
required schooling, certifications/licenses, experience, and a rough timeline.`;

// --- FAKE LLM CALL -----------------------------------------------------------
// A single helper that every step uses to talk to the LLM.
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

  // FAKE: choose a canned response based on which step's prompt was used.
  const fakeResponses = {
    [CAREER_PROMPT]: JSON.stringify({
      career: "Wildlife Biologist",
      reason: "Combines a love of animals and science with outdoor fieldwork instead of desk work.",
    }),
    [ROADMAP_PROMPT]: [
      "1. School: Bachelor's in Biology, Zoology, or Wildlife Science (4 yrs). A Master's helps for research roles (+2 yrs).",
      "2. Certifications: Associate Wildlife Biologist (The Wildlife Society); First Aid/CPR for fieldwork.",
      "3. Experience: Seasonal field technician jobs, internships, volunteering at refuges.",
      "4. Timeline: About 4–6 years to become an entry-level wildlife biologist.",
    ].join("\n"),
  };
  return fakeResponses[systemPrompt];
}

// --- STEP 1: LLM picks a career ----------------------------------------------
async function chooseCareer(likesAndDislikes) {
  const raw = await callLLM(CAREER_PROMPT, likesAndDislikes);
  return JSON.parse(raw); // -> { career, reason }
}

// --- GATE: plain code (NOT an LLM) checks step 1 before continuing -----------
// Prompt chains often include "gates": cheap code checks that stop the chain
// early if an intermediate output is bad, instead of passing junk forward.
function gate(step1Output) {
  if (!step1Output?.career?.trim()) throw new Error("Step 1 did not return a career. Stopping chain.");
  return step1Output;
}

// --- STEP 2: LLM explains how to get to that career --------------------------
// Note the input here is the OUTPUT of step 1. This is the "chain".
async function buildRoadmap({ career, reason }) {
  return callLLM(ROADMAP_PROMPT, `Career: ${career}\nWhy it fits the user: ${reason}`);
}

// --- THE WORKFLOW: fixed order, decided by code, not by the LLM ---------------
async function runCareerWorkflow(likesAndDislikes) {
  const careerChoice = gate(await chooseCareer(likesAndDislikes)); // Step 1 + gate
  const roadmap = await buildRoadmap(careerChoice);                // Step 2
  return { ...careerChoice, roadmap };
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

runCareerWorkflow(userInput)
  .then(({ career, reason, roadmap }) => {
    console.log(`User input: ${userInput}\n`);
    console.log(`Suggested career: ${career}\nWhy: ${reason}\n`);
    console.log(`How to get there:\n${roadmap}`);
  })
  .catch((err) => console.error("Workflow failed:", err.message));
