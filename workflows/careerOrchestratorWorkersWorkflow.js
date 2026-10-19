// =============================================================================
// Career Path — ORCHESTRATOR-WORKERS WORKFLOW
// -----------------------------------------------------------------------------
// This is a WORKFLOW, not an agent:
//   - The overall shape is hard-coded by US (the developer): plan -> delegate -> synthesize.
//   - The LLM never picks tools and never loops. It does NOT choose what happens
//     next after each result; it makes ONE plan up front.
//
// How this differs from the other files:
//   - careerPromptChainWorkflow.js: the steps are fixed in advance and run one after another.
//   - careerParallelWorkflow.js: the parallel subtasks are fixed in advance by US.
//   - THIS FILE: a central LLM (the orchestrator) READS the input and DECIDES which
//                subtasks are needed. Different inputs produce different subtasks, and
//                even a different NUMBER of them. Worker LLMs then do each subtask, and
//                a final LLM call synthesizes the results.
//   - careerReActAgent.js / careerSequentialMultiAgent.js: agents that loop on their own.
//
// Use this pattern when you can't predict the subtasks ahead of time. If the
// subtasks are always the same, plain parallelization is simpler and cheaper.
//
//                                  +--> Worker 1 (subtask A) --+
//   [User input] -> LLM Orchestrator ---> Worker 2 (subtask B) --+--> LLM Synthesizer -> [Final output]
//     (plans)         + GATE        +--> Worker N (subtask ...) -+
//
// Run with:  node workflows/careerOrchestratorWorkersWorkflow.js "I love animals and science, hate sitting at a desk"
// Try also:  node workflows/careerOrchestratorWorkersWorkflow.js "I'm an accountant and want to move into UX design"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: in a real app, load your key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"
const MAX_SUBTASKS = 4; // Safety limit so the orchestrator can't spawn unlimited (costly) workers.

// --- PROMPTS -----------------------------------------------------------------
// Orchestrator prompt: ONLY plans. It does not answer the user. It decides which
// subtasks THIS user needs. Asks for JSON so our code can read the plan.
const ORCHESTRATOR_PROMPT = `You are the lead career planner. Read the user's message and break the job into
2-${MAX_SUBTASKS} independent subtasks that, together, give them a complete career plan.
Choose subtasks that fit THIS user. A first-time job seeker and someone changing careers need different things.
Respond ONLY with JSON: {"subtasks": [{"type": "short_snake_case_name", "instruction": "what the worker must do"}]}`;

// Worker prompt: ONE generic prompt reused for every subtask. The orchestrator's
// instruction is what makes each worker specialized.
const WORKER_PROMPT = `You are a career specialist. You are given the user's original message plus ONE subtask.
Complete ONLY that subtask, in 2-4 sentences or a short list. Do not do the other parts of the plan.`;

// Synthesizer prompt: ONLY combines the workers' results into one clean answer.
const SYNTHESIZER_PROMPT = `You are a career counselor. Combine the specialists' results into ONE clear,
well-organized career plan for the user. Do not add new facts that are not in the results.`;

// --- FAKE LLM CALL -----------------------------------------------------------
// A single helper that the orchestrator, every worker, and the synthesizer use.
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

  // FAKE orchestrator: the plan DEPENDS ON THE INPUT. That is the whole point of this pattern.
  if (systemPrompt === ORCHESTRATOR_PROMPT) {
    if (/accountant|move into|switch/i.test(userMessage)) {
      return JSON.stringify({
        subtasks: [
          { type: "transferable_skills", instruction: "List skills from the user's current job that carry over to the new field." },
          { type: "skill_gaps", instruction: "Name the skills the user is missing and the fastest way to learn each one." },
        ],
      });
    }
    return JSON.stringify({
      subtasks: [
        { type: "career_match", instruction: "Choose the ONE career that best fits the user's likes and dislikes, and say why." },
        { type: "education_roadmap", instruction: "Explain the schooling and certifications needed for that kind of career." },
        { type: "field_experience", instruction: "Suggest ways to get hands-on experience and a rough timeline." },
      ],
    });
  }

  // FAKE workers: pick a canned result based on the subtask type in the message.
  if (systemPrompt === WORKER_PROMPT) {
    const fakeWorkerResults = {
      career_match: "Wildlife Biologist. It combines animals and science with outdoor fieldwork instead of desk work.",
      education_roadmap: "Bachelor's in Biology, Zoology, or Wildlife Science (4 yrs); a Master's helps for research roles. Earn the Associate Wildlife Biologist certification and First Aid/CPR.",
      field_experience: "Seasonal field technician jobs, internships, and volunteering at wildlife refuges. About 4–6 years total to reach an entry-level role.",
      transferable_skills: "Attention to detail, working with data, and meeting client deadlines all carry over to UX work.",
      skill_gaps: "Design fundamentals, user research, and a portfolio. A 3–6 month UX course plus 2–3 portfolio projects covers these.",
    };
    const type = Object.keys(fakeWorkerResults).find((t) => userMessage.includes(`Subtask type: ${t}`));
    return fakeWorkerResults[type];
  }

  // FAKE synthesizer: a canned final answer for each of the two sample plans.
  if (userMessage.includes("career_match")) {
    return [
      "Your best fit is Wildlife Biologist: it combines animals and science with outdoor fieldwork instead of desk work.",
      "To get there, earn a Bachelor's in Biology, Zoology, or Wildlife Science (a Master's helps for research roles), plus the Associate Wildlife Biologist certification and First Aid/CPR.",
      "Build experience through seasonal field technician jobs, internships, and refuge volunteering. Expect about 4–6 years in total.",
    ].join("\n");
  }
  return [
    "Your accounting background gives you attention to detail, data skills, and a record of meeting client deadlines, which all carry over to UX design.",
    "The gaps are design fundamentals, user research, and a portfolio. A 3–6 month UX course plus 2–3 portfolio projects will close them.",
  ].join("\n");
}

// --- STEP 1: ORCHESTRATOR LLM plans the subtasks -----------------------------
// The code never says "do a roadmap, then do an outlook". The LLM decides this at runtime.
async function plan(userInput) {
  const raw = await callLLM(ORCHESTRATOR_PROMPT, userInput);
  return JSON.parse(raw).subtasks; // -> [{ type, instruction }, ...]
}

// --- GATE: plain code (NOT an LLM) checks the plan before spending money -----
// The orchestrator's plan controls how many LLM calls we make, so we validate it.
// Drop malformed subtasks and cap the count instead of trusting the LLM blindly.
function gate(subtasks) {
  const valid = (Array.isArray(subtasks) ? subtasks : [])
    .filter((s) => s?.type?.trim() && s?.instruction?.trim())
    .slice(0, MAX_SUBTASKS);
  if (valid.length === 0) throw new Error("Orchestrator returned no usable subtasks. Stopping workflow.");
  return valid;
}

// --- STEP 2: WORKER LLMs each do one subtask ---------------------------------
// Each worker sees the original input (for context) plus ONLY its own subtask.
// The subtasks are independent, so Promise.all runs the workers at the same time.
async function runWorkers(userInput, subtasks) {
  return Promise.all(
    subtasks.map(async ({ type, instruction }) => {
      const result = await callLLM(
        WORKER_PROMPT,
        `User message: ${userInput}\n\nSubtask type: ${type}\nSubtask: ${instruction}`
      );
      console.log(`[Worker: ${type}] ${result}\n`);
      return { type, result };
    })
  );
}

// --- STEP 3: SYNTHESIZER LLM combines the worker results ---------------------
async function synthesize(userInput, workerResults) {
  const combined = workerResults.map(({ type, result }) => `${type}: ${result}`).join("\n");
  return callLLM(SYNTHESIZER_PROMPT, `User message: ${userInput}\n\nSpecialist results:\n${combined}`);
}

// --- THE WORKFLOW: plan -> delegate -> synthesize, in an order set by code ---
async function runCareerWorkflow(userInput) {
  const subtasks = gate(await plan(userInput));                 // Step 1 + gate
  console.log(`Orchestrator planned ${subtasks.length} subtasks: ${subtasks.map((s) => s.type).join(", ")}\n`);
  const workerResults = await runWorkers(userInput, subtasks);  // Step 2
  return synthesize(userInput, workerResults);                  // Step 3
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

runCareerWorkflow(userInput)
  .then((plan) => {
    console.log("========== FINAL RESULT ==========");
    console.log(`User input: ${userInput}\n`);
    console.log(plan);
  })
  .catch((err) => console.error("Workflow failed:", err.message));
