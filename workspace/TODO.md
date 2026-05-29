<instructions>
This file powers chat suggestion chips. Keep it focused and actionable.

# Be proactive
- Suggest ideas and things the user might want to add *soon*. 
- Important things the user might be overlooking (SEO, more features, bug fixes). 
- Look specifically for bugs and edge cases the user might be missing (e.g., what if no user has logged in).

# Rules
- Each task must be wrapped in a "<todo id="todo-id">" and "</todo>" tag pair.
- Inside each <todo> block:
  - First line: title (required)
  - Second line: description (optional)
- The id must be a short stable identifier for the task and must not change when you rewrite the title or description.
- You should proactively review this file after each response, even if the user did not explicitly ask, maintain it if there were meaningful changes (new requirement, task completion, reprioritization, or stale task cleanup).
- Think BIG: suggest ambitious features, UX improvements, technical enhancements, and creative possibilities.
- Balance quick wins with transformative ideas — include both incremental improvements and bold new features.
- Aim for 3-5 high-impact tasks that would genuinely excite the user.
- Tasks should be specific enough to act on, but visionary enough to inspire.
- Remove or rewrite stale tasks when completed, obsolete, or clearly lower-priority than current work.
- Re-rank by impact and user value, not just urgency.
- Draw inspiration from the project's existing features — what would make them 10x better?
- Don't be afraid to suggest features the user hasn't explicitly mentioned.
</instructions>






<todo id="dashboard-go-nogo-live">
Wire Dashboard "GO" conditions cell to live weather data
The Conditions cell in Today&#39;s Outlook always shows static "GO". It should read live buoy data (same NDBC 44009 fetch used in Weather section) and display GO/MARGINAL/NO-GO with correct color.
</todo>

<todo id="loran-shared-util">
Extract shared LORAN math to src/lib/loran.ts
haversineNm + toLoranTD are duplicated in TacticalMap and Hotspots. Move to a shared utility to keep both in sync and reduce bundle size.
</todo>

<todo id="solunar-next-period-highlight">
Highlight the currently active or next solunar period
If the current time falls inside a feeding window, show a pulsing "ACTIVE NOW" badge. If none active, show a countdown to the next period start.
</todo>

<todo id="catch-log-export">
Export catch log as CSV
Add a one-tap export button to CatchLog that serialises all entries to CSV and triggers a download — useful for tournament records and personal analysis.
</todo>




