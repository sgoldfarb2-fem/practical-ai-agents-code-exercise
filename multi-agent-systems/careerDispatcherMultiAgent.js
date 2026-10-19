// =============================================================================
// Career Path — DISPATCHER MULTI-AGENT system
// -----------------------------------------------------------------------------
// How this differs from the other multi-agent files:
//   - careerSequentialMultiAgent.js: plain CODE runs the agents in a fixed order.
//   - careerParallelMultiAgent.js:   plain CODE runs the agents all at once.
//   - careerSupervisorMultiAgent.js: an LLM calls MANY workers, gets every result BACK,
//                                    and combines them into the final answer.
//   - THIS FILE: a DISPATCHER agent (an LLM) reads the request and hands it to exactly ONE
//                specialist agent. That specialist takes over, does the whole job with its
//                own tools, and answers directly. The dispatcher never gets a result back.
//
// This is the "coordinator / dispatcher" pattern (like Google ADK's transfer_to_agent).
// It's the multi-agent version of careerRoutingWorkflow.js, with two differences:
//   - the dispatcher is an agent choosing a hand-off, not a classifier returning JSON, and
//   - each route is a full AGENT (its own ReAct loop and tools), not a single LLM call.
//
//   [User input] -> DISPATCHER (reads request, picks ONE specialist, then steps aside)
//                      |  transfer to "Career Explorer"     -> Agent 1 (ReAct loop + tools) -> [Final output]
//                      |  transfer to "Roadmap Advisor"     -> Agent 2 (ReAct loop + tools) -> [Final output]
//                      '  transfer to "Career Change Coach" -> Agent 3 (ReAct loop + tools) -> [Final output]
//
// Only the chosen specialist runs. The other two agents are never called.
//
// Run with:  node multi-agent-systems/careerDispatcherMultiAgent.js "I love animals and science, hate sitting at a desk"
// Try also:  node multi-agent-systems/careerDispatcherMultiAgent.js "How do I become a nurse?"
//            node multi-agent-systems/careerDispatcherMultiAgent.js "I'm an accountant and want to move into UX design"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: load your real key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"
const MAX_LOOPS = 5; // Safety limit so no specialist can loop forever.

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

  // FAKE dispatcher: picks a specialist with simple keyword checks.
  // (A real LLM would understand the message; this just lets the demo run.)
  if (agentName === "Dispatcher") {
    const text = messages[messages.length - 1].content.toLowerCase();
    let pick = ["Career Explorer", "The user describes likes and dislikes but names no career."];
    if (/\b(i'm a|i am a|my job|currently work|switch|change careers?)\b/.test(text) || text.includes("move into")) {
      pick = ["Career Change Coach", "The user already has a job and wants a different one."];
    } else if (/\b(how (do|can) i become|how to become)\b/.test(text)) {
      pick = ["Roadmap Advisor", "The user names a specific career and asks how to reach it."];
    }
    return `Thought: ${pick[1]}\nAction: transfer_to_agent\nAction Input: ${pick[0]}`;
  }

  // FAKE specialists: each has a script. The Nth reply is used on the agent's Nth loop.
  const fakeScripts = {
    "Career Explorer": [
      "Thought: The user likes animals and science and dislikes desk work. I'll search for matching careers.\n" +
        "Action: search_careers\nAction Input: animals, science, outdoors",
      "Thought: Of the matches, Wildlife Biologist best avoids desk work while using animals and science.\n" +
        "Final Answer: Wildlife Biologist. Why: it combines animals and science with outdoor fieldwork instead of desk work.",
    ],
    "Roadmap Advisor": [
      "Thought: I need the real requirements for Registered Nurse before advising.\n" +
        "Action: get_career_requirements\nAction Input: Registered Nurse",
      "Thought: I have the requirements and can write a clear roadmap.\nFinal Answer:\n" +
        "1. School: Bachelor's of Science in Nursing (4 yrs) or an Associate's degree in Nursing (2 yrs).\n" +
        "2. Certifications: Pass the NCLEX-RN exam and get a state nursing license; CPR/BLS certification.\n" +
        "3. Experience: Supervised clinical rotations during school; optional nursing assistant work.\n" +
        "4. Timeline: About 2–4 years to become a registered nurse.",
    ],
    "Career Change Coach": [
      "Thought: I should see which accounting skills carry over to UX design.\n" +
        "Action: get_transferable_skills\nAction Input: accountant to UX designer",
      "Thought: I know the overlap and the gaps, so I can write a transition plan.\nFinal Answer:\n" +
        "1. Transferable skills: Attention to detail, working with data, and meeting client deadlines.\n" +
        "2. Gaps: Design fundamentals, user research, and a portfolio of real projects.\n" +
        "3. Plan: Take a UX course or bootcamp (3–6 months), build 2–3 portfolio projects, then apply for junior roles.",
    ],
  };
  const loopNumber = messages.filter((m) => m.role === "assistant").length;
  return fakeScripts[agentName][loopNumber];
}

// --- AGENT FACTORY -----------------------------------------------------------
// Builds a self-contained ReAct agent (same loop as careerSupervisorMultiAgent.js).
//   name:         for logging, and the name the dispatcher uses to pick it
//   description:  what this agent is good at (the dispatcher reads this to choose)
//   role:         the agent's job description (its system prompt)
//   tools:        the tools ONLY this agent may use
// `run(input)` takes plain text. For a specialist, that's the user's original request.
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

// --- SPECIALIST 1: Career Explorer -------------------------------------------
// Job: for someone who doesn't know what they want, pick ONE career from their likes and dislikes.
const careerExplorer = createAgent({
  name: "Career Explorer",
  description: "For people who don't know what career they want and describe likes, dislikes, or interests.",
  role: "You are a career explorer. Choose the ONE career that best fits the user's likes and dislikes, and say why.",
  tools: {
    search_careers: {
      description: "Finds careers that match a list of interests. Input: comma-separated interests.",
      // REPLACE: call a real source (O*NET Interest Profiler API, your own DB...).
      run: async (interests) => `Careers matching "${interests}": Wildlife Biologist, Veterinarian, Park Ranger, Lab Researcher.`,
    },
  },
});

// --- SPECIALIST 2: Roadmap Advisor -------------------------------------------
// Job: for someone who already named a career, explain how to get there.
const roadmapAdvisor = createAgent({
  name: "Roadmap Advisor",
  description: "For people who already name a specific career and want to know how to get there.",
  role: "You are a career roadmap advisor. Explain how to reach the career the user names: school, certifications, experience, and timeline.",
  tools: {
    get_career_requirements: {
      description: "Looks up the schooling, certifications, and experience needed for a career. Input: a career name.",
      run: async (career) => {
        // REPLACE: call a real data source (web search API, O*NET API, your own DB...).
        // FAKE: a tiny hard-coded "database".
        const fakeDb = {
          "registered nurse":
            "Education: Bachelor's of Science in Nursing (4 yrs) or Associate's degree in Nursing (2 yrs). " +
            "Certifications: NCLEX-RN exam and state license; CPR/BLS. " +
            "Experience: supervised clinical rotations during school.",
        };
        return fakeDb[career.toLowerCase()] ?? `No data found for "${career}".`;
      },
    },
  },
});

// --- SPECIALIST 3: Career Change Coach ---------------------------------------
// Job: for someone who already has a career and wants a different one.
const careerChangeCoach = createAgent({
  name: "Career Change Coach",
  description: "For people who already have a job or career and want to switch to a different one.",
  role: "You are a career-change coach. Explain which of the user's current skills transfer, what gaps they must fill, and a realistic transition plan.",
  tools: {
    get_transferable_skills: {
      description: "Looks up skills that carry over between two careers. Input: 'current career to target career'.",
      // REPLACE: call a real source (O*NET skills data, your own DB...).
      run: async (transition) =>
        `${transition}: shared skills are attention to detail, data analysis, and client communication. ` +
        "Missing: design fundamentals, user research, portfolio.",
    },
  },
});

// --- DISPATCHER: an LLM agent whose ONLY job is to pick a specialist ----------
// It has one action, transfer_to_agent, and no domain tools. It never answers the user.
const specialists = [careerExplorer, roadmapAdvisor, careerChangeCoach];
const DEFAULT_SPECIALIST = careerExplorer; // Used when the dispatcher's answer is unusable.

// The specialist list is generated from `specialists` so the prompt stays in sync.
const DISPATCHER_PROMPT = `You are the dispatcher for a career advice service. You do NOT answer the user.
Read the user's message and hand it to the ONE specialist best suited to it.
Specialists:
${specialists.map((s) => `- ${s.name}: ${s.description}`).join("\n")}

Respond EXACTLY like this:
Thought: <why this specialist fits>
Action: transfer_to_agent
Action Input: <the exact specialist name>`;

// One LLM call decides the hand-off. There is no loop: after this, the dispatcher is done.
async function dispatch(userInput) {
  const llmOutput = await callLLM("Dispatcher", [
    { role: "system", content: DISPATCHER_PROMPT },
    { role: "user", content: userInput },
  ]);
  console.log(`[Dispatcher]\n${llmOutput}\n`);

  // GATE: plain code (NOT an LLM) checks the choice. LLMs can name a specialist we don't have,
  // so fall back to a safe default instead of crashing.
  const requested = llmOutput.match(/Action Input:\s*(.+)/)?.[1].trim();
  const chosen = specialists.find((s) => s.name.toLowerCase() === requested?.toLowerCase());
  if (chosen) return chosen;

  console.warn(`Dispatcher picked unknown specialist "${requested}". Falling back to "${DEFAULT_SPECIALIST.name}".\n`);
  return DEFAULT_SPECIALIST;
}

// --- THE SYSTEM: dispatch once, then the chosen specialist owns the request --
// The specialist receives the user's ORIGINAL message (a real hand-off, not a rewritten task),
// and its Final Answer goes straight back to the user.
async function runCareerSystem(userInput) {
  const specialist = await dispatch(userInput);
  console.log(`========== Transferred to ${specialist.name} ==========\n`);
  const answer = await specialist.run(userInput);
  return { specialist: specialist.name, answer };
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

console.log(`User input: ${userInput}\n`);
runCareerSystem(userInput)
  .then(({ specialist, answer }) => console.log(`=== FINAL ANSWER (from ${specialist}) ===\n${answer}`))
  .catch((err) => console.error("System failed:", err.message));
