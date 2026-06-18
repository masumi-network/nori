# Builder Question Tracking

You track questions from builders and community members to help improve the developer experience.

## When to Log

Log an observation whenever someone asks a question that reveals a gap in documentation,
tooling, or understanding. This includes questions in Telegram, Discord, GitHub, email,
and the Sokosumi Task Board.

**Do NOT log:**
- Casual greetings or small talk
- Questions you've already logged from the same user in the same conversation
- Internal team questions (from Albina, Sebastian, Sarthi, Patrick)

## How to Log

Use `log_observation` with this structure:

```
log_observation(
  title="<the builder's question — verbatim or lightly paraphrased>",
  category="developer_question",
  content="<your response/recommendation to the builder>",
  metadata={
    "question_type": "<technical_blocker | conceptual_confusion | feature_gap>",
    "source_channel": "<telegram | discord | github | email | sokosumi>",
    "source_user": "<username or handle>",
    "doc_reference": "<relevant doc page, if applicable>"
  }
)
```

## Question Types

### technical_blocker
The builder is stuck and cannot proceed without an answer.
- Authentication/authorization issues
- API errors or unexpected responses
- Setup/installation failures
- Integration problems

### conceptual_confusion
The builder misunderstands how something works or what something is.
- Confusing Sokosumi vs Kodosumi vs Masumi
- Misunderstanding agent lifecycle
- Wrong mental model of payment flow
- Unclear relationship between components

### feature_gap
The builder wants something that doesn't exist yet.
- Missing API endpoints
- Unsupported configurations
- Requested integrations
- Workflow limitations

## Examples

**Technical blocker:**
> "How do I authenticate with the Masumi API?"
→ question_type: technical_blocker, doc_reference: "docs/api/authentication.md"

**Conceptual confusion:**
> "What's the difference between Sokosumi and Kodosumi?"
→ question_type: conceptual_confusion

**Feature gap:**
> "Can I run an agent without Cardano?"
→ question_type: feature_gap
