# Architecture

## Overview

The project is split by runtime responsibility instead of by framework trend.

- TypeScript owns operator-facing workflow logic.
- Python owns analysis and evaluation logic.

## High-Level Components

### TypeScript Layer

- `src/ts/index.ts`: local entry point for orchestration
- `src/ts/agents/marketing-agent.ts`: top-level marketing agent definition
- `src/ts/connectors/platform.ts`: platform connector contract
- `src/ts/config/platforms.ts`: supported platform metadata

This layer should answer:

- What platform are we targeting?
- What content format is appropriate?
- What workflow step happens next?

### Python Layer

- `src/python/marketing_fox/main.py`: package entry point
- `src/python/marketing_fox/agent.py`: analytics-oriented agent model
- `src/python/marketing_fox/config.py`: supported platform configuration
- `src/python/marketing_fox/connectors/base.py`: connector protocol for future Python-side integrations

This layer should answer:

- Which idea is strongest?
- Which content dimension is underperforming?
- What signals should change the next recommendation?

## Integration Model

1. TypeScript collects the current campaign context and publishing objectives.
2. Shared platform definitions normalize what each channel expects.
3. Python evaluates content ideas, scores opportunities, and returns guidance.
4. TypeScript presents the next action or triggers follow-up workflows.

## Design Constraints

- Connector interfaces must be explicit and platform-aware.
- Secrets stay in environment variables and are never embedded in code.
- New platform support should start with docs and config contracts before API code.
- Keep the system runnable locally without external infrastructure in the first phase.
