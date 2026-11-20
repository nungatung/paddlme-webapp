# User Preferences

## Workflow
- Works with a limited token budget (runs on DeepSeek) that the user actively monitors — flagged "token usage is almost up for deepseek" mid-task; be economical with tool calls, avoid repeated failed retries (e.g. dev-server start attempts), and finish requested changes before budget runs out. Confidence: 0.5
- Expects requested changes to actually be visible on their end — after edits the user saw "nothing changed" and asked for the work to be redone; confirm edits are live in the page they're viewing (their running dev server) before reporting done. Confidence: 0.6

## Design
- When asked for a visual redesign, wants clearly noticeable changes — subtle spacing/typography tweaks read as "nothing changed"; lean toward bolder, higher-impact adjustments. Confidence: 0.6
