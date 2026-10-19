// =============================================================================
// Career Path — SEQUENTIAL MULTI-AGENT workflow
// -----------------------------------------------------------------------------
// How this differs from the other two files:
//   - careerPromptChainWorkflow.js: a workflow of single LLM CALLS (no tools, no loops).
//   - careerReActAgent.js: ONE agent (ReAct loop) that does the whole job.
//   - THIS FILE:      TWO separate agents, each with its own role, instructions,
//                     tools, and ReAct loop, run one after the other.
//
// "Sequential" means plain code (the orchestrator), NOT an LLM, runs the agents
// in a fixed order. Agents pass results through a shared `state` object: each
// agent saves its final answer under its `outputKey`, and the next agent reads it.
// (This is the same pattern as Google ADK's SequentialAgent.)
//
//   [User input] -> Agent 1: Career Matcher  --state.career-->
//                   Agent 2: Roadmap Advisor --state.roadmap--> [Final output]
//
// Inside each agent, the LLM decides its own steps (Thought -> Action -> Observation
// -> ... -> Final Answer). That's what makes each step an AGENT, not just an LLM call.
//
// Run with:  node multi-agent-systems/careerSequentialMultiAgent.js "I love animals and science, hate sitting at a desk"
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
    "Career Matcher": [
      "Thought: The user likes animals and science and dislikes desk work. I'll search for matching careers.\n" +
        "Action: search_careers\nAction Input: animals, science, outdoors",
      "Thought: Of the matches, Wildlife Biologist best avoids desk work while using animals and science.\n" +
        "Final Answer: Wildlife Biologist. Why: it combines animals and science with outdoor fieldwork instead of desk work.",
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
// Builds a self-contained ReAct agent (same loop as careerReActAgent.js).
//   name:       for logging
//   role:       the agent's job description (its system prompt)
//   tools:      the tools ONLY this agent may use
//   task:       builds this agent's input from the shared state
//   outputKey:  where this agent saves its final answer in the shared state
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
      console.log(`[${name}] loop ${loop}\n${llmOutput}`);

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
      console.log(`Observation: ${observation}\n`);
    }
    throw new Error(`${name} did not finish within ${MAX_LOOPS} loops.`);
  }

  return { name, outputKey, run };
}

// --- AGENT 1: Career Matcher -------------------------------------------------
// Job: read the user's likes/dislikes and decide ONE career.
const careerMatcher = createAgent({
  name: "Career Matcher",
  role: "You are a career matcher. Choose the ONE career that best fits the user's likes and dislikes, and say why.",
  task: (state) => `My likes and dislikes: ${state.userInput}`,
  outputKey: "career",
  tools: {
    search_careers: {
      description: "Finds careers that match a list of interests. Input: comma-separated interests.",
      // REPLACE: call a real source (O*NET Interest Profiler API, your own DB...).
      run: async (interests) => `Careers matching "${interests}": Wildlife Biologist, Veterinarian, Park Ranger, Lab Researcher.`,
    },
  },
});

// --- AGENT 2: Roadmap Advisor ------------------------------------------------
// Job: take the career Agent 1 chose and explain how to get there.
const roadmapAdvisor = createAgent({
  name: "Roadmap Advisor",
  role: "You are a career roadmap advisor. Explain how to reach the given career: school, certifications, experience, and timeline.",
  task: (state) => `Chosen career (from the Career Matcher): ${state.career}`, // <- reads Agent 1's output
  outputKey: "roadmap",
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

// --- SEQUENTIAL ORCHESTRATOR: plain code, fixed order, no LLM ----------------
// Runs each agent in order and saves its answer into the shared state, so the
// next agent can use it. The orchestrator never decides anything on its own.
async function runSequential(agents, state) {
  for (const agent of agents) {
    console.log(`\n========== Running ${agent.name} ==========`);
    state[agent.outputKey] = await agent.run(state);
  }
  return state;
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

runSequential([careerMatcher, roadmapAdvisor], { userInput })
  .then((state) => {
    console.log("\n========== FINAL RESULT ==========");
    console.log(`User input: ${state.userInput}\n`);
    console.log(`Career: ${state.career}\n`);
    console.log(`How to get there:\n${state.roadmap}`);
  })
  .catch((err) => console.error("Pipeline failed:", err.message));
