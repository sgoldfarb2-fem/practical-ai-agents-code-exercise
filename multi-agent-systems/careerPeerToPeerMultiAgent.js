// =============================================================================
// Career Path — PEER-TO-PEER (SWARM) MULTI-AGENT system
// -----------------------------------------------------------------------------
// How this differs from the other multi-agent files:
//   - careerSequentialMultiAgent.js / careerParallelMultiAgent.js: plain CODE decides which agent runs.
//   - careerSupervisorMultiAgent.js: a boss agent calls workers and gets every result BACK.
//   - careerDispatcherMultiAgent.js: a router agent picks ONE specialist once, then steps aside.
//   - THIS FILE: there is NO boss and NO router. The agents are PEERS. Whichever agent is
//                "active" works on the request, and when it needs a peer's expertise it hands the
//                conversation DIRECTLY to that peer. Handoffs can go in ANY direction,
//                including back to an agent that already had a turn.
//
// How it works (the "swarm" pattern, like LangGraph Swarm):
//   - Every agent gets its own domain tools PLUS a handoff tool for every other peer
//     (e.g. "transfer_to_job_market_analyst"). Handing off is just calling a tool.
//   - All agents share ONE conversation history, so a peer that takes over sees everything
//     that has happened so far. A short note with the handoff says what to do next.
//   - Our code only remembers WHICH agent is active (and runs its next step). It never chooses
//     the next agent. The agents choose, by calling handoff tools.
//   - The agent that has enough information gives the Final Answer. No one has to approve it.
//
//   [User input] -> Career Matcher (default active agent)
//                        |  transfer_to_job_market_analyst  <--->  Job Market Analyst
//                        |  transfer_to_roadmap_advisor     <--->  Roadmap Advisor
//                        '                                  <--->  (every pair of peers can hand off)
//                   The active agent writes the Final Answer -> [Final output]
//
// Inside each agent, the LLM decides its own steps (Thought -> Action -> Observation
// -> ... -> Final Answer). That's what makes each one an AGENT, not just an LLM call.
//
// Run with:  node multi-agent-systems/careerPeerToPeerMultiAgent.js "I love animals and science, hate sitting at a desk"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: load your real key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"
const MAX_STEPS = 10; // Safety limit on TOTAL steps across all agents, so peers can't hand off back and forth forever.

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

  // FAKE: each agent has a script. The Nth reply is used on that agent's Nth turn.
  // The history is shared, so we count only the replies THIS agent wrote.
  const fakeScripts = {
    "Career Matcher": [
      "Thought: The user likes animals and science and dislikes desk work. I'll search for matching careers.\n" +
        "Action: search_careers\nAction Input: animals, science, outdoors",
      "Thought: Park Ranger and Wildlife Biologist fit best, with Veterinarian close behind. Job growth isn't my expertise, so I'll hand off to the Job Market Analyst before choosing.\n" +
        "Action: transfer_to_job_market_analyst\n" +
        "Action Input: Shortlist is Park Ranger, Wildlife Biologist, Veterinarian. Please compare their job outlook, then pass it back so I can choose.",
      "Thought: Park Ranger is slow-growing, and Wildlife Biologist fits the interests and avoids desk work best. Explaining the path is the Roadmap Advisor's specialty.\n" +
        "Action: transfer_to_roadmap_advisor\n" +
        "Action Input: Chosen career is Wildlife Biologist (animals + science, outdoor work, steady market). Please explain how to get there and give the user the final answer.",
    ],
    "Job Market Analyst": [
      "Thought: I'll look up the outlook for each career on the shortlist.\n" +
        "Action: get_job_outlook\nAction Input: Park Ranger, Wildlife Biologist, Veterinarian",
      "Thought: Park Ranger growth is weak. Choosing among careers is the Career Matcher's job, so I'll pass my findings back.\n" +
        "Action: transfer_to_career_matcher\n" +
        "Action Input: Park Ranger +2% (slow), Wildlife Biologist +3% (steady but competitive), Veterinarian +19% (strongest). I'd drop Park Ranger. Your call on fit.",
    ],
    "Roadmap Advisor": [
      "Thought: I need the real requirements for Wildlife Biologist before advising.\n" +
        "Action: get_career_requirements\nAction Input: Wildlife Biologist",
      "Thought: I have the requirements and everything I need to answer the user.\nFinal Answer:\n" +
        "Career: Wildlife Biologist. Why: it combines animals and science with outdoor fieldwork instead of desk work, and the job market is steady.\n" +
        "1. School: Bachelor's in Biology, Zoology, or Wildlife Science (4 yrs). A Master's helps for research roles (+2 yrs).\n" +
        "2. Certifications: Associate Wildlife Biologist (The Wildlife Society); First Aid/CPR for fieldwork.\n" +
        "3. Experience: Seasonal field technician jobs, internships, volunteering at refuges.\n" +
        "4. Timeline: About 4–6 years to become an entry-level wildlife biologist.",
    ],
  };
  const turnNumber = messages.filter((m) => m.role === "assistant" && m.name === agentName).length;
  return fakeScripts[agentName][turnNumber];
}

// --- AGENT FACTORY -----------------------------------------------------------
// Builds a ReAct agent that can hand off to peers.
//   name:         for logging, and the name peers use to hand off to it
//   description:  what this agent is good at (peers read this to decide when to hand off)
//   role:         the agent's job description (its system prompt)
//   tools:        this agent's own domain tools. Handoff tools are added later by connectPeers().
//
// Unlike the other agent files, an agent here does NOT run a whole loop on its own.
// `step(history)` does ONE Thought -> Action -> Observation turn and reports what happened,
// because after any step the agent may hand the conversation to someone else.
function createAgent({ name, description, role, tools }) {
  const agent = { name, description, tools };

  // Built fresh each step, so it includes the handoff tools that connectPeers() adds afterward.
  const systemPrompt = () => `${role}

You are one of several PEER agents working together. There is no manager: you decide when to hand off.
Do the part you are best at. If the request needs something outside your expertise, hand off to the peer best suited.
When you have everything needed to fully answer the user, give the Final Answer yourself.
You can see the whole conversation, including what your peers did.

You run in a loop of Thought, Action, Observation.
Available tools:
${Object.entries(agent.tools).map(([toolName, tool]) => `- ${toolName}: ${tool.description}`).join("\n")}

To use a tool or hand off, respond EXACTLY like this, then stop and wait:
Thought: <your reasoning>
Action: <tool name>
Action Input: <tool input, on ONE line>

When you are done, respond EXACTLY like this:
Thought: <your reasoning>
Final Answer: <your answer>`;

  // Runs ONE turn. Reads from and writes to the SHARED history.
  // Returns { type: "final", answer } | { type: "handoff", to } | { type: "continue" }.
  agent.step = async (history) => {
    // The system prompt belongs to THIS agent; the history is shared by everyone.
    const messages = [{ role: "system", content: systemPrompt() }, ...history];

    // REASON: the LLM decides its next Thought + Action.
    const llmOutput = await callLLM(name, messages);
    history.push({ role: "assistant", name, content: llmOutput });
    console.log(`[${name}]\n${llmOutput}\n`);

    // DONE? This agent decided it can answer the user.
    const finalAnswer = llmOutput.match(/Final Answer:\s*([\s\S]*)/);
    if (finalAnswer) return { type: "final", answer: finalAnswer[1].trim() };

    // ACT: run the tool the LLM chose (only from THIS agent's tools).
    const action = llmOutput.match(/Action:\s*(.+)\s*Action Input:\s*(.+)/);
    const toolName = action?.[1].trim();
    const toolInput = action?.[2].trim();
    const tool = toolName && agent.tools[toolName];

    // HANDOFF: the chosen "tool" is a peer. Tell everyone via the shared history, and report
    // who should go next. The orchestrator just follows this; it does not choose.
    if (tool?.handoffTo) {
      history.push({ role: "user", content: `Observation: Transferred to ${tool.handoffTo}. Note from ${name}: ${toolInput}` });
      return { type: "handoff", to: tool.handoffTo };
    }

    // OBSERVE: feed the tool result back so the next step can use it.
    const observation = tool
      ? await tool.run(toolInput)
      : "Invalid action. Use one of the listed tools with the exact format."; // Lets the LLM fix its mistake.
    history.push({ role: "user", content: `Observation: ${observation}` });
    console.log(`[${name}] Observation: ${observation}\n`);
    return { type: "continue" };
  };

  return agent;
}

// --- AGENT 1: Career Matcher -------------------------------------------------
// Job: find careers that fit the user's likes and dislikes, and choose ONE.
const careerMatcher = createAgent({
  name: "Career Matcher",
  description: "Finds careers that fit a person's likes and dislikes, and chooses the best one.",
  role: "You are a career matcher. Find careers that fit the user's likes and dislikes, and choose the ONE best career once you know its job outlook.",
  tools: {
    search_careers: {
      description: "Finds careers that match a list of interests. Input: comma-separated interests.",
      // REPLACE: call a real source (O*NET Interest Profiler API, your own DB...).
      run: async (interests) => `Careers matching "${interests}": Park Ranger, Wildlife Biologist, Veterinarian, Lab Researcher.`,
    },
  },
});

// --- AGENT 2: Job Market Analyst ---------------------------------------------
// Job: report on demand and growth for specific careers.
const jobMarketAnalyst = createAgent({
  name: "Job Market Analyst",
  description: "Reports job growth and demand for specific careers.",
  role: "You are a job market analyst. Report on demand and growth for the careers you are given. Do not choose the career for the user.",
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

// --- AGENT 3: Roadmap Advisor ------------------------------------------------
// Job: explain how to reach ONE chosen career, then answer the user.
const roadmapAdvisor = createAgent({
  name: "Roadmap Advisor",
  description: "Explains how to reach a chosen career: school, certifications, experience, and timeline.",
  role:
    "You are a career roadmap advisor. Explain how to reach the chosen career: school, certifications, experience, and timeline. " +
    "Your Final Answer must give the user the career, why it fits, and the roadmap.",
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

// --- CONNECT THE PEERS: give every agent a handoff tool for every OTHER agent --
// This is what makes the system peer-to-peer. There is no hub: every agent can reach every other agent.
const agents = [careerMatcher, jobMarketAnalyst, roadmapAdvisor];

for (const agent of agents) {
  for (const peer of agents.filter((other) => other !== agent)) {
    agent.tools[`transfer_to_${peer.name.toLowerCase().replace(/ /g, "_")}`] = {
      description: `Hand the conversation to ${peer.name} (${peer.description}). Input: a short note with everything they need to know.`,
      handoffTo: peer.name,
    };
  }
}

// --- THE SWARM: our code tracks the active agent, and the agents choose who's next
// This is plain code, not an LLM. It runs the active agent's next step and follows any handoff.
// It never decides who goes next. It only remembers who is active.
async function runSwarm(agents, defaultAgent, userInput) {
  const byName = Object.fromEntries(agents.map((agent) => [agent.name, agent]));
  const history = [{ role: "user", content: userInput }]; // ONE history, shared by every agent.
  let active = defaultAgent;
  const path = [active.name]; // For the final printout only.

  for (let stepNumber = 1; stepNumber <= MAX_STEPS; stepNumber++) {
    const result = await active.step(history);

    // DONE? The active agent wrote the Final Answer.
    if (result.type === "final") return { answer: result.answer, answeredBy: active.name, path };

    // HANDOFF: the agent chose a peer, so that peer becomes the active agent.
    if (result.type === "handoff") {
      console.log(`---------- Handoff: ${active.name} -> ${result.to} ----------\n`);
      active = byName[result.to];
      path.push(active.name);
    }
  }
  throw new Error(`Swarm did not finish within ${MAX_STEPS} steps.`);
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

console.log(`User input: ${userInput}\n`);
runSwarm(agents, careerMatcher, userInput)
  .then(({ answer, answeredBy, path }) => {
    console.log("=== HANDOFF PATH ===");
    console.log(path.join(" -> "));
    console.log(`\n=== FINAL ANSWER (from ${answeredBy}) ===\n${answer}`);
  })
  .catch((err) => console.error("System failed:", err.message));
