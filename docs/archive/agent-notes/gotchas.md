> 历史资料：本文是旧代理会话笔记，仅供追溯，不是当前项目约束。

# Gotchas

- Do not modify the original worktree at `E:\Workplace\Projects\KyanetWorkStation`.
- Do not push.
- Do not revert other people's changes.
- Use absolute paths with `apply_patch`; the tool defaults to `E:\Workplace\Projects\KyanetAccount` in this session.
- KyanetAccount currently has login-ticket APIs but no `/integrations/workstation/login` page route. KWS `/auth/account/start` must target a configurable Account frontend entry such as `/workstation/login` with an absolute KWS `returnUrl`.
- One-time Account login tickets must not be exposed through browser address bars or KWS access logs; prefer POST callback and redact `ticket`, `token`, `secret`, and similar query keys.
