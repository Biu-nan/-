# Independent review and disposition
Fresh reviewer read code without production credentials, data or service access.
Important: mixed-case API bypass — RED tests reproduced; API-prefix guard now case-insensitive.
Important: cwd/PROJECT_ROOT outside fixture — RED; main requires all writable roots to equal fixture root before initialization.
Important: broad synthetic Human real executor access — RED; local-only Human fixture route allowlist; all real executors remain denied.
Important: route/body store mismatch — rejected across declared resource and payload stores; unsafe store mutation denied.
Manifest Listing dependency omission regraded Important: real package identity is M01 acceptance. Synthetic dependency byte-change RED then GREEN; Listing Agent source and package now included.
All fixes executed in this worktree. No second review was requested; covering tests and full suite provide verification.
