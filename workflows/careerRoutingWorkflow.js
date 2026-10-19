// =============================================================================
// Career Path — ROUTING WORKFLOW
// -----------------------------------------------------------------------------
// This is a WORKFLOW, not an agent:
//   - The paths and their code are hard-coded by US (the developer).
//   - The LLM never picks tools, never loops, and never decides what to do next
//     beyond ONE job: classifying the input.
//
// How this differs from the other files:
//   - careerPromptChainWorkflow.js: EVERY input goes through the SAME fixed steps, in order.
//   - THIS FILE: an LLM CLASSIFIES the input first, then plain code sends it down
//                ONE of several specialized paths. Each path has its own prompt.
//   - careerReActAgent.js / careerSequentialMultiAgent.js: agents that loop on their own.
//
// Why route? One prompt that tries to handle every kind of user does each job
// poorly. Separate, focused prompts do better, and the user only pays for the
// path they actually need.
//
//                                  +--> "explore"  -> LLM: suggest a career
//   [User input] -> LLM Router ----+--> "roadmap"  -> LLM: step-by-step roadmap   -> [Final output]
//     (classify)    + GATE         +--> "switch"   -> LLM: career-change plan
//
// Run with:  node workflows/careerRoutingWorkflow.js "I love animals and science, hate sitting at a desk"
// Try also:  node workflows/careerRoutingWorkflow.js "How do I become a nurse?"
//            node workflows/careerRoutingWorkflow.js "I'm an accountant and want to move into UX design"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: in a real app, load your key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"

// --- PROMPTS -----------------------------------------------------------------
// Router prompt: ONLY classifies the input. It does not answer the user.
// Asks for JSON so our code can check it. Listing every route and what it
// means is what makes the classification accurate.
const ROUTER_PROMPT = `You are a router for a career advice service. Classify the user's message into exactly ONE category:
- "explore": the user does NOT know what career they want and describes likes, dislikes, or interests.
- "roadmap": the user already names a specific career and wants to know how to get there.
- "switch": the user already has a job or career and wants to change to a different one.
Respond ONLY with JSON: {"route": "explore" | "roadmap" | "switch", "reason": "..."}`;

// One specialized prompt per route. Each is short and focused on a single kind of user.
const EXPLORE_PROMPT = `You are a career counselor. Based on the user's likes and dislikes,
choose the ONE best-fit career and explain why in 2-3 sentences.`;

const ROADMAP_PROMPT = `You are a career advisor. Given a career the user already wants, explain how to get there:
required schooling, certifications/licenses, experience, and a rough timeline.`;

const SWITCH_PROMPT = `You are a career-change coach. The user already works in one field and wants another.
Explain which of their current skills transfer, what gaps they must fill, and a realistic transition plan.`;

// --- FAKE LLM CALL -----------------------------------------------------------
// A single helper that the router and every route use to talk to the LLM.
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

  // FAKE: the router fakes a classification with simple keyword checks.
  // (A real LLM would understand the message; this just lets the demo run.)
  if (systemPrompt === ROUTER_PROMPT) {
    const text = userMessage.toLowerCase();
    if (/\b(i'm a|i am a|my job|currently work|switch|change careers?)\b/.test(text) || text.includes("move into")) {
      return JSON.stringify({ route: "switch", reason: "The user already has a job and wants a different one." });
    }
    if (/\b(how (do|can) i become|how to become)\b/.test(text)) {
      return JSON.stringify({ route: "roadmap", reason: "The user named a specific career and asked how to reach it." });
    }
    return JSON.stringify({ route: "explore", reason: "The user described likes and dislikes but named no career." });
  }

  // FAKE: each route returns a canned response.
  const fakeResponses = {
    [EXPLORE_PROMPT]:
      "Wildlife Biologist. It combines a love of animals and science with outdoor fieldwork instead of desk work.",
    [ROADMAP_PROMPT]: [
      "1. School: Bachelor's of Science in Nursing (4 yrs) or an Associate's degree in Nursing (2 yrs).",
      "2. Certifications: Pass the NCLEX-RN exam and get a state nursing license; CPR/BLS certification.",
      "3. Experience: Supervised clinical rotations during school; optional nursing assistant work.",
      "4. Timeline: About 2–4 years to become a registered nurse.",
    ].join("\n"),
    [SWITCH_PROMPT]: [
      "1. Transferable skills: Attention to detail, working with data, and meeting client deadlines.",
      "2. Gaps: Design fundamentals, user research, and a portfolio of real projects.",
      "3. Plan: Take a UX course or bootcamp (3–6 months), build 2–3 portfolio projects, then apply for junior roles.",
    ].join("\n"),
  };
  return fakeResponses[systemPrompt];
}

// --- THE ROUTES: a lookup table from route name -> specialized handler -------
// Adding a new kind of user means adding ONE entry here plus one line in the
// router prompt. Nothing else in the workflow changes.
const ROUTES = {
  explore: (input) => callLLM(EXPLORE_PROMPT, input),
  roadmap: (input) => callLLM(ROADMAP_PROMPT, input),
  switch: (input) => callLLM(SWITCH_PROMPT, input),
};
const DEFAULT_ROUTE = "explore"; // Used when the router's answer is unusable.

// --- STEP 1: LLM router classifies the input ---------------------------------
async function classify(userInput) {
  const raw = await callLLM(ROUTER_PROMPT, userInput);
  return JSON.parse(raw); // -> { route, reason }
}

// --- GATE: plain code (NOT an LLM) checks the router's answer ----------------
// LLMs can return a category we don't have. Instead of crashing or passing junk
// forward, fall back to a safe default route.
function gate(routerOutput) {
  const route = routerOutput?.route?.trim();
  if (route in ROUTES) return { ...routerOutput, route };
  console.warn(`Router returned unknown route "${route}". Falling back to "${DEFAULT_ROUTE}".`);
  return { route: DEFAULT_ROUTE, reason: "Router output was invalid; used default route." };
}

// --- THE WORKFLOW: the LLM classifies, but CODE chooses the path -------------
// Only ONE route runs per input. The LLM never sees the other routes' prompts.
async function runCareerWorkflow(userInput) {
  const { route, reason } = gate(await classify(userInput)); // Step 1 + gate
  const answer = await ROUTES[route](userInput);             // Step 2: the one matching route
  return { route, reason, answer };
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

runCareerWorkflow(userInput)
  .then(({ route, reason, answer }) => {
    console.log(`User input: ${userInput}\n`);
    console.log(`Routed to: ${route}\nWhy: ${reason}\n`);
    console.log(`Answer:\n${answer}`);
  })
  .catch((err) => console.error("Workflow failed:", err.message));
