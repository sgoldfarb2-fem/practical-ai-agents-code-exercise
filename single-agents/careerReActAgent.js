// =============================================================================
// Career Path — single ReAct AGENT
// -----------------------------------------------------------------------------
// This is an AGENT, not a workflow (compare with careerPromptChainWorkflow.js):
//   - In the workflow, OUR CODE fixed the steps: LLM #1 -> gate -> LLM #2.
//   - Here, ONE LLM runs in a loop and decides what happens next itself.
//
// ReAct = "Reason + Act" (Yao et al., 2022). Each turn of the loop the LLM:
//   Thought:     reasons about the situation           (Reason)
//   Action:      picks a tool + input to call           (Act)
//   Observation: our code runs the tool, feeds result back to the LLM
// ...and repeats until the LLM writes "Final Answer:".
//
// For this task the agent's run looks like this:
//   Loop 1 (LLM): Thought -> decides the career, then Action: look up requirements
//          (code): runs the tool -> Observation: schooling/certs/experience
//   Loop 2 (LLM): Thought -> has enough info, so Final Answer: how to get there
//
// Run with:  node single-agents/careerReActAgent.js "I love animals and science, hate sitting at a desk"
// =============================================================================

// --- SETUP -------------------------------------------------------------------
// REPLACE: load your real key from an environment variable, e.g.
//   const API_KEY = process.env.OPENAI_API_KEY;   // or ANTHROPIC_API_KEY, etc.
// Never hard-code real keys in source code.
const API_KEY = "FAKE_KEY_FOR_DEMO";
const MODEL = "your-model-name-here"; // REPLACE: e.g. "gpt-4o-mini" or "claude-sonnet-4-5"
const MAX_LOOPS = 5; // Safety limit so the agent can't loop forever.

// --- TOOLS (the "Act" part of ReAct) -----------------------------------------
// The agent can call these tools. The LLM picks the tool by name and our code
// runs it. To give the agent new abilities, add another entry here.
const tools = {
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

// --- SYSTEM PROMPT: teaches the LLM the ReAct format --------------------------
// The tool list is generated from the `tools` object so the prompt stays in sync.
const SYSTEM_PROMPT = `You are a career advisor. Pick the ONE career that best fits the user's
likes and dislikes, then explain how to get there (school, certifications, experience, timeline).

You run in a loop of Thought, Action, Observation.
Available tools:
${Object.entries(tools).map(([name, tool]) => `- ${name}: ${tool.description}`).join("\n")}

To use a tool, respond EXACTLY like this, then stop and wait for the Observation:
Thought: <your reasoning>
Action: <tool name>
Action Input: <tool input>

When you have enough information, respond EXACTLY like this:
Thought: <your reasoning>
Final Answer: <the career, why it fits, and step-by-step how to get there>`;

// --- FAKE LLM CALL -----------------------------------------------------------
// Takes the whole conversation so far and returns the LLM's next Thought/Action.
async function callLLM(messages) {
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

  // FAKE: before any tool result arrives, decide a career and call the tool.
  // After the tool result arrives, give the final answer.
  const hasObservation = messages.some((m) => m.content.startsWith("Observation:"));
  if (!hasObservation) {
    return [
      "Thought: The user loves animals and science but dislikes desk work. Outdoor fieldwork studying animals",
      "fits best, so I'll choose Wildlife Biologist. Next I should look up what it takes to become one.",
      "Action: get_career_requirements",
      "Action Input: Wildlife Biologist",
    ].join("\n");
  }
  return [
    "Thought: I now have the requirements and can answer the user.",
    "Final Answer: Career: Wildlife Biologist",
    "Why: It combines animals and science with outdoor fieldwork instead of desk work.",
    "How to get there:",
    "1. School: Bachelor's in Biology, Zoology, or Wildlife Science (4 yrs). A Master's helps for research roles (+2 yrs).",
    "2. Certifications: Associate Wildlife Biologist (The Wildlife Society); First Aid/CPR for fieldwork.",
    "3. Experience: Seasonal field technician jobs, internships, volunteering at refuges.",
    "4. Timeline: About 4–6 years to become an entry-level wildlife biologist.",
  ].join("\n");
}

// --- THE REACT LOOP: the LLM decides each step; our code only runs tools ------
async function runCareerAgent(userInput) {
  // The conversation is the agent's memory. Every Thought/Action/Observation is added to it.
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userInput },
  ];

  for (let loop = 1; loop <= MAX_LOOPS; loop++) {
    // REASON: the LLM looks at everything so far and writes its next Thought + Action.
    const llmOutput = await callLLM(messages);
    messages.push({ role: "assistant", content: llmOutput });
    console.log(`--- Loop ${loop} ---\n${llmOutput}`);

    // DONE? If the LLM wrote a Final Answer, the agent has decided to stop.
    const finalAnswer = llmOutput.match(/Final Answer:\s*([\s\S]*)/);
    if (finalAnswer) return finalAnswer[1].trim();

    // ACT: read which tool the LLM chose, run it, and record the result.
    const action = llmOutput.match(/Action:\s*(.+)\s*Action Input:\s*(.+)/);
    const tool = action && tools[action[1].trim()];
    const observation = tool
      ? await tool.run(action[2].trim())
      : "Invalid action. Use one of the listed tools with the exact format."; // Lets the LLM fix its own mistake.

    // OBSERVE: feed the tool result back so the LLM can reason about it next loop.
    messages.push({ role: "user", content: `Observation: ${observation}` });
    console.log(`Observation: ${observation}\n`);
  }
  throw new Error(`Agent did not finish within ${MAX_LOOPS} loops.`);
}

// --- ENTRY POINT -------------------------------------------------------------
// Take user input from the command line, or fall back to a sample input.
const userInput = process.argv[2] || "I love animals and science. I dislike sitting at a desk all day.";

console.log(`User input: ${userInput}\n`);
runCareerAgent(userInput)
  .then((answer) => console.log(`\n=== FINAL ANSWER ===\n${answer}`))
  .catch((err) => console.error("Agent failed:", err.message));
