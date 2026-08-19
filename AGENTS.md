# Rehearsal project instructions

Before changing product behavior, read:

1. `docs/METHOD.md`
2. `docs/ARCHITECTURE.md`
3. `docs/MOBILE_APP_DIRECTION.md`
4. `docs/HANDOFF.md`

The intended phone target is an installable iPhone Home Screen PWA that launches
in standalone mode without browser chrome. App Store distribution and a native
iOS rewrite are not current goals.

For every product change:

- preserve the complete desktop keyboard flow;
- provide a complete touch path for every core action;
- account for narrow iPhone portrait layouts, safe areas, and the software keyboard;
- avoid hover-only behavior and hardwired same-origin API assumptions;
- keep the server database as the source of truth and make network failures recoverable;
- do not introduce Capacitor, native plugins, broad offline caching, or background
  sync without a separately approved requirement;
- apply the verification gate in `docs/MOBILE_APP_DIRECTION.md` when a core flow
  or mobile layout changes.

Keep mobile-readiness changes proportional to the feature being implemented. Do
not expand unrelated work into a PWA or native-platform refactor.
