# Documentation Map

This directory contains the project’s design and implementation documentation. Follow a strict **Single Source of Truth (SSOT)** rule: for each topic, there is exactly one authoritative file—update that file instead of creating variants like `*_v2.md`, `*_final.md`, etc.

---

## Document registry

| File | Purpose | Update when |
|---|---|---|
| `../README.md` | Project overview, how to run, controls | User-facing behavior changes |
| `README.md` | This file: doc registry + governance rules | Adding/removing docs or changing governance |
| `GAME_DESIGN.md` | Game design (core loop, objectives, tools, UX) | Gameplay/UX changes |
| `TECH_DESIGN.md` | Technical design (architecture, module boundaries, data flow) | Architecture changes |
| `AI_SYSTEM.md` | Design-level AI overview (Autopilot + Enemy AI) | AI architecture/rules changes |
| `AI_ALGO_NOTES.md` | Algorithm notes (generation/pathfinding/perception) | Algorithm changes |
| `GLOSSARY.md` | Canonical terms used in docs/code | New terms or terminology changes |
| `CHANGELOG.md` | Major system changes / breaking changes | Any major system change |
| `TODO.md` | Feature-level backlog | Planning / feature completion |
| `enemy-meta.md` | Enemy model `meta.json` pipeline + supported fields | Model pipeline changes |
| `monster-movement-plan.md` | Notes for movement quality / stuck fixes | Work on movement/stuck issues |
| `assistant/README.md` | LLM/assistant hub entrypoint | Handoff expectations change |
| `assistant/ARCHITECTURE.md` | Runtime wiring + system update order + event flows | New systems / order changes |
| `assistant/AI.md` | Autopilot + enemy AI (brains/perception/modules) | New brains / perception rules / strategy |
| `assistant/CONTENT_SYSTEMS.md` | Levels/missions/interactables/tools configuration + extension points | New missions/tools/content rules |
| `assistant/RENDERING_PERFORMANCE.md` | Minimap/world markers/perf knobs | Rendering/perf/marker changes |

---

## Governance rules

### 1) Single Source of Truth (SSOT)

- Update the authoritative file for a topic; don’t create copies like `*_v2.md`, `*_final.md`, `*_backup.md`.
- If you need major edits, add a “Revision history” section in the same file.

### 2) Register docs before creating them

- Before creating any new documentation file, add it to the table above with:
  - file name
  - purpose
  - when it should be updated
- Only create a new file when there is truly no existing file that fits the topic.

### 3) No scratch docs or scratch folders

- Don’t create `tmp/`, `scratch/`, `notes/`, `misc/`, etc.
- Don’t create generic doc names like `draft.md`, `analysis.md`, `test.md`.

### 4) Language policy

- **All Markdown documentation is English-only.**
- Code, identifiers, file names, and comments are English-only.
- Commit messages / Issues / PRs are English-only and follow Conventional Commits.

### 5) Update flow

When changing the project:

1. Update the relevant doc(s) first.
2. Make code changes.
3. Update `CHANGELOG.md` / `TODO.md` when appropriate.

---

## Quick navigation

- Start here (handoff): `assistant/README.md`
- Architecture + update order: `assistant/ARCHITECTURE.md`
- AI deep dive: `assistant/AI.md`
- Levels/missions/tools: `assistant/CONTENT_SYSTEMS.md`
- Minimap/markers/perf: `assistant/RENDERING_PERFORMANCE.md`
