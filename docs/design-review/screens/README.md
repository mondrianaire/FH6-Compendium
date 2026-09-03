# Screens

Capture these yourself if they are missing — the dashboard must be running:

    python scripts/serve_dashboard.py 8000     # from the WORKTREE
    open http://localhost:8000/v2/index.html#live   at 1080 x 1751

To force a state for review, paste into the console:

    window.__bs = buildStatus;
    buildStatus = () => ({key:'ratified', label:'ratified', tone:'ok',
      why:'your own saved, unlocked build', steps:['set it as the testing baseline'], twin:{c:'x'}});
    HDR_KEY = null; paintPanel();
    // restore: buildStatus = window.__bs; HDR_KEY = null; paintPanel();

States worth capturing: downloaded / new build on disk / unknown-unsaved / variation /
unsaved clone / ratified / offline / one-of-N ambiguity.
