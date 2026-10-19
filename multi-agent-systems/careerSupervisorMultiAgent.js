// =============================================================================
// Career Path — SUPERVISOR MULTI-AGENT system
// -----------------------------------------------------------------------------
// How this differs from the other multi-agent files:
//   - careerSequentialMultiAgent.js: plain CODE runs the agents in a fixed order.
//   - careerParallelMultiAgent.js:   plain CODE runs the agents all at once.
//   - THIS FILE: a SUPERVISOR agent (an LLM) decides which worker agent to call, in what
//                order, how many times, and when the job is done. Our code only runs
//                whichever worker the supervisor asks for.
//
// How it works (the "subagents as tools" supervisor pattern):
//   - The supervisor is itself a ReAct agent (Thought -> Action -> Observation).
//   - Its TOOLS are the worker agents: "Action: delegate_to_roadmap_advisor" hands a task
//     to that worker, and the worker's final answer comes back as the Observation.
//   - ALL communication goes through the supervisor. Workers never talk to each other or
//     to the user, so the supervisor must put everything a worker needs into its task.
//   - Each worker is a full ReAct agent with its OWN instructions, tools, and memory.
//     A worker starts fresh on every delegation and sees ONLY the task it was given.
//
//   [User input] -> SUPERVISOR (Thought -> Action -> Observation -> ... -> Final Answer)
//                      |  delegate_to_career_matcher      -> Worker 1 (own ReAct loop + tools)
//                      |  delegate_to_job_market_analyst  -> Worker 2 (own ReAct loop + tools)
//                      |  delegate_to_roadmap_advisor     -> Worker 3 (own ReAct loop + tools)
//                      '--> each worker's answer returns to the supervisor as the Observation
//
// Run with:  node multi-agent-systems/careerSupervisorMultiAgent.js "I love animals and science, hate sitting at a desk"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: load your real key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"
const MAX_LOOPS = 6; // Safety limit so no agent (supervisor or worker) can loop forever.

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
    Supervisor: [
      "Thought: First I need candidate careers that fit the user's likes and dislikes. The Career Matcher does that.\n" +
        "Action: delegate_to_career_matcher\n" +
        "Action Input: Find careers for someone who loves animals and science and dislikes sitting at a desk all day.",
      "Thought: I have candidates. Before choosing, I want to know which have good job prospects.\n" +
        "Action: delegate_to_job_market_analyst\n" +
        "Action Input: Compare job outlook for Wildlife Biologist, Veterinarian, and Park Ranger.",
      "Thought: Wildlife Biologist fits the interests and avoids desk work, and its market is steady. Now I need the roadmap.\n" +
        "Action: delegate_to_roadmap_advisor\n" +
        "Action Input: Explain how to become a Wildlife Biologist: school, certifications, experience, and timeline.",
      "Thought: I have everything I need to answer the user.\nFinal Answer:\n" +
        "Career: Wildlife Biologist. Why: it combines animals and science with outdoor fieldwork instead of desk work, and the job market is steady.\n" +
        "1. School: Bachelor's in Biology, Zoology, or Wildlife Science (4 yrs). A Master's helps for research roles (+2 yrs).\n" +
        "2. Certifications: Associate Wildlife Biologist (The Wildlife Society); First Aid/CPR for fieldwork.\n" +
        "3. Experience: Seasonal field technician jobs, internships, volunteering at refuges.\n" +
        "4. Timeline: About 4–6 years to become an entry-level wildlife biologist.",
    ],
    "Career Matcher": [
      "Thought: I'll search for careers matching animals, science, and active outdoor work.\n" +
        "Action: search_careers\nAction Input: animals, science, outdoors",
      "Thought: Lab Researcher is mostly desk and bench work, so I'll leave it out.\n" +
        "Final Answer: Best fits: Wildlife Biologist (outdoor fieldwork), Veterinarian (clinic plus some field work), Park Ranger (outdoors). Lab Researcher is desk-heavy, so skip it.",
    ],
    "Job Market Analyst": [
      "Thought: I'll look up the outlook for each career I was given.\n" +
        "Action: get_job_outlook\nAction Input: Wildlife Biologist, Veterinarian, Park Ranger",
      "Thought: I can summarize the demand now.\n" +
        "Final Answer: Veterinarian +19% (strong). Wildlife Biologist +3% (steady but competitive). Park Ranger +2% (slow).",
    ],
    "Roadmap Advisor": [
      "Thought: I need the real requirements for Wildlife Biologist before advising.\n" +
        "Action: get_career_requirements\nAction Input: Wildlife Biologist",
      "Thought: I have the requirements and can write a clear roadmap.\nFinal Answer:\n" +
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
//   name:         for logging
//   description:  what this agent is good at (the supervisor reads this to choose workers)
//   role:         the agent's job description (its system prompt)
//   tools:        the tools ONLY this agent may use
// `run(input)` takes plain text, because a worker's input is whatever task the supervisor wrote.
function createAgent({ name, description, role, tools }) {
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

  async function run(input) {
    // Each agent has its OWN memory (messages). It only sees the input it was given.
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: input },
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

  return { name, description, run };
}

// --- WORKER 1: Career Matcher ------------------------------------------------
// Job: find careers that fit what the user likes and dislikes.
const careerMatcher = createAgent({
  name: "Career Matcher",
  description: "Finds careers that fit a person's likes and dislikes. Input: a description of the person's likes and dislikes.",
  role: "You are a career matcher. Find the careers that best fit the likes and dislikes you are given, and say why. Do nothing else.",
  tools: {
    search_careers: {
      description: "Finds careers that match a list of interests. Input: comma-separated interests.",
      // REPLACE: call a real source (O*NET Interest Profiler API, your own DB...).
      run: async (interests) => `Careers matching "${interests}": Wildlife Biologist, Veterinarian, Park Ranger, Lab Researcher.`,
    },
  },
});

// --- WORKER 2: Job Market Analyst --------------------------------------------
// Job: report on demand and growth for specific careers.
const jobMarketAnalyst = createAgent({
  name: "Job Market Analyst",
  description: "Reports job growth and demand for specific careers. Input: the career names to compare.",
  role: "You are a job market analyst. Report on demand and growth for the careers you are given. Do nothing else.",
  tools: {
    get_job_outlook: {
      description: "Looks up job growth for careers. Input: comma-separated career names.",
      // REPLACE: call a real source (BLS Occupational Outlook data, a jobs API...).
      run: async (careers) =>
        `Outlook for "${careers}": Veterinarian +19% (much faster than average); ` +
        "Wildlife Biologist +3% (average, competitive); Park Ranger +2% (slow).",
    },
  },
});

// --- WORKER 3: Roadmap Advisor -----------------------------------------------
// Job: explain how to reach ONE specific career.
const roadmapAdvisor = createAgent({
  name: "Roadmap Advisor",
  description: "Explains how to reach a specific career: school, certifications, experience, and timeline. Input: ONE career name.",
  role: "You are a career roadmap advisor. Explain how to reach the career you are given: school, certifications, experience, and timeline. Do nothing else.",
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

// --- SUPERVISOR: its "tools" are the worker agents ---------------------------
// Each worker becomes a delegation tool, e.g. "delegate_to_roadmap_advisor".
// When the supervisor calls it, we run that worker with the task the supervisor wrote,
// and the worker's final answer is returned as the Observation.
const workers = [careerMatcher, jobMarketAnalyst, roadmapAdvisor];

const delegationTools = Object.fromEntries(
  workers.map((worker) => [
    `delegate_to_${worker.name.toLowerCase().replace(/ /g, "_")}`,
    {
      description: `${worker.name}: ${worker.description}`,
      run: (task) => worker.run(task),
    },
  ])
);

// The supervisor has NO domain tools of its own. It can only delegate and then combine results.
const supervisor = createAgent({
  name: "Supervisor",
  description: "Manages the team.",
  role:
    "You are the supervisor of a career advice team. You have specialist workers, each available as a tool. " +
    "Decide which worker to call next based on what you have learned so far. Workers cannot see the user's " +
    "message or each other's results, so put EVERYTHING a worker needs into its task. " +
    "When you have enough information, give the user the final answer: the ONE best career, why it fits, " +
    "and how to get there (school, certifications, experience, timeline).",
  tools: delegationTools,
});

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

console.log(`User input: ${userInput}\n`);
supervisor
  .run(userInput)
  .then((answer) => console.log(`=== FINAL ANSWER ===\n${answer}`))
  .catch((err) => console.error("System failed:", err.message));
