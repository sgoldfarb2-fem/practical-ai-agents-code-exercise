# Practical AI Agent Workflows: Course Code

Code repo for the **master.dev Practical AI Agent Workflows** course.

## What we're building

Every example solves the **same problem**, a career path advisor:

> *"I love animals and science. I dislike sitting at a desk all day."* -> a recommended career (e.g. Wildlife Biologist) and a roadmap for getting there: schooling, certifications, experience, and a timeline.

Using one problem for every pattern makes the differences easy to see. Same input and same output, but a different way of organizing the LLM calls.

## Repo layout

| Folder | What it contains |
| --- | --- |
| [`workflows/`](workflows) | **Code decides the steps.** The LLM does small jobs, but our code controls what runs and in what order. Prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer. |
| [`single-agents/`](single-agents) | **The LLM decides the steps.** One agent with tools. ReAct, and Plan-and-Execute (plan up front, no replanning). |
| [`multi-agent-systems/`](multi-agent-systems) | **Several agents working together.** Sequential, parallel, supervisor, dispatcher, evaluator-optimizer, and peer-to-peer (swarm). |

Workflow vs. agent: in a workflow, the developer hard-codes the path. In an agent, the LLM chooses its next action in a loop. Each file's header comment explains which one it is and how it differs from the others.

## Running the examples

Requires Node.js 18 or newer. There are no dependencies and nothing to install.

```bash
node workflows/careerPromptChainWorkflow.js
node single-agents/careerReActAgent.js "I love animals and science, hate sitting at a desk"
node multi-agent-systems/careerSupervisorMultiAgent.js
```

Every file takes an optional input string and falls back to the sample input above. The routing, dispatcher, and orchestrator-workers examples also have extra sample inputs listed in their header comments.

## Things to know

- **The LLM is faked.** Each file's `callLLM` returns scripted responses so every example runs with no API key and no network. Each one has a `REPLACE` comment showing where to put a real API call, and the same goes for the fake tools (`search_careers`, `get_career_requirements`, and so on).
- **The fake answers are canned.** Most scripts always return the Wildlife Biologist example no matter what you type. Only the routing, dispatcher, and orchestrator-workers examples react to the input, so you can see them pick different paths. Plug in a real LLM to get answers for any input.
- **API keys:** `API_KEY` is a placeholder. In a real app, load it from an environment variable and never commit a real key.
- **Safety limits:** loops are always bounded (`MAX_LOOPS`, `MAX_STEPS`, `MAX_ROUNDS`) so a misbehaving agent can't run forever.
- **Each file stands alone.** They're intentionally self-contained and don't import from each other, so you can read one top to bottom.
- **Every file has the same structure:** a header comment with a diagram, then setup, prompts or tools, the fake LLM call, the pattern itself, and an entry point.
