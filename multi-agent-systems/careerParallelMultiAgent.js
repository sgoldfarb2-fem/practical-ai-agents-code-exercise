// =============================================================================
// Career Path — PARALLEL MULTI-AGENT system
// -----------------------------------------------------------------------------
// How this differs from the other files:
//   - careerParallelWorkflow.js: parallel LLM CALLS (no tools, no loops).
//   - careerSequentialMultiAgent.js: several agents run ONE AFTER ANOTHER.
//   - THIS FILE: several AGENTS run AT THE SAME TIME, each with its own role,
//                instructions, tools, memory, and ReAct loop, followed by one
//                "merger" agent that combines what they found.
//
// "Parallel" means plain code (the orchestrator), NOT an LLM, starts every agent
// at once with Promise.all and waits for all of them. (Same idea as Google ADK's ParallelAgent.)
//   - The agents are INDEPENDENT: each works in its own branch, with its own messages,
//     and never sees the others' work while running.
//   - Each agent saves its answer under its OWN `outputKey` in the shared `state`,
//     so no two agents ever write to the same place.
//   - After they all finish, a merger agent reads every result from `state`.
//     This "fan-out, then gather" shape is the standard way to use parallel agents.
//
//   [User input] --+--> Agent 1: Interest Matcher    --state.interests-+
//                  +--> Agent 2: Work Style Analyst  --state.workStyle-+--> Agent 4: Career Advisor
//                  +--> Agent 3: Job Market Analyst  --state.jobMarket-+      (merger) --> [Final output]
//
// Inside each agent, the LLM decides its own steps (Thought -> Action -> Observation
// -> ... -> Final Answer). That's what makes each one an AGENT, not just an LLM call.
//
// Run with:  node multi-agent-systems/careerParallelMultiAgent.js "I love animals and science, hate sitting at a desk"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: load your real key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"
const MAX_LOOPS = 5; // Safety limit so no agent can loop forever.

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
  const fakeScripts = {
    "Interest Matcher": [
      "Thought: The user loves animals and science. I'll search for careers that match those interests.\n" +
        "Action: search_careers\nAction Input: animals, science",
      "Thought: These matches all fit the stated interests.\n" +
        "Final Answer: Best interest matches: Wildlife Biologist, Veterinarian, Lab Researcher.",
    ],
    "Work Style Analyst": [
      "Thought: The user dislikes sitting at a desk, so I need careers with active, outdoor work.\n" +
        "Action: find_careers_by_work_style\nAction Input: outdoor, active",
      "Thought: Lab Researcher is not on the active list, so I'll warn against it.\n" +
        "Final Answer: Good for avoiding desk work: Wildlife Biologist, Park Ranger, Forester. Avoid: Lab Researcher (bench and desk heavy).",
    ],
    "Job Market Analyst": [
      "Thought: I should check how strong the job market is in the user's fields of interest.\n" +
        "Action: get_job_outlook\nAction Input: animals, science",
      "Thought: I can summarize the demand now.\n" +
        "Final Answer: Veterinarian has the strongest growth. Wildlife Biologist is steady but competitive. Park Ranger is slow-growing.",
    ],
    "Career Advisor": [
      "Thought: Wildlife Biologist fits the interests and the no-desk preference, and the market is steady. I need its requirements.\n" +
        "Action: get_career_requirements\nAction Input: Wildlife Biologist",
      "Thought: I have the requirements and can write the final recommendation.\nFinal Answer:\n" +
        "Career: Wildlife Biologist. Why: it matches the user's interests, avoids desk work, and has a steady job market.\n" +
        "1. School: Bachelor's in Biology, Zoology, or Wildlife Science (4 yrs). A Master's helps for research roles (+2 yrs).\n" +
        "2. Certifications: Associate Wildlife Biologist (The Wildlife Society); First Aid/CPR for fieldwork.\n" +
        "3. Experience: Seasonal field technician jobs, internships, volunteering at refuges.\n" +
        "4. Timeline: About 4–6 years to become an entry-level wildlife biologist.",
    ],
  };
  const loopNumber = messages.filter((m) => m.role === "assistant").length;
  return fakeScripts[agentName][loopNumber];
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
Action Input: <tool input>

When you are done, respond EXACTLY like this:
Thought: <your reasoning>
Final Answer: <your answer>`;

  async function run(state) {
    // Each agent has its OWN memory (messages). It only sees what `task` gives it.
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

// --- PARALLEL AGENTS: each looks at the SAME user input from a DIFFERENT angle
// They must not depend on each other's output, which is why they can run at once.
// Each one only reads `state.userInput`.

// Agent 1: Job = which careers match what the user LIKES.
const interestMatcher = createAgent({
  name: "Interest Matcher",
  role: "You are an interest matcher. Find careers that match the user's likes and interests. Do not worry about anything else.",
  task: (state) => `My likes and dislikes: ${state.userInput}`,
  outputKey: "interests",
  tools: {
    search_careers: {
      description: "Finds careers that match a list of interests. Input: comma-separated interests.",
      // REPLACE: call a real source (O*NET Interest Profiler API, your own DB...).
      run: async (interests) => `Careers matching "${interests}": Wildlife Biologist, Veterinarian, Park Ranger, Lab Researcher.`,
    },
  },
});

// Agent 2: Job = which careers fit what the user DISLIKES (work style).
const workStyleAnalyst = createAgent({
  name: "Work Style Analyst",
  role: "You are a work style analyst. Find careers whose day-to-day work avoids what the user dislikes. Do not worry about anything else.",
  task: (state) => `My likes and dislikes: ${state.userInput}`,
  outputKey: "workStyle",
  tools: {
    find_careers_by_work_style: {
      description: "Finds careers by typical work setting. Input: comma-separated work styles, e.g. 'outdoor, active' or 'office'.",
      // REPLACE: call a real source (O*NET work context data, your own DB...).
      run: async (styles) => `Careers with "${styles}" work: Wildlife Biologist, Park Ranger, Forester, Veterinarian (clinic and field).`,
    },
  },
});

// Agent 3: Job = how healthy the job market is for the user's fields.
const jobMarketAnalyst = createAgent({
  name: "Job Market Analyst",
  role: "You are a job market analyst. Report on demand and growth for careers in the user's fields of interest. Do not worry about anything else.",
  task: (state) => `My likes and dislikes: ${state.userInput}`,
  outputKey: "jobMarket",
  tools: {
    get_job_outlook: {
      description: "Looks up job growth for careers in a field. Input: comma-separated fields.",
      // REPLACE: call a real source (BLS Occupational Outlook data, a jobs API...).
      run: async (fields) =>
        `Outlook for "${fields}": Veterinarian +19% (much faster than average); ` +
        "Wildlife Biologist +3% (average, competitive); Park Ranger +2% (slow).",
    },
  },
});

// --- MERGER AGENT: runs AFTER the parallel agents, using all their results ---
// Job = weigh the three reports, choose ONE career, and explain how to get there.
const careerAdvisor = createAgent({
  name: "Career Advisor",
  role:
    "You are a career advisor. You receive reports from three specialists. Choose the ONE best career, " +
    "say why, then explain how to get there: school, certifications, experience, and timeline.",
  // <- reads ALL three parallel agents' outputs from the shared state
  task: (state) =>
    `User's likes and dislikes: ${state.userInput}\n\n` +
    `Interest Matcher report: ${state.interests}\n` +
    `Work Style Analyst report: ${state.workStyle}\n` +
    `Job Market Analyst report: ${state.jobMarket}`,
  outputKey: "plan",
  tools: {
    get_career_requirements: {
      description: "Looks up the schooling, certifications, and experience needed for a career. Input: a career name.",
      // REPLACE: call a real source (web search API, O*NET API, BLS data...).
      run: async (career) =>
        `${career}: Bachelor's in Biology/Zoology/Wildlife Science; Master's for research roles; ` +
        "Associate Wildlife Biologist cert (The Wildlife Society); field technician experience.",
    },
  },
});

// --- PARALLEL ORCHESTRATOR: plain code, starts every agent at once, no LLM ---
// Promise.all starts all agents immediately and waits for the slowest one, so the
// total time is about that of ONE agent instead of the sum of all of them.
// If any agent throws, Promise.all rejects and the whole run fails. Use Promise.allSettled if you'd rather keep partial results.
async function runParallel(agents, state) {
  console.log(`\n========== Running in parallel: ${agents.map((a) => a.name).join(", ")} ==========\n`);
  const results = await Promise.all(agents.map((agent) => agent.run(state)));

  // Save results only AFTER all agents finish, each under its own key, so agents never overwrite each other.
  agents.forEach((agent, i) => (state[agent.outputKey] = results[i]));
  return state;
}

// --- THE SYSTEM: fan out (parallel), then gather (merger) --------------------
// Fixed order, decided by code: all parallel agents first, then the merger.
async function runCareerSystem(userInput) {
  const state = { userInput };
  await runParallel([interestMatcher, workStyleAnalyst, jobMarketAnalyst], state);

  console.log(`\n========== Running ${careerAdvisor.name} ==========\n`);
  state[careerAdvisor.outputKey] = await careerAdvisor.run(state);
  return state;
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

runCareerSystem(userInput)
  .then((state) => {
    console.log("\n========== FINAL RESULT ==========");
    console.log(`User input: ${state.userInput}\n`);
    console.log(`Interest Matcher: ${state.interests}\n`);
    console.log(`Work Style Analyst: ${state.workStyle}\n`);
    console.log(`Job Market Analyst: ${state.jobMarket}\n`);
    console.log(`Career plan:\n${state.plan}`);
  })
  .catch((err) => console.error("System failed:", err.message));
