// =============================================================================
// Career Path — EVALUATOR-OPTIMIZER MULTI-AGENT system
// -----------------------------------------------------------------------------
// How this differs from the other files:
//   - careerEvaluatorOptimizerWorkflow.js: the generator and evaluator are single LLM CALLS.
//   - careerSequentialMultiAgent.js: agents run once each, in a fixed order, and never go back.
//   - THIS FILE: TWO AGENTS, each with its own role, tools, and ReAct loop, take turns in a loop:
//                the WRITER agent produces a draft, the REVIEWER agent checks it, and the
//                reviewer's feedback goes back to the writer for another try.
//
// Because both are agents, they can use tools. The writer researches careers, and the
// reviewer can VERIFY claims against data instead of just trusting the draft.
// (This is the "generate and review" + "iterative refinement" pattern from Google ADK,
// where a LoopAgent repeats until a checker says the result passes or the loop hits its limit.)
//
// Plain code (the orchestrator), NOT an LLM, runs the loop:
//   - It runs the writer, then the reviewer, and passes results through a shared `state` object.
//   - It reads the reviewer's verdict and decides to stop or go another round.
//   - It enforces the round limit.
// The reviewer only reports a verdict. It never decides whether the loop continues.
//
//   [User input] -> Agent 1: Career Writer   --state.draft-->
//                        ^   Agent 2: Career Reviewer --state.review--> PASS? --yes--> [Final output]
//                        |                                             |
//                        +------------ feedback (code loop) -----------+ no (and rounds left)
//
// Inside each agent, the LLM decides its own steps (Thought -> Action -> Observation
// -> ... -> Final Answer). That's what makes each one an AGENT, not just an LLM call.
//
// Run with:  node multi-agent-systems/careerEvaluatorOptimizerMultiAgent.js "I love animals and science, hate sitting at a desk"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: load your real key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"
const MAX_LOOPS = 5; // Safety limit so no agent can loop forever inside its own ReAct loop.
const MAX_ROUNDS = 3; // Safety limit on write -> review rounds so the two agents can't ping-pong forever.

// --- FAKE LLM CALL -----------------------------------------------------------
// Every agent uses this to talk to the LLM. `agentName` is only used by the
// fake below (to pick a scripted reply); a real API call doesn't need it.
async function callLLM(agentName, messages) {
  // REPLACE this whole block with a real API call. Example (OpenAI-style):
  //   const res = await fetch("https://api.openai.com/v1/chat/completions", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
  //     body: JSON.stringify({
  //       model: MODEL,
  //       messages,
  //       stop: ["Observation:"], // Stops the LLM from making up its own tool results.
  //     }),
  //   });
  //   const data = await res.json();
  //   return data.choices[0].message.content;

  // FAKE: each agent has a script. The Nth reply is used on the agent's Nth loop.
  // The writer and reviewer each have two scripts: one for the first round, one for the second.
  // We pick the script by looking at the agent's input (which is how a real LLM would adapt too).
  const input = messages[1].content;
  const scriptName =
    agentName === "Career Writer"
      ? input.includes("Reviewer feedback") ? "Career Writer (revision)" : "Career Writer (first draft)"
      : input.includes("Lab Researcher") ? "Career Reviewer (flawed draft)" : "Career Reviewer (good draft)";

  const fakeScripts = {
    // First round: a sloppy pick that ignores the "no desk" dislike and gives a thin roadmap.
    "Career Writer (first draft)": [
      "Thought: The user likes animals and science. I'll search for matching careers.\n" +
        "Action: search_careers\nAction Input: animals, science",
      "Thought: Lab Researcher uses science, so I'll recommend it.\n" +
        "Final Answer: Career: Lab Researcher. Why: it involves science and sometimes animals. Roadmap: Bachelor's in Biology.",
    ],
    // Second round: the writer uses the reviewer's feedback and looks up real requirements.
    "Career Writer (revision)": [
      "Thought: The reviewer says Lab Researcher is desk-bound and my roadmap was thin. I'll pick an outdoor career and look up its requirements.\n" +
        "Action: get_career_requirements\nAction Input: Wildlife Biologist",
      "Thought: I have the requirements and can fix every problem the reviewer listed.\nFinal Answer:\n" +
        "Career: Wildlife Biologist. Why: it combines animals and science with outdoor fieldwork instead of desk work.\n" +
        "1. School: Bachelor's in Biology, Zoology, or Wildlife Science (4 yrs). A Master's helps for research roles (+2 yrs).\n" +
        "2. Certifications: Associate Wildlife Biologist (The Wildlife Society); First Aid/CPR for fieldwork.\n" +
        "3. Experience: Seasonal field technician jobs, internships, volunteering at refuges.\n" +
        "4. Timeline: About 4–6 years to become an entry-level wildlife biologist.",
    ],
    "Career Reviewer (flawed draft)": [
      "Thought: The user dislikes desk work. I'll check how desk-bound the recommended career really is.\n" +
        "Action: get_work_environment\nAction Input: Lab Researcher",
      "Thought: About 70% desk time directly conflicts with the user's dislike, and the roadmap lacks certifications, experience, and timeline.\n" +
        "Final Answer: NEEDS_IMPROVEMENT: Lab Researcher is about 70% bench and desk work, which conflicts with the user's dislike of sitting at a desk. " +
        "The roadmap also needs certifications, experience, and a timeline.",
    ],
    "Career Reviewer (good draft)": [
      "Thought: I'll verify the work environment of the recommended career.\n" +
        "Action: get_work_environment\nAction Input: Wildlife Biologist",
      "Thought: Mostly outdoors, so it fits the user's dislike. The roadmap is complete.\n" +
        "Final Answer: PASS: Fits the likes, avoids the dislikes (mostly outdoor work), and has a complete roadmap.",
    ],
  };
  const loopNumber = messages.filter((m) => m.role === "assistant").length;
  return fakeScripts[scriptName][loopNumber];
}

// --- AGENT FACTORY -----------------------------------------------------------
// Builds a self-contained ReAct agent (same loop as careerSequentialMultiAgent.js).
//   name:       for logging
//   role:       the agent's job description (its system prompt)
//   tools:      the tools ONLY this agent may use
//   task:       builds this agent's input from the shared state
//   outputKey:  where this agent's final answer is saved in the shared state
function createAgent({ name, role, tools, task, outputKey }) {
  const systemPrompt = `${role}

You run in a loop of Thought, Action, Observation.
Available tools:
${Object.entries(tools).map(([toolName, tool]) => `- ${toolName}: ${tool.description}`).join("\n")}

To use a tool, respond EXACTLY like this, then stop and wait for the Observation:
Thought: <your reasoning>
Action: <tool name>
Action Input: <tool input, on ONE line>

When you are done, respond EXACTLY like this:
Thought: <your reasoning>
Final Answer: <your answer>`;

  async function run(state) {
    // Each agent has its OWN memory (messages). It only sees what `task` gives it.
    // It starts fresh every round, so anything it needs from earlier rounds must come through `state`.
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: task(state) },
    ];

    for (let loop = 1; loop <= MAX_LOOPS; loop++) {
      // REASON: the LLM decides its next Thought + Action.
      const llmOutput = await callLLM(name, messages);
      messages.push({ role: "assistant", content: llmOutput });
      console.log(`[${name}] loop ${loop}\n${llmOutput}\n`);

      // DONE? The agent decided it has finished its job.
      const finalAnswer = llmOutput.match(/Final Answer:\s*([\s\S]*)/);
      if (finalAnswer) return finalAnswer[1].trim();

      // ACT: run the tool the LLM chose (only from THIS agent's tools).
      const action = llmOutput.match(/Action:\s*(.+)\s*Action Input:\s*(.+)/);
      const tool = action && tools[action[1].trim()];
      const observation = tool
        ? await tool.run(action[2].trim())
        : "Invalid action. Use one of the listed tools with the exact format."; // Lets the LLM fix its mistake.

      // OBSERVE: feed the result back for the next loop.
      messages.push({ role: "user", content: `Observation: ${observation}` });
      console.log(`[${name}] Observation: ${observation}\n`);
    }
    throw new Error(`${name} did not finish within ${MAX_LOOPS} loops.`);
  }

  return { name, outputKey, run };
}

// --- AGENT 1: Career Writer (the "optimizer") --------------------------------
// Job: write a career recommendation, and on later rounds fix the problems the reviewer found.
const careerWriter = createAgent({
  name: "Career Writer",
  role:
    "You are a career writer. Recommend the ONE best-fit career for the user's likes and dislikes. " +
    "Include: the career, why it fits, and a short roadmap (schooling, certifications, experience, timeline). " +
    "If you are given reviewer feedback on a previous draft, fix every problem it lists and keep what already worked.",
  // On round 1 there is no review yet. On later rounds the writer also sees its last draft and the feedback.
  task: (state) =>
    state.review
      ? `User input: ${state.userInput}\n\nPrevious draft:\n${state.draft}\n\nReviewer feedback: ${state.review}`
      : `User input: ${state.userInput}`,
  outputKey: "draft",
  tools: {
    search_careers: {
      description: "Finds careers that match a list of interests. Input: comma-separated interests.",
      // REPLACE: call a real source (O*NET Interest Profiler API, your own DB...).
      run: async (interests) => `Careers matching "${interests}": Wildlife Biologist, Veterinarian, Park Ranger, Lab Researcher.`,
    },
    get_career_requirements: {
      description: "Looks up the schooling, certifications, and experience needed for a career. Input: a career name.",
      // REPLACE: call a real source (web search API, O*NET API, BLS data...).
      run: async (career) =>
        `${career}: Bachelor's in Biology/Zoology/Wildlife Science; Master's for research roles; ` +
        "Associate Wildlife Biologist cert (The Wildlife Society); field technician experience.",
    },
  },
});

// --- AGENT 2: Career Reviewer (the "evaluator") ------------------------------
// Job: judge the draft against explicit criteria, using a tool to check facts.
// The explicit criteria are what make this pattern work. Vague criteria give vague feedback.
const careerReviewer = createAgent({
  name: "Career Reviewer",
  role:
    "You are a strict reviewer of career recommendations. Check the draft against the user's input:\n" +
    "1. It fits at least one of the user's LIKES.\n" +
    "2. It does NOT conflict with any of the user's DISLIKES. Verify this with your tool; do not guess.\n" +
    "3. It includes a realistic roadmap: schooling, certifications, experience, and timeline.\n" +
    "Your Final Answer must start with exactly PASS or NEEDS_IMPROVEMENT, then a colon and your feedback. " +
    "If NEEDS_IMPROVEMENT, the feedback must say exactly what to fix.",
  task: (state) => `User input: ${state.userInput}\n\nDraft to review:\n${state.draft}`, // <- reads the writer's output
  outputKey: "review",
  tools: {
    get_work_environment: {
      description: "Looks up where and how a career's work is typically done. Input: a career name.",
      run: async (career) => {
        // REPLACE: call a real source (O*NET work context data, your own DB...).
        // FAKE: a tiny hard-coded "database".
        const fakeDb = {
          "lab researcher": "Lab Researcher: mostly indoors; bench and computer work; about 70% of time at a desk.",
          "wildlife biologist": "Wildlife Biologist: mostly outdoor fieldwork; about 30% of time at a desk for reports.",
        };
        return fakeDb[career.toLowerCase()] ?? `No data found for "${career}".`;
      },
    },
  },
});

// --- GATE: plain code (NOT an LLM) reads the reviewer's verdict --------------
// Only a verdict that starts with exactly "PASS" ends the loop early. Anything else, including
// a malformed answer, counts as "not good enough" instead of silently accepting a bad draft.
function passed(review) {
  return /^PASS\b/.test(review.trim());
}

// --- EVALUATOR-OPTIMIZER ORCHESTRATOR: plain code, a bounded loop, no LLM ----
// Runs the writer, then the reviewer, and repeats until the reviewer passes the draft
// or MAX_ROUNDS is reached.
async function runEvaluatorOptimizer(writer, reviewer, state) {
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`\n========== Round ${round}: ${writer.name} ==========\n`);
    state[writer.outputKey] = await writer.run(state);

    console.log(`\n========== Round ${round}: ${reviewer.name} ==========\n`);
    state[reviewer.outputKey] = await reviewer.run(state);

    // DONE? Code decides, based on the verdict.
    if (passed(state[reviewer.outputKey])) return { state, rounds: round, approved: true };
  }

  // Ran out of rounds: return the latest draft, but be honest that it never passed.
  return { state, rounds: MAX_ROUNDS, approved: false };
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

runEvaluatorOptimizer(careerWriter, careerReviewer, { userInput })
  .then(({ state, rounds, approved }) => {
    console.log("\n========== FINAL RESULT ==========");
    console.log(`User input: ${state.userInput}\n`);
    console.log(`${approved ? "Approved" : "NOT approved (hit round limit)"} after ${rounds} round(s)\n`);
    console.log(`Final review: ${state.review}\n`);
    console.log(`Career plan:\n${state.draft}`);
  })
  .catch((err) => console.error("System failed:", err.message));
