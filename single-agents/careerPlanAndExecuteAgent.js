// =============================================================================
// Career Path — PLAN-AND-EXECUTE single AGENT
// -----------------------------------------------------------------------------
// This is ONE AGENT, not a workflow and not multiple agents:
//   - Unlike the workflows, OUR CODE does not fix the steps. The LLM writes its own plan.
//   - Unlike careerSequentialMultiAgent.js, there is ONE agent with one shared memory
//     (the objective, the plan, and the results of finished steps). The "planner",
//     "executor", and "responder" below are three JOBS this one agent does, not three agents.
//
// How this differs from careerReActAgent.js:
//   - ReAct decides ONE action at a time and calls the LLM after every tool result.
//     It never has to think through the whole task up front.
//   - Plan-and-Execute first writes the WHOLE plan, then works through it step by step.
//     Forcing a full plan up front tends to give better results on multi-step tasks, and
//     the executor can be a smaller, cheaper model since each step is small and focused.
//   - It is LESS FLEXIBLE on purpose: the plan is made ONCE and never revised. If a step
//     turns out badly, the agent does not change course. That is the trade-off for
//     being faster and cheaper than ReAct.
//
// The three jobs:
//   PLANNER:   LLM writes a multi-step plan for the objective, once.
//   EXECUTOR:  LLM handles ONE step at a time, using a tool if the step needs it.
//   RESPONDER: after every step has run, LLM writes the Final Answer from the results.
//
//   [User input] -> PLANNER -> plan: [step 1, step 2, step 3]
//                                        |
//                                        v
//                     EXECUTOR runs each step in order (tools + results saved)
//                                        |
//                                        v
//                     RESPONDER writes the answer -> [Final Answer]
//
// Run with:  node single-agents/careerPlanAndExecuteAgent.js "I love animals and science, hate sitting at a desk"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: load your real key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"
const MAX_STEPS = 6; // Safety limit on how many steps the plan may contain.

// --- TOOLS -------------------------------------------------------------------
// The executor can call these tools. The LLM picks the tool by name and our code
// runs it. To give the agent new abilities, add another entry here.
const tools = {
  search_careers: {
    description: "Finds careers that match a list of interests. Input: comma-separated interests.",
    // REPLACE: call a real source (O*NET Interest Profiler API, your own DB...).
    run: async (interests) => `Careers matching "${interests}": Wildlife Biologist, Veterinarian, Park Ranger, Lab Researcher.`,
  },
  get_career_requirements: {
    description: "Looks up the schooling, certifications, and experience needed for a career. Input: a career name.",
    run: async (career) => {
      // REPLACE: call a real data source (web search API, O*NET API, your own DB...).
      // FAKE: a tiny hard-coded "database".
      const fakeDb = {
        "wildlife biologist":
          "Education: Bachelor's in Biology, Zoology, or Wildlife Science (4 yrs); Master's for research roles (+2 yrs). " +
          "Certifications: Associate Wildlife Biologist (The Wildlife Society); First Aid/CPR. " +
          "Experience: seasonal field technician jobs, internships, refuge volunteering.",
      };
      return fakeDb[career.toLowerCase()] ?? `No data found for "${career}".`;
    },
  },
};

// The tool list is generated from the `tools` object so the prompts stay in sync.
const TOOL_LIST = Object.entries(tools).map(([name, tool]) => `- ${name}: ${tool.description}`).join("\n");

// --- PROMPTS (one per job the agent does) ------------------------------------
// PLANNER: thinks through the WHOLE task up front. Asks for JSON so our code can read the plan.
const PLANNER_PROMPT = `You are a career advisor. Pick the ONE career that best fits the user's likes and
dislikes, then explain how to get there (school, certifications, experience, timeline).
Write a short step-by-step plan (at most ${MAX_STEPS} steps) to accomplish this. Each step must be small and self-contained.
Tools that will be available when the steps are executed:
${TOOL_LIST}
Respond ONLY with JSON: {"plan": ["step 1", "step 2", ...]}`;

// EXECUTOR: handles ONE step. It sees earlier results because later steps depend on them
// (e.g. "look up the chosen career" needs to know which career was chosen).
const EXECUTOR_PROMPT = `You are carrying out ONE step of a career plan. You are given the user's objective,
the results of earlier steps, and the current step. Do ONLY the current step.
Available tools:
${TOOL_LIST}
If the step needs a tool, respond ONLY with JSON: {"tool": "<tool name>", "input": "<tool input>"}
If it needs no tool, respond ONLY with JSON: {"result": "<your result for this step>"}`;

// RESPONDER: runs once, after ALL steps are done. It only writes the answer; it cannot change the plan.
const RESPONDER_PROMPT = `You are a career advisor. You are given the objective and the result of every step
that was carried out. Write the final answer: the career, why it fits, and step-by-step how to get there
(school, certifications, experience, timeline). Use only the information in the step results.`;

// --- FAKE LLM CALL -----------------------------------------------------------
// A single helper that the planner, executor, and responder all use.
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

  // FAKE planner: the whole plan is written up front.
  if (systemPrompt === PLANNER_PROMPT) {
    return JSON.stringify({
      plan: [
        "Search for careers that match the user's interests.",
        "Choose the ONE best-fit career from the matches, avoiding the user's dislikes.",
        "Look up the requirements for the chosen career.",
      ],
    });
  }

  // FAKE executor: reacts to whichever step it was given.
  if (systemPrompt === EXECUTOR_PROMPT) {
    const step = userMessage.split("Current step: ")[1];
    if (step.startsWith("Search")) return JSON.stringify({ tool: "search_careers", input: "animals, science, outdoors" });
    if (step.startsWith("Choose")) {
      return JSON.stringify({ result: "Wildlife Biologist. It combines animals and science with outdoor fieldwork instead of desk work." });
    }
    return JSON.stringify({ tool: "get_career_requirements", input: "Wildlife Biologist" });
  }

  // FAKE responder: writes the final answer from the step results.
  return [
    "Career: Wildlife Biologist",
    "Why: It combines animals and science with outdoor fieldwork instead of desk work.",
    "How to get there:",
    "1. School: Bachelor's in Biology, Zoology, or Wildlife Science (4 yrs). A Master's helps for research roles (+2 yrs).",
    "2. Certifications: Associate Wildlife Biologist (The Wildlife Society); First Aid/CPR for fieldwork.",
    "3. Experience: Seasonal field technician jobs, internships, volunteering at refuges.",
    "4. Timeline: About 4–6 years to become an entry-level wildlife biologist.",
  ].join("\n");
}

// --- PLANNER: LLM writes the whole plan --------------------------------------
async function makePlan(userInput) {
  const { plan } = JSON.parse(await callLLM(PLANNER_PROMPT, `User input: ${userInput}`));
  return limitPlan(plan);
}

// Plain-code check (NOT an LLM): the plan controls how many LLM calls we make, so
// drop empty steps and cap the length instead of trusting the LLM blindly.
function limitPlan(plan) {
  const steps = (Array.isArray(plan) ? plan : []).filter((s) => typeof s === "string" && s.trim()).slice(0, MAX_STEPS);
  if (steps.length === 0) throw new Error("The plan had no usable steps.");
  return steps;
}

// --- EXECUTOR: LLM does ONE step, our code runs the tool it picks ------------
async function executeStep(userInput, step, pastSteps) {
  const history = pastSteps.map((p, i) => `${i + 1}. ${p.step}\n   Result: ${p.result}`).join("\n") || "(none yet)";
  const message = `Objective: ${userInput}\n\nEarlier steps:\n${history}\n\nCurrent step: ${step}`;
  const decision = JSON.parse(await callLLM(EXECUTOR_PROMPT, message));

  if (decision.result) return decision.result; // The step needed no tool.

  const tool = tools[decision.tool];
  return tool
    ? tool.run(decision.input)
    : `Invalid tool "${decision.tool}". Use one of the listed tools.`; // The plan is NOT revised; the responder just sees the failure.
}

// --- RESPONDER: LLM writes the final answer from all the step results --------
async function respond(userInput, pastSteps) {
  const history = pastSteps.map((p, i) => `${i + 1}. ${p.step}\n   Result: ${p.result}`).join("\n");
  return callLLM(RESPONDER_PROMPT, `Objective: ${userInput}\n\nSteps carried out:\n${history}`);
}

// --- THE AGENT: the LLM writes the plan up front, then it runs to the end ----
async function runCareerAgent(userInput) {
  const pastSteps = []; // The agent's memory: every finished step and its result.

  // PLAN: think through the whole task first. This happens ONCE.
  const plan = await makePlan(userInput);
  console.log(`--- Plan ---\n${plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`);

  // EXECUTE: work through the plan in order, with no planner call between steps.
  for (const step of plan) {
    const result = await executeStep(userInput, step, pastSteps);
    pastSteps.push({ step, result });
    console.log(`[Executed] ${step}\n  Result: ${result}\n`);
  }

  // RESPOND: no replanning. Just turn the results into the Final Answer.
  return respond(userInput, pastSteps);
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

console.log(`User input: ${userInput}\n`);
runCareerAgent(userInput)
  .then((answer) => console.log(`=== FINAL ANSWER ===\n${answer}`))
  .catch((err) => console.error("Agent failed:", err.message));
