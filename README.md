# Practical AI Agent Workflows: Course Code

Code repo for the **Master.dev Practical AI Agent Workflows** course. What the full course [on master.dev](https://master.dev/courses/ai-agent-workflows/).

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

## Prompts from the Course

### Prompt Chaining Lesson

> I want to build an LLM powered workflow (not an agent and not agents). I want it to be a prompt chain workflow. I want to take a user input about a person's likes and dislikes and then an LLM will choose a career path for that user. Then we pass to the next step which is an LLM call that tells them the information on how to get to that career path (does it take a school, certification, or something else). Importantly again, this should be a workflow with LLMs not an agent or multiple agents. Please use JS, comment heavily, and fake the LLM calls and setup with comments on where we'd replace these keys and calls. Do this in one file and with as few lines as possible with keeping the code as clear as possible, l'd rather read more code than have chains of functions. Please feel free to ask any questions and look up prompt chaining workflows for correctness.


### ReAct Workflow Lesson

> Now I want to build a single ReAct (not multiple agents). I want it to take a user input about a person's likes and dislikes, and then an LLM step decides a career path for that user. Then we pass to the next information on how to get to that career path. Importantly again, this should be a single ReAct agent. Do this in a new file. Please use JS, comment heavily, and fake the LLM calls and setup with comments where we'd replace the real keys/calls. Do this in one file and with as few lines as possible while keeping the code easy to read. More lines is okay if it provides clarity. Please ask any questions you need to and look up ReAct agents to ensure correctness.


### Sequential Agents Lesson

>I want to build a multi-agent workflow. I want it to be a sequential workflow. I want it to take a user input about a person's likes and dislikes and then the agent decides a career path for that user. Then we pass to the next agent that tells them information on how to get to that career path (does it take school, certifications, etc). Importantly again, this should be a multi-agent setup, not a single agent or a workflow with LLMS. Make this in a new file. Please use JS, comment heavily, and fake the LLM calls and setup with comments where we'd replace the real keys/calls. Do this in one file in as few lines as possible unless more lines adds clarity. Please feel free to ask any questions and look up sequential multi-agent systems to ensure correctness.


